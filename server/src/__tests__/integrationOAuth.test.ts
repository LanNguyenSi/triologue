/**
 * Security tests for:
 *   - src/services/integrationOAuth.ts (unit)
 *   - src/routes/integrations.ts DELETE /by-id/:id and GET /oauth/start (route)
 *
 * Guards tested:
 *   1. createOAuthState returns a base64-encoded state token containing the nonce.
 *   2. consumeOAuthState is one-time: first consume returns data, second returns null.
 *   3. buildOAuthAuthorizeUrl throws when the provider CLIENT_ID is missing.
 *   4. DELETE /by-id/:id — ownership: only the token owner can delete (404 for others).
 *   5. GET /oauth/start — promoteOAuthStartToken rejects byoa_ tokens with 401.
 *
 * Mutation-check intent:
 *   - Remove `oauthNonces.delete(nonce)` from consumeOAuthState → second consume
 *     succeeds instead of returning null (one-time-nonce test fails).
 *   - Remove the `!integration || integration.userId !== req.user.id` → 404 guard →
 *     other users can delete integrations they don't own.
 *   - Remove the byoa_ check in promoteOAuthStartToken → agent tokens can start
 *     OAuth flows.
 */

let currentUser = {
  id: 'user-1',
  username: 'user1',
  userType: 'HUMAN',
  displayName: 'User 1',
  isAdmin: false,
};

jest.mock('../middleware/auth', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user: unknown }).user = currentUser;
    next();
  },
}));

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    integrationToken: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../services/tokenManager', () => ({
  getToken: jest.fn().mockResolvedValue(null),
  getTokenForUser: jest.fn().mockResolvedValue(null),
  listIntegrations: jest.fn().mockResolvedValue([]),
}));

