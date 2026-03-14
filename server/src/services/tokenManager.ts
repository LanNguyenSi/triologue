import crypto from 'crypto';
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
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  metadata: any;
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

export async function storeToken(
  provider: string,
  scope: string,
  tokens: OAuthTokens,
  createdBy: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
  const tenantId = tokens.tenantId || null;
  const data = {
    provider,
    scope,
    accessToken: encrypt(tokens.accessToken),
    refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    expiresAt,
    tenantId,
    metadata: tokens.metadata || {},
    status: 'active',
    createdBy,
  };

  await (prisma as any).integrationToken.upsert({
    where: { provider_scope_tenantId: { provider, scope, tenantId } },
    create: data,
    update: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      metadata: data.metadata,
      status: data.status,
      createdBy: data.createdBy,
    },
  });
}

export async function getToken(provider: string, scope: string, tenantId?: string): Promise<string | null> {
  const token = await (prisma as any).integrationToken.findUnique({
    where: { provider_scope_tenantId: { provider, scope, tenantId: tenantId || null } },
  });
  if (!token || token.status !== 'active') return null;

  if (token.expiresAt <= new Date()) {
    const refreshed = await tryRefresh(token);
    if (!refreshed) return null;
    return decrypt(refreshed.accessToken);
  }

  return decrypt(token.accessToken);
}

export async function revokeToken(provider: string, scope: string, tenantId?: string): Promise<void> {
  await (prisma as any).integrationToken.updateMany({
    where: { provider, scope, tenantId: tenantId || null },
    data: { status: 'revoked' },
  });
}

export async function listIntegrations(): Promise<Array<{
  id: string;
  provider: string;
  scope: string;
  tenantId: string | null;
  status: string;
  expiresAt: string;
  createdBy: string;
}>> {
  const tokens = await (prisma as any).integrationToken.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      provider: true,
      scope: true,
      tenantId: true,
      status: true,
      expiresAt: true,
      createdBy: true,
      metadata: true,
    },
  });

  return tokens.map((token: any) => ({
    id: token.id,
    provider: token.provider,
    scope: token.scope,
    tenantId: token.tenantId,
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

    const updated = await (prisma as any).integrationToken.update({
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
    await markError(token.id, String((err as any)?.message || err));
    return null;
  }
}

async function markError(tokenId: string, reason: string): Promise<void> {
  await (prisma as any).integrationToken.update({
    where: { id: tokenId },
    data: { status: 'error', metadata: { error: reason, errorAt: new Date().toISOString() } },
  }).catch(() => {});
}

const REFRESH_HANDLERS: Record<string, (refreshToken: string, metadata: any) => Promise<RefreshResponse>> = {
  microsoft: async (refreshToken, metadata) => {
    const tenantId = metadata?.tenantId || 'common';
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
    const data: any = await res.json();
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
    const data: any = await res.json();
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  },
};

export async function refreshExpiring(): Promise<void> {
  const threshold = new Date(Date.now() + 10 * 60 * 1000);
  const expiring = await (prisma as any).integrationToken.findMany({
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
