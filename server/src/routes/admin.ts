/**
 * Admin Routes — Invite Codes + AI Trigger Management
 * Lava 🌋 — 2026-02-19
 */
import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth';
import prisma from '../lib/prisma';
import { storeToken } from '../services/tokenManager';
import { logAuditEvent } from '../services/auditService';
import { consumeOAuthState } from '../services/integrationOAuth';

const router = Router();
const DEFAULT_USER_LIMIT = 12;
const MAX_USER_LIMIT = 100;
const DEFAULT_INVITE_LIMIT = 12;
const MAX_INVITE_LIMIT = 100;

// Middleware: require admin
const requireAdmin = async (req: any, res: any, next: any) => {
  const user = await prisma.user.findUnique({ where: { id: req.user?.id } });
  if (!user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// GET /admin/users — list human users with AI trigger status
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? DEFAULT_USER_LIMIT), 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(rawLimit, MAX_USER_LIMIT))
      : DEFAULT_USER_LIMIT;
    const rawPage = Number.parseInt(String(req.query.page ?? 1), 10);
    const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
    const skip = (page - 1) * limit;
    const where = {
      userType: 'HUMAN' as const,
    };

    const [totalCount, users] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          displayName: true,
          userType: true,
          isAdmin: true,
          canTriggerAI: true,
          isActive: true,
          createdAt: true,
          lastSeen: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const hasMore = page < totalPages;

    // Keep `users` for backward compatibility; new clients can use pagination metadata.
    res.json({
      users,
      items: users,
      totalCount,
      pageInfo: {
        page,
        limit,
        totalPages,
        hasMore,
        nextPage: hasMore ? page + 1 : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PATCH /admin/users/:username/ai-trigger — toggle canTriggerAI
router.patch('/users/:username/ai-trigger', authenticate, requireAdmin, async (req, res) => {
  try {
    const { username } = req.params;
    const { canTriggerAI } = req.body;

    if (typeof canTriggerAI !== 'boolean') {
      return res.status(400).json({ error: 'canTriggerAI must be boolean' });
    }

    const existing = await prisma.user.findUnique({
      where: { username },
      select: { id: true, userType: true },
    });
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (existing.userType !== 'HUMAN') {
      return res.status(400).json({ error: 'Only human users can be updated here' });
    }

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { canTriggerAI },
      select: { username: true, canTriggerAI: true },
    });

    res.json({ success: true, user });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// GET /admin/invite-codes — list all invite codes
router.get('/invite-codes', authenticate, requireAdmin, async (req, res) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? DEFAULT_INVITE_LIMIT), 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(rawLimit, MAX_INVITE_LIMIT))
      : DEFAULT_INVITE_LIMIT;
    const rawPage = Number.parseInt(String(req.query.page ?? 1), 10);
    const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
    const skip = (page - 1) * limit;
    const hasPaginationQuery = req.query.limit !== undefined || req.query.page !== undefined;

    const [totalCount, codes] = await prisma.$transaction([
      prisma.inviteCode.count(),
      prisma.inviteCode.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(hasPaginationQuery ? { skip, take: limit } : {}),
      }),
    ]);

    if (!hasPaginationQuery) {
      return res.json({ codes });
    }

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const hasMore = page < totalPages;

    res.json({
      codes,
      items: codes,
      totalCount,
      pageInfo: {
        page,
        limit,
        totalPages,
        hasMore,
        nextPage: hasMore ? page + 1 : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch invite codes' });
  }
});

// POST /admin/invite-codes — create new invite code
router.post('/invite-codes', authenticate, requireAdmin, async (req, res) => {
  try {
    const { maxUses = 1, expiresInDays } = req.body;

    const code = crypto.randomBytes(6).toString('hex').toUpperCase(); // e.g. A1B2C3
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400000)
      : null;

    const invite = await prisma.inviteCode.create({
      data: {
        code,
        createdById: req.user?.id || '',
        maxUses: Number(maxUses),
        expiresAt,
      },
    });

    res.status(201).json({ invite });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create invite code' });
  }
});

// DELETE /admin/invite-codes/:code — delete invite code
router.delete('/invite-codes/:code', authenticate, requireAdmin, async (req, res) => {
  try {
    await prisma.inviteCode.delete({ where: { code: req.params.code } });
    res.json({ success: true });
  } catch (err: any) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Code not found' });
    res.status(500).json({ error: 'Failed to delete code' });
  }
});

router.get('/integrations/oauth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.redirect('/admin?error=oauth_failed');

    const nonceData = consumeOAuthState(String(state));
    if (!nonceData) return res.redirect('/admin?error=invalid_state');
    const provider = nonceData.provider;
    const scope = nonceData.scope;
    const targetPath = nonceData.targetPath || '/admin';

    if (provider === 'microsoft') {
      const clientId = process.env.MICROSOFT_CLIENT_ID!;
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!;
      const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
      const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:3000'}/api/admin/integrations/oauth/callback`;

      const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: String(code),
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) { const errBody = await tokenRes.text(); console.error("[admin] Token exchange failed:", errBody); return res.redirect(`/admin?error=token_exchange_failed&detail=${encodeURIComponent(errBody.slice(0, 200))}`); }

      const tokens: any = await tokenRes.json();
      await storeToken(provider, scope, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in || 3600,
        tenantId,
      }, nonceData.userId, nonceData.mode === 'user' ? nonceData.userId : null);

      logAuditEvent({
        agentId: nonceData.userId,
        action: 'integration.oauth.connected',
        resourceType: 'integration_token',
        details: { provider, scope },
      });

      return res.redirect(`${targetPath}?success=1`);
    }

    if (provider === 'atlassian') {
      const clientId = process.env.ATLASSIAN_CLIENT_ID!;
      const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET!;
      const redirectUri = process.env.ATLASSIAN_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:3000'}/api/admin/integrations/oauth/callback`;

      const tokenRes = await fetch('https://auth.atlassian.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code: String(code),
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) { const errBody = await tokenRes.text(); console.error("[admin] Token exchange failed:", errBody); return res.redirect(`/admin?error=token_exchange_failed&detail=${encodeURIComponent(errBody.slice(0, 200))}`); }

      const tokens: any = await tokenRes.json();

      // Fetch accessible Atlassian cloud resources to get tenantId (cloudId)
      let tenantId: string | null = null;
      try {
        const resourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
          headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
        });
        if (resourcesRes.ok) {
          const resources: any[] = await resourcesRes.json();
          if (resources.length > 0) {
            tenantId = resources[0].id; // cloudId of the first Jira site
          }
        }
      } catch (e) {
        console.warn('[admin] Could not fetch Atlassian cloud resources:', e);
      }

      await storeToken(provider, scope, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in || 3600,
        tenantId: tenantId || 'default',
      }, nonceData.userId, nonceData.mode === 'user' ? nonceData.userId : null);

      logAuditEvent({
        agentId: nonceData.userId,
        action: 'integration.oauth.connected',
        resourceType: 'integration_token',
        details: { provider, scope },
      });

      return res.redirect(`${targetPath}?success=1`);
    }

    return res.redirect(`${targetPath}?error=oauth_failed`);
  } catch (err: any) {
    console.error('[admin] OAuth callback error:', err?.message || err);
    return res.redirect(`/admin?error=oauth_failed&detail=${encodeURIComponent(String(err?.message || 'unknown'))}`);
  }
});

export default router;
