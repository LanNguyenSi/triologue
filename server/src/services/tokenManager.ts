import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

type RefreshResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
};

type IntegrationTokenRecord = {
  id: string;
  provider: string;
  scope: string;
  userId: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  metadata: Prisma.JsonValue;
  status: string;
};

function getIntegrationKey(): Buffer {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!key) throw new Error('INTEGRATION_ENCRYPTION_KEY not configured');
  return crypto.createHash('sha256').update(key).digest();
}

function encrypt(plaintext: string): string {
  const key = getIntegrationKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(ciphertext: string): string {
  const key = getIntegrationKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted token format');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = Buffer.from(parts[2], 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tenantId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A tenant-wide storeToken keeps retrying a Prisma write conflict (P2034)
 * until this much time has passed since its first attempt, then surfaces the
 * last conflict. The retry is bounded by time, not by a fixed attempt count,
 * because the conflict window is the winner's commit, whose length is not
 * under our control (see writeConflictBackoffMs).
 */
const STORE_TOKEN_RETRY_BUDGET_MS = 2000;

/**
 * Safety net on the attempt count, independent of the clock, so a stalled or
 * mocked clock can never turn the loop into an endless one.
 */
const STORE_TOKEN_MAX_ATTEMPTS = 20;

/** Upper bound on the cap of a single wait, so the backoff stops growing. */
const WRITE_CONFLICT_BACKOFF_MAX_CAP_MS = 250;

function isWriteConflict(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2034';
}

/**
 * Delay before retry number `attempt` (1-based): the cap doubles per attempt
 * (25, 50, 100, 200, then held at 250 ms) and the wait is drawn from the
 * upper half of it, so two retries do not wake in lockstep.
 *
 * Why waiting helps at all: Postgres raises the loser's serialization failure
 * as soon as the winner has passed its pre-commit check, but the winner's row
 * only becomes visible once its commit record is flushed. Until then every
 * fresh loser attempt reads "no row", tries to create and is aborted with
 * P2034 again. The loser only gets through once the winner's commit is
 * visible, so the retry has to outlast that commit window. A commit that
 * takes longer than STORE_TOKEN_RETRY_BUDGET_MS (an fsync stall, a starved
 * backend) still surfaces P2034 to the caller. The admin OAuth callback this
 * path serves is not latency-sensitive.
 */
function writeConflictBackoffMs(attempt: number): number {
  const cap = Math.min(25 * 2 ** (attempt - 1), WRITE_CONFLICT_BACKOFF_MAX_CAP_MS);
  return cap / 2 + Math.random() * (cap / 2);
}

export async function storeToken(
  provider: string,
  scope: string,
  tokens: OAuthTokens,
  createdBy: string,
  userId: string | null = null,
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
  const tenantId = tokens.tenantId || 'default';
  const data = {
    provider,
    scope,
    userId,
    accessToken: encrypt(tokens.accessToken),
    refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    expiresAt,
    tenantId,
    metadata: (tokens.metadata || {}) as Prisma.InputJsonValue,
    status: 'active',
    createdBy,
  };

  const updateData = {
    userId: data.userId,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: data.expiresAt,
    metadata: data.metadata,
    status: data.status,
    createdBy: data.createdBy,
  };

  if (userId === null) {
    // The @@unique([provider, scope, tenantId, userId]) index makes `upsert`'s
    // where clause require a concrete userId (Prisma rejects null there with
    // PrismaClientValidationError), so a tenant-wide (admin-mode OAuth) token
    // cannot use upsert. Fall back to findFirst + create/update inside a
    // Serializable transaction: under Serializable, two callers racing to
    // insert the first tenant-wide row for the same (provider, scope,
    // tenantId) cannot both see "no row" and both insert, one is aborted
    // with a serialization failure (Prisma P2034) and retried, so exactly
    // one row is ever created. getToken's lookup semantics (findFirst on
    // userId: null) are unchanged.
    //
    // The Serializable read is the whole "exactly one row" guarantee: a
    // Postgres unique index treats NULLs as distinct, so nothing at the
    // schema level stops a second userId-null row, and the create can never
    // raise a unique violation (P2002) for a null userId. Only P2034 is
    // therefore retried; every other error surfaces on the first attempt.
    // Each attempt is a fresh transaction, so the findFirst re-reads and a
    // retry that lost the race takes the update branch on the winner's row.
    const retryStartedAt = Date.now();
    for (let attempt = 1; ; attempt++) {
      try {
        await prisma.$transaction(
          async (tx) => {
            const existing = await tx.integrationToken.findFirst({
              where: { provider, scope, tenantId, userId: null },
              orderBy: { createdAt: 'desc' },
            });
            if (existing) {
              await tx.integrationToken.update({ where: { id: existing.id }, data: updateData });
            } else {
              await tx.integrationToken.create({ data });
            }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return;
      } catch (err) {
        const remainingMs = STORE_TOKEN_RETRY_BUDGET_MS - (Date.now() - retryStartedAt);
        if (!isWriteConflict(err) || attempt >= STORE_TOKEN_MAX_ATTEMPTS || remainingMs <= 0) {
          throw err;
        }
        // Never sleep past the budget: the last attempt starts at the budget
        // edge instead of after an overshoot.
        const waitMs = Math.min(writeConflictBackoffMs(attempt), remainingMs);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  await prisma.integrationToken.upsert({
    where: { provider_scope_tenantId_userId: { provider, scope, tenantId, userId } },
    create: data,
    update: updateData,
  });
}

export async function getToken(provider: string, scope: string, tenantId?: string): Promise<string | null> {
  const token = await prisma.integrationToken.findFirst({
    where: { provider, scope, userId: null, ...(tenantId ? { tenantId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  if (!token || token.status !== 'active') return null;

  if (token.expiresAt <= new Date()) {
    const refreshed = await tryRefresh(token);
    if (!refreshed) return null;
    return decrypt(refreshed.accessToken);
  }

  return decrypt(token.accessToken);
}

export async function getTokenForUser(
  provider: string,
  scope: string,
  userId: string,
  tenantId?: string,
): Promise<string | null> {
  const token = await prisma.integrationToken.findFirst({
    where: { provider, scope, userId, ...(tenantId ? { tenantId } : {}) },
    orderBy: { createdAt: 'desc' },
  });
  if (!token || token.status !== 'active') return null;

  if (token.expiresAt <= new Date()) {
    const refreshed = await tryRefresh(token);
    if (!refreshed) return null;
    return decrypt(refreshed.accessToken);
  }

  return decrypt(token.accessToken);
}

export async function resolveToken(
  provider: string,
  scope: string,
  userId?: string | null,
  tenantId?: string,
): Promise<string | null> {
  if (userId) {
    const userToken = await getTokenForUser(provider, scope, userId, tenantId);
    if (userToken) {
      return userToken;
    }
  }
  return getToken(provider, scope, tenantId);
}

export async function revokeToken(provider: string, scope: string, tenantId?: string): Promise<void> {
  await prisma.integrationToken.updateMany({
    where: { provider, scope, tenantId: tenantId || null },
    data: { status: 'revoked' },
  });
}

export async function listIntegrations(): Promise<Array<{
  id: string;
  provider: string;
  scope: string;
  tenantId: string | null;
  userId: string | null;
  status: string;
  expiresAt: string;
  createdBy: string;
}>> {
  const tokens = await prisma.integrationToken.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      provider: true,
      scope: true,
      tenantId: true,
      userId: true,
      status: true,
      expiresAt: true,
      createdBy: true,
      metadata: true,
    },
  });

  return tokens.map((token) => ({
    id: token.id,
    provider: token.provider,
    scope: token.scope,
    tenantId: token.tenantId,
    userId: token.userId,
    status: token.status,
    expiresAt: token.expiresAt.toISOString(),
    createdBy: token.createdBy,
  }));
}

async function tryRefresh(token: IntegrationTokenRecord): Promise<IntegrationTokenRecord | null> {
  if (!token.refreshToken) {
    await markError(token.id, 'No refresh token available');
    return null;
  }

  try {
    const refreshToken = decrypt(token.refreshToken);
    const refreshFn = REFRESH_HANDLERS[token.provider];
    if (!refreshFn) {
      logger.warn(`[tokenManager] No refresh handler for provider: ${token.provider}`);
      return null;
    }

    const newTokens = await refreshFn(refreshToken, token.metadata);
    const expiresAt = new Date(Date.now() + (newTokens.expiresIn || 3600) * 1000);

    const updated = await prisma.integrationToken.update({
      where: { id: token.id },
      data: {
        accessToken: encrypt(newTokens.accessToken),
        refreshToken: newTokens.refreshToken ? encrypt(newTokens.refreshToken) : token.refreshToken,
        expiresAt,
        status: 'active',
      },
    });
    logger.info(`[tokenManager] Refreshed token for ${token.provider}/${token.scope}`);
    return updated;
  } catch (err) {
    logger.error(`[tokenManager] Refresh failed for ${token.provider}/${token.scope}:`, err);
    await markError(token.id, String((err as { message?: string })?.message || err));
    return null;
  }
}

async function markError(tokenId: string, reason: string): Promise<void> {
  await prisma.integrationToken.update({
    where: { id: tokenId },
    data: { status: 'error', metadata: { error: reason, errorAt: new Date().toISOString() } },
  }).catch(() => { /* no-op: best-effort error-status update; token refresh continues regardless */ });
}

const REFRESH_HANDLERS: Record<string, (refreshToken: string, metadata: Prisma.JsonValue) => Promise<RefreshResponse>> = {
  microsoft: async (refreshToken, metadata) => {
    const tenantId = (metadata as Prisma.JsonObject)?.tenantId as string || 'common';
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Microsoft OAuth not configured');

    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Microsoft refresh failed: ${res.status}`);
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  },

  atlassian: async (refreshToken) => {
    const clientId = process.env.ATLASSIAN_CLIENT_ID;
    const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Atlassian OAuth not configured');

    const res = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Atlassian refresh failed: ${res.status}`);
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  },
};

export async function refreshExpiring(): Promise<void> {
  const threshold = new Date(Date.now() + 10 * 60 * 1000);
  const expiring = await prisma.integrationToken.findMany({
    where: { status: 'active', expiresAt: { lte: threshold } },
  });

  for (const token of expiring) {
    await tryRefresh(token);
  }

  if (expiring.length > 0) {
    logger.info(`[tokenManager] Checked ${expiring.length} expiring token(s)`);
  }
}

let refreshInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoRefresh(): void {
  if (refreshInterval) return;
  refreshInterval = setInterval(() => {
    refreshExpiring().catch(err => logger.error('[tokenManager] Auto-refresh error:', err));
  }, 5 * 60 * 1000);
  logger.info('[tokenManager] Auto-refresh started (interval: 5min)');
}

export function stopAutoRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}
