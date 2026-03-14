/**
 * Admin Routes — Invite Codes + AI Trigger Management
 * Lava 🌋 — 2026-02-19
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { storeToken, revokeToken, listIntegrations } from '../services/tokenManager';
import { discoverTools, getActiveConnections } from '../connectors/mcp/mcpBridge';

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

router.get('/integrations', authenticate, requireAdmin, async (_req, res) => {
  try {
    const items = await listIntegrations();
    return res.json({ items });
  } catch (err) {
    console.error('[admin] integrations list error:', err);
    return res.status(500).json({ error: 'Failed to list integrations' });
  }
});

router.get('/integrations/:provider/connect', authenticate, requireAdmin, async (req, res) => {
  const { provider } = req.params;
  const scope = String(req.query.scope || 'default');
  const state = Buffer.from(JSON.stringify({ provider, scope, userId: req.user!.id })).toString('base64url');

  if (provider === 'microsoft') {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'Microsoft OAuth not configured' });
    const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/api/admin/integrations/microsoft/callback`;
    const scopes = String(req.query.scopes || 'https://graph.microsoft.com/.default offline_access');
    const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}&response_mode=query`;
    return res.redirect(url);
  }

  if (provider === 'atlassian') {
    const clientId = process.env.ATLASSIAN_CLIENT_ID;
    if (!clientId) return res.status(500).json({ error: 'Atlassian OAuth not configured' });
    const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/api/admin/integrations/atlassian/callback`;
    const scopes = String(req.query.scopes || 'read:jira-work write:jira-work offline_access');
    const url = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${clientId}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&response_type=code&prompt=consent`;
    return res.redirect(url);
  }

  return res.status(400).json({ error: `Unknown provider: ${provider}` });
});

router.get('/integrations/:provider/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).json({ error: 'Missing code or state' });

    const stateData = JSON.parse(Buffer.from(String(state), 'base64url').toString());
    const { provider, scope, userId } = stateData;

    if (provider === 'microsoft') {
      const clientId = process.env.MICROSOFT_CLIENT_ID!;
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!;
      const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/api/admin/integrations/microsoft/callback`;

      const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: String(code),
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        return res.status(400).json({ error: 'Token exchange failed', details: errBody });
      }

      const tokens: any = await tokenRes.json();
      await storeToken(provider, scope, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in || 3600,
        tenantId: stateData.tenantId,
      }, userId);

      return res.redirect('/admin?integration=connected');
    }

    if (provider === 'atlassian') {
      const clientId = process.env.ATLASSIAN_CLIENT_ID!;
      const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET!;
      const redirectUri = `${process.env.APP_URL || 'http://localhost:3000'}/api/admin/integrations/atlassian/callback`;

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

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        return res.status(400).json({ error: 'Token exchange failed', details: errBody });
      }

      const tokens: any = await tokenRes.json();
      await storeToken(provider, scope, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in || 3600,
      }, userId);

      return res.redirect('/admin?integration=connected');
    }

    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  } catch (err) {
    console.error('[admin] OAuth callback error:', err);
    return res.status(500).json({ error: 'OAuth callback failed' });
  }
});

router.delete('/integrations/:provider', authenticate, requireAdmin, async (req, res) => {
  try {
    const scope = String(req.query.scope || 'default');
    const tenantId = req.query.tenantId ? String(req.query.tenantId) : undefined;
    await revokeToken(req.params.provider, scope, tenantId);
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin] integration revoke error:', err);
    return res.status(500).json({ error: 'Failed to revoke integration' });
  }
});


router.post('/connectors/mcp', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, transport, url, apiKey } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'name and url required' });

    const connection = await (prisma as any).mcpConnection.create({
      data: {
        name: name.trim(),
        transport: transport || 'sse',
        url: url.trim(),
        apiKey: apiKey || null,
        createdBy: req.user!.id,
      },
    });

    try {
      const tools = await discoverTools(connection.id);
      return res.status(201).json({ ...connection, discoveredTools: tools });
    } catch {
      return res.status(201).json({ ...connection, warning: 'Connection created but tool discovery failed' });
    }
  } catch (err) {
    console.error('[admin] MCP register error:', err);
    return res.status(500).json({ error: 'Failed to register MCP server' });
  }
});

router.get('/connectors/mcp', authenticate, requireAdmin, async (_req, res) => {
  try {
    const activeConnections = await getActiveConnections();
    const connections = await (prisma as any).mcpConnection.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, transport: true, url: true,
        status: true, discoveredTools: true, lastHealthCheck: true, createdAt: true,
      },
    });
    return res.json({ items: connections, activeConnections });
  } catch (err) {
    console.error('[admin] MCP list error:', err);
    return res.status(500).json({ error: 'Failed to list MCP connections' });
  }
});

router.delete('/connectors/mcp/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await (prisma as any).mcpConnection.delete({ where: { id: req.params.id } });
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin] MCP delete error:', err);
    return res.status(500).json({ error: 'Failed to delete MCP connection' });
  }
});

router.post('/connectors/mcp/:id/rediscover', authenticate, requireAdmin, async (req, res) => {
  try {
    const tools = await discoverTools(req.params.id);
    return res.json({ tools });
  } catch (err) {
    console.error('[admin] MCP rediscover error:', err);
    return res.status(500).json({ error: 'Tool discovery failed' });
  }
});

export default router;
