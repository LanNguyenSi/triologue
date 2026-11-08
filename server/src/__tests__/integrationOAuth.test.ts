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
 *   5. GET /oauth/start: only a purpose-bound `st` token (or an Authorization
 *      header) authenticates; the session JWT in the query is refused. POST
 *      /oauth/start-token mints that token and refuses byoa_ agent tokens.
 *
 * Mutation-check intent:
 *   - Remove `oauthNonces.delete(nonce)` from consumeOAuthState → second consume
 *     succeeds instead of returning null (one-time-nonce test fails).
 *   - Remove the `!integration || integration.userId !== req.user.id` → 404 guard →
 *     other users can delete integrations they don't own.
 *   - Remove requireHuman from POST /oauth/start-token → agent tokens can start
 *     OAuth flows. See section 5 for the start-token mutants.
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
  // The real helper: the route's human-only gate is part of what is tested.
  requireHuman: jest.requireActual('../middleware/auth').requireHuman,
}));

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    integrationToken: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock('../services/tokenManager', () => ({
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
import jwt from 'jsonwebtoken';
import request from './helpers/loopbackRequest';
import prisma from '../lib/prisma';
import { createOAuthState, consumeOAuthState, buildOAuthAuthorizeUrl } from '../services/integrationOAuth';
import integrationsRouter from '../routes/integrations';
import { mintFileToken, mintOAuthStartToken } from '../lib/scopedToken';

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

// ── 5. OAuth start: purpose-bound `st` token, never the session JWT ────────
//
// Mutation-check intent:
//   - Re-add the `?token=` → Authorization promotion in authenticateOAuthStart
//     → the session-JWT-in-query test gets 302 instead of 401.
//   - Drop `verifyOAuthStartToken` (accept any `st`) → the forged / other
//     provider / other scope / expired / file-purpose tests go red.
//   - Drop the `!user.isActive` check → the deactivated-user test goes red.
//   - Drop requireHuman from POST /oauth/start-token or GET /oauth/start → the agent-token test
//     goes red.

describe('GET /api/integrations/oauth/start, st token', () => {
  const START = '/api/integrations/oauth/start';

  beforeEach(() => {
    process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'user-1',
      username: 'user1',
      userType: 'HUMAN',
      displayName: 'User 1',
      isAdmin: false,
      isActive: true,
      canTriggerAI: false,
    });
  });

  it('redirects (302) for a valid st token bound to this provider and scope', async () => {
    const { token } = mintOAuthStartToken('microsoft', 'teams', 'user-1');

    const res = await request(buildApp()).get(START).query({ provider: 'microsoft', scope: 'teams', st: token });

    expect(res.status).toBe(302);
    expect(prisma.user.findUnique as jest.Mock).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('refuses the session JWT in ?token= (401) without starting a flow', async () => {
    const session = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!);

    const res = await request(buildApp()).get(START).query({ provider: 'microsoft', scope: 'teams', token: session });

    expect(res.status).toBe(401);
    expect(res.headers.location).toBeUndefined();
  });

  it('refuses a byoa_ token in ?token= (401)', async () => {
    const res = await request(buildApp())
      .get(START)
      .query({ provider: 'microsoft', scope: 'teams', token: 'byoa_some_agent_token' });

    expect(res.status).toBe(401);
  });

  it('refuses the session JWT in ?st= (401)', async () => {
    const session = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!);

    const res = await request(buildApp()).get(START).query({ provider: 'microsoft', scope: 'teams', st: session });

    expect(res.status).toBe(401);
  });

  it('refuses a request without any credential (401)', async () => {
    const res = await request(buildApp()).get(START).query({ provider: 'microsoft', scope: 'teams' });

    expect(res.status).toBe(401);
  });

  it('refuses an st token for another scope, another provider, or after expiry', async () => {
    const { token } = mintOAuthStartToken('microsoft', 'teams', 'user-1');
    const app = buildApp();

    expect((await request(app).get(START).query({ provider: 'microsoft', scope: 'default', st: token })).status).toBe(401);
    expect((await request(app).get(START).query({ provider: 'atlassian', scope: 'teams', st: token })).status).toBe(401);

    const old = mintOAuthStartToken('microsoft', 'teams', 'user-1', Date.now() - 10 * 60 * 1000);
    expect((await request(app).get(START).query({ provider: 'microsoft', scope: 'teams', st: old.token })).status).toBe(401);
  });

  it('refuses a forged signature and a token of another purpose (file token)', async () => {
    const { token } = mintOAuthStartToken('microsoft', 'teams', 'user-1');
    const forged = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    const fileToken = mintFileToken('microsoft:teams', 'user-1').token;
    const app = buildApp();

    expect((await request(app).get(START).query({ provider: 'microsoft', scope: 'teams', st: forged })).status).toBe(401);
    expect((await request(app).get(START).query({ provider: 'microsoft', scope: 'teams', st: fileToken })).status).toBe(401);
  });

  it('refuses a valid token once the user is deactivated or gone', async () => {
    const { token } = mintOAuthStartToken('microsoft', 'teams', 'user-1');
    const app = buildApp();

    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1', isActive: false });
    expect((await request(app).get(START).query({ provider: 'microsoft', scope: 'teams', st: token })).status).toBe(401);

    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    expect((await request(app).get(START).query({ provider: 'microsoft', scope: 'teams', st: token })).status).toBe(401);
  });

  it('refuses a non-HUMAN user on the start route as well (403), for the header and the st path', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
    currentUser = { ...currentUser, userType: 'AI_AGENT' };
    const app = buildApp();

    const viaHeader = await request(app).get(START).set('Authorization', 'Bearer header-jwt').query({ provider: 'microsoft', scope: 'teams' });
    expect(viaHeader.status).toBe(403);

    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'agent-1', username: 'a', userType: 'AI_AGENT', displayName: 'A', isAdmin: false, isActive: true });
    const { token } = mintOAuthStartToken('microsoft', 'teams', 'agent-1');
    const viaSt = await request(app).get(START).query({ provider: 'microsoft', scope: 'teams', st: token });
    expect(viaSt.status).toBe(403);
  });

  it('still returns 400 for an unknown provider with a valid header (authenticate path)', async () => {
    const res = await request(buildApp())
      .get(START)
      .set('Authorization', 'Bearer header-jwt')
      .query({ provider: 'github' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/integrations/oauth/start-token', () => {
  const MINT = '/api/integrations/oauth/start-token';

  it('mints a token that the start route accepts, and it is not the session JWT', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1', username: 'u', userType: 'HUMAN', displayName: 'U', isAdmin: false, isActive: true });
    const app = buildApp();

    const minted = await request(app).post(MINT).set('Authorization', 'Bearer header-jwt').send({ provider: 'Microsoft', scope: ' teams ' });

    expect(minted.status).toBe(200);
    expect(minted.body.expiresIn).toBeGreaterThan(0);
    expect(minted.body.expiresIn).toBeLessThanOrEqual(120);
    expect(minted.body.token).not.toContain('header-jwt');
    const started = await request(app).get('/api/integrations/oauth/start').query({ provider: 'microsoft', scope: 'teams', st: minted.body.token });
    expect(started.status).toBe(302);
  });

  it('defaults the scope to "default" on both sides', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'test-client-id';
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1', username: 'u', userType: 'HUMAN', displayName: 'U', isAdmin: false, isActive: true });
    const app = buildApp();

    const minted = await request(app).post(MINT).set('Authorization', 'Bearer header-jwt').send({ provider: 'microsoft' });
    const started = await request(app).get('/api/integrations/oauth/start').query({ provider: 'microsoft', st: minted.body.token });

    expect(started.status).toBe(302);
  });

  it('returns 400 for an unknown provider', async () => {
    const res = await request(buildApp()).post(MINT).set('Authorization', 'Bearer header-jwt').send({ provider: 'github' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when the body is missing', async () => {
    const res = await request(buildApp()).post(MINT).set('Authorization', 'Bearer header-jwt');

    expect(res.status).toBe(400);
  });

  it('refuses a non-HUMAN user (403) and mints nothing; oauth-start-auth.test.ts covers the real authenticate middleware', async () => {
    currentUser = { ...currentUser, userType: 'AI_AGENT' };

    const res = await request(buildApp()).post(MINT).set('Authorization', 'Bearer header-jwt').send({ provider: 'microsoft' });

    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
  });
});
