/**
 * Admin Routes — Invite Codes + AI Trigger Management
 * Lava 🌋 — 2026-02-19
 */
import { Router } from 'express';
import crypto from 'crypto';
import { authenticate } from '../middleware/auth';
import prisma from '../lib/prisma';
import { storeToken, revokeToken, listIntegrations } from '../services/tokenManager';
import { discoverTools, getActiveConnections } from '../connectors/mcp/mcpBridge';
import { listConnectors, getConnector } from '../connectors/registry';
import { getToken } from '../services/tokenManager';
import { logAuditEvent } from '../services/auditService';
import { buildOAuthAuthorizeUrl, consumeOAuthState, createOAuthState } from '../services/integrationOAuth';

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


router.get('/connectors', authenticate, requireAdmin, async (_req, res) => {
  try {
    const now = Date.now();
    const expirationWindow = now + 24 * 60 * 60 * 1000;
    const connectors = listConnectors();
    const integrations = await listIntegrations();

    const items = await Promise.all(
      connectors.map(async (connector) => {
        const definition = getConnector(connector.id) || connector;
        const integration = integrations.find(
          (item) => item.provider === definition.auth.provider && item.scope === definition.auth.scope,
        );

        let status: 'connected' | 'expiring' | 'expired' | 'error' | 'disconnected' = 'disconnected';

        if (integration) {
          if (integration.status === 'error' || integration.status === 'revoked') {
            status = 'error';
          } else if (integration.status === 'active') {
            const expiresAt = new Date(integration.expiresAt).getTime();
            if (expiresAt <= now) {
              status = 'expired';
            } else if (expiresAt <= expirationWindow) {
              status = 'expiring';
            } else {
              status = 'connected';
            }
            if (status === 'connected' || status === 'expiring') {
              const currentToken = await getToken(
                definition.auth.provider,
                definition.auth.scope,
                integration.tenantId || undefined,
              );
              if (!currentToken) {
                status = 'expired';
              }
            }
          }
        }

        return {
          id: definition.id,
          name: definition.name,
          provider: definition.provider,
          scope: definition.auth.scope,
          icon: definition.icon,
          category: definition.category,
          status,
          userConnectionCount: integrations.filter(
            (item) =>
              item.provider === definition.auth.provider &&
              item.scope === definition.auth.scope &&
              Boolean(item.userId),
          ).length,
          ...(integration ? { integrationId: integration.id } : {}),
          actions: definition.actions.map((action) => ({
            id: action.id,
            name: action.name,
            description: action.description,
          })),
        };
      }),
    );

    return res.json({ items });
  } catch {
    return res.status(500).json({ error: 'Failed to list connectors' });
  }
});

router.get('/integrations/oauth/start', authenticate, requireAdmin, async (req, res) => {
  const provider = String(req.query.provider || '').trim().toLowerCase();
  const scope = String(req.query.scope || 'default').trim();

  if (provider !== 'microsoft' && provider !== 'atlassian') {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  try {
    const state = createOAuthState({
      provider,
      scope,
      userId: req.user!.id,
      mode: 'admin',
      targetPath: '/admin/connectors',
    });
    return res.redirect(buildOAuthAuthorizeUrl(provider, scope, state));
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'OAuth configuration missing' });
  }
});

router.get('/integrations/oauth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.redirect('/admin/connectors?error=oauth_failed');

    const nonceData = consumeOAuthState(String(state));
    if (!nonceData) return res.redirect('/admin/connectors?error=invalid_state');
    const provider = nonceData.provider;
    const scope = nonceData.scope;
    const targetPath = nonceData.targetPath || '/admin/connectors';

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

      if (!tokenRes.ok) { const errBody = await tokenRes.text(); console.error("[admin] Token exchange failed:", errBody); return res.redirect(`/admin/connectors?error=token_exchange_failed&detail=${encodeURIComponent(errBody.slice(0, 200))}`); }

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

      if (!tokenRes.ok) { const errBody = await tokenRes.text(); console.error("[admin] Token exchange failed:", errBody); return res.redirect(`/admin/connectors?error=token_exchange_failed&detail=${encodeURIComponent(errBody.slice(0, 200))}`); }

      const tokens: any = await tokenRes.json();
      await storeToken(provider, scope, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in || 3600,
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
    return res.redirect(`/admin/connectors?error=oauth_failed&detail=${encodeURIComponent(String(err?.message || 'unknown'))}`);
  }
});

router.delete('/integrations/by-id/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const integration = await (prisma as any).integrationToken.findUnique({
      where: { id: req.params.id },
      select: { id: true, provider: true, scope: true },
    });

    if (!integration) return res.status(404).json({ error: 'Integration not found' });

    await (prisma as any).integrationToken.update({
      where: { id: req.params.id },
      data: { status: 'revoked' },
    });

    logAuditEvent({
      agentId: req.user!.id,
      action: 'integration.revoked',
      resourceType: 'integration_token',
      resourceId: req.params.id,
      details: { provider: integration.provider, scope: integration.scope },
    });

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to revoke integration' });
  }
});

router.post('/connectors/:connectorId/test/:actionId', authenticate, requireAdmin, async (req, res) => {
  const { connectorId, actionId } = req.params;
  const start = Date.now();

  try {
    const connector = getConnector(connectorId);
    if (!connector) return res.status(404).json({ error: 'Connector not found' });

    const action = connector.actions.find((a) => a.id === actionId);
    if (!action) return res.status(404).json({ error: 'Action not found' });

    const oauthToken = await getToken(connector.auth.provider, connector.auth.scope);
    if (!oauthToken) return res.status(503).json({ error: 'Integration not connected or token expired' });

    const input = req.body || {};
    const url = action.urlTemplate.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = input[key];
      return val !== undefined ? encodeURIComponent(String(val)) : '';
    });

    const fetchOptions: RequestInit = {
      method: action.method,
      headers: { Authorization: `Bearer ${oauthToken}`, 'Content-Type': 'application/json' },
    };
    if (action.method !== 'GET' && action.method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(input);
    }

    const externalRes = await fetch(url, fetchOptions);
    const responseData = action.responseType === 'text'
      ? await externalRes.text()
      : await externalRes.json().catch(async () => await externalRes.text());

    logAuditEvent({
      agentId: req.user!.id,
      action: 'connector.test',
      resourceType: 'connector',
      resourceId: connectorId,
      details: { actionId, url, method: action.method, status: externalRes.status },
      success: externalRes.ok,
      durationMs: Date.now() - start,
    });

    return res.json({
      success: externalRes.ok,
      status: externalRes.status,
      data: responseData,
      durationMs: Date.now() - start,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Test failed', durationMs: Date.now() - start });
  }
});

export default router;