jest.mock('../connectors/registry', () => ({
  listEnabledConnectors: jest.fn().mockReturnValue([]),
  getEnabledConnector: jest.fn().mockReturnValue(null),
  initConnectors: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import prisma from '../lib/prisma';
import { createOAuthState, consumeOAuthState, buildOAuthAuthorizeUrl } from '../services/integrationOAuth';
import integrationsRouter from '../routes/integrations';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', integrationsRouter);
  return app;
}

beforeEach(() => {
  currentUser = {
    id: 'user-1',
    username: 'user1',
    userType: 'HUMAN',
    displayName: 'User 1',
    isAdmin: false,
  };
  jest.clearAllMocks();
  delete process.env.MICROSOFT_CLIENT_ID;
  delete process.env.ATLASSIAN_CLIENT_ID;
  delete process.env.MICROSOFT_TENANT_ID;
});

// ── 1. createOAuthState — nonce generation ────────────────────────────────

describe('createOAuthState', () => {
  it('returns a base64url-encoded state string containing provider and scope', () => {
    const state = createOAuthState({
      provider: 'microsoft',
      scope: 'teams',
      userId: 'user-1',
      mode: 'user',
      targetPath: '/settings',
    });

    expect(typeof state).toBe('string');
    expect(state.length).toBeGreaterThan(0);

    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    expect(decoded.provider).toBe('microsoft');
    expect(decoded.scope).toBe('teams');
    expect(typeof decoded.nonce).toBe('string');
    expect(decoded.nonce.length).toBeGreaterThan(0);
  });

  it('generates a unique nonce on each call (not deterministic)', () => {
    const payload = {
      provider: 'microsoft' as const,
      scope: 'teams',
      userId: 'user-1',
      mode: 'user' as const,
      targetPath: '/settings',
    };
    const state1 = createOAuthState(payload);
    const state2 = createOAuthState(payload);

    const n1 = JSON.parse(Buffer.from(state1, 'base64url').toString()).nonce;
    const n2 = JSON.parse(Buffer.from(state2, 'base64url').toString()).nonce;
    expect(n1).not.toBe(n2);
  });
});

// ── 2. consumeOAuthState — one-time nonce ────────────────────────────────

describe('consumeOAuthState — one-time nonce', () => {
  it('first consume returns the payload', () => {
    const state = createOAuthState({
      provider: 'atlassian',
      scope: 'jira',
      userId: 'user-1',
      mode: 'user',
      targetPath: '/settings',
    });

    const result = consumeOAuthState(state);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe('atlassian');
    expect(result!.scope).toBe('jira');
    expect(result!.userId).toBe('user-1');
  });

  it('second consume of the same state returns null (one-time guard)', async () => {
    // Mutation target: if oauthNonces.delete(nonce) is removed from consumeOAuthState,
    // the second consume returns data instead of null and this assertion fails.
    const state = createOAuthState({
      provider: 'microsoft',
      scope: 'sharepoint',
      userId: 'user-2',
      mode: 'user',
      targetPath: '/settings',
    });

    const first = consumeOAuthState(state);
    expect(first).not.toBeNull();

    const second = consumeOAuthState(state);
    expect(second).toBeNull(); // nonce already consumed
  });

  it('returns null for a malformed state token', () => {
    expect(consumeOAuthState('not-base64url')).toBeNull();
    expect(consumeOAuthState('')).toBeNull();
    expect(consumeOAuthState(Buffer.from('{}').toString('base64url'))).toBeNull();
  });
});

// ── 3. buildOAuthAuthorizeUrl — missing CLIENT_ID throws ─────────────────

describe('buildOAuthAuthorizeUrl — missing CLIENT_ID', () => {
  it('throws when MICROSOFT_CLIENT_ID is absent', () => {
    delete process.env.MICROSOFT_CLIENT_ID;
    const state = createOAuthState({
      provider: 'microsoft',
      scope: 'teams',
      userId: 'user-1',
      mode: 'user',
      targetPath: '/settings',
    });

    expect(() =>
      buildOAuthAuthorizeUrl('microsoft', 'teams', state),
    ).toThrow(/Microsoft OAuth not configured/i);
  });

  it('throws when ATLASSIAN_CLIENT_ID is absent', () => {
    delete process.env.ATLASSIAN_CLIENT_ID;
    const state = createOAuthState({
      provider: 'atlassian',
      scope: 'jira',
      userId: 'user-1',
      mode: 'user',
      targetPath: '/settings',
    });

    expect(() =>
      buildOAuthAuthorizeUrl('atlassian', 'jira', state),
    ).toThrow(/Atlassian OAuth not configured/i);
  });

  it('returns a URL when MICROSOFT_CLIENT_ID is set', () => {
    process.env.MICROSOFT_CLIENT_ID = 'test-ms-client-id';
    const state = createOAuthState({
      provider: 'microsoft',
      scope: 'teams',
      userId: 'user-1',
      mode: 'user',
      targetPath: '/settings',
    });

    const url = buildOAuthAuthorizeUrl('microsoft', 'teams', state);
    expect(url).toContain('microsoftonline.com');
    expect(url).toContain('test-ms-client-id');
  });
});

// ── 4. DELETE /by-id/:id — ownership guard ────────────────────────────────

describe('DELETE /api/integrations/by-id/:id — ownership guard', () => {
  it('returns 200 when the user owns the integration', async () => {
    // Mutation target: remove the `integration.userId !== req.user.id` check →
    // any authenticated user can delete any integration.
    (prisma.integrationToken.findUnique as jest.Mock).mockResolvedValue({
      id: 'int-1',
      userId: 'user-1',
    });
    (prisma.integrationToken.update as jest.Mock).mockResolvedValue({});
    const app = buildApp();

    const res = await request(app).delete('/api/integrations/by-id/int-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prisma.integrationToken.update as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'revoked' }),
      }),
    );
  });

  it('returns 404 when the integration belongs to another user (ownership guard)', async () => {
    (prisma.integrationToken.findUnique as jest.Mock).mockResolvedValue({
      id: 'int-2',
      userId: 'user-2', // belongs to user-2, not user-1
    });
    const app = buildApp();

    const res = await request(app).delete('/api/integrations/by-id/int-2');

    expect(res.status).toBe(404);
    // Must not have been revoked.
    expect(prisma.integrationToken.update as jest.Mock).not.toHaveBeenCalled();
  });

  it('returns 404 when the integration does not exist', async () => {
    (prisma.integrationToken.findUnique as jest.Mock).mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app).delete('/api/integrations/by-id/nonexistent');

    expect(res.status).toBe(404);
  });
});

// ── 5. GET /oauth/start — byoa_ token rejected ────────────────────────────

describe('GET /api/integrations/oauth/start — promoteOAuthStartToken', () => {
  it('returns 401 when a byoa_ token is passed as a query-param token', async () => {
    // Mutation target: remove the byoa_ prefix check in promoteOAuthStartToken →
    // agent tokens could start OAuth flows on behalf of human users.
    const app = buildApp();

    const res = await request(app)
      .get('/api/integrations/oauth/start')
      .query({
        provider: 'microsoft',
        scope: 'teams',
        token: 'byoa_some_agent_token',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/agent tokens cannot start/i);
  });

  it('proceeds past promoteOAuthStartToken when no byoa_ prefix on token', async () => {
    // Without MICROSOFT_CLIENT_ID the route will return 500 (config error),
    // but that proves promoteOAuthStartToken did NOT block it.
    process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
    const app = buildApp();

    const res = await request(app)
      .get('/api/integrations/oauth/start')
      .query({ provider: 'microsoft', scope: 'teams' });

    // The authenticate middleware (mocked) passes through; then createOAuthState
    // + buildOAuthAuthorizeUrl succeed and we get a redirect (302).
    expect(res.status).toBe(302);
  });
});
