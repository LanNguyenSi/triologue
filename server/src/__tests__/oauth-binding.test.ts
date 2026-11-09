/**
 * Browser binding of the OAuth account-linking flow.
 *
 *   - GET /api/integrations/oauth/start hands the initiating browser a secret
 *     as an HttpOnly, SameSite=Lax cookie (only its hash is kept server side),
 *     moves a start on the wrong host to the redirect URI's origin first, and
 *     spends each `st` token once.
 *   - GET /api/admin/integrations/oauth/callback stores provider tokens only
 *     when the browser presents the cookie of that flow, and clears the cookie
 *     on every exit.
 *
 * Precedence of the inputs (one test per combination below):
 *   - Path and host of the cookie and of the host redirect come from the
 *     provider's redirect-URI override when it is set, else from APP_URL.
 *   - `Secure` comes from APP_URL alone, never from the override or the request.
 *   - The request host decides only whether the host redirect happens.
 *
 * Mutation-check intent (each neutralised on its own, the named tests go red):
 *   - consumeOAuthState: skip the binding comparison -> no-cookie, wrong-cookie
 *     and crossed-flow tests.
 *   - consumeOAuthState: compare before deleting the nonce -> the "retry with
 *     the right cookie" test.
 *   - setOAuthBindingCookie: drop httpOnly / sameSite / maxAge / path / secure
 *     -> the attribute tests.
 *   - clearOAuthBindingCookie: drop the call in the callback -> every
 *     clears-the-cookie test.
 *   - startOnRedirectHost: always next() -> the host-redirect tests.
 *   - authenticateOAuthStart: drop claimOAuthStartToken -> the replay test.
 *   - claimOAuthStartToken / sweepOAuthState: never expire entries -> the
 *     sweep test.
 */

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    integrationToken: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

jest.mock('../services/agentTokenRotation', () => ({
  findAgentTokenByRawToken: jest.fn(),
}));

jest.mock('../services/tokenManager', () => ({
  getTokenForUser: jest.fn().mockResolvedValue(null),
  listIntegrations: jest.fn().mockResolvedValue([]),
  storeToken: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/auditService', () => ({
  logAuditEvent: jest.fn(),
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
import { storeToken } from '../services/tokenManager';
import integrationsRouter from '../routes/integrations';
import adminRouter from '../routes/admin';
import {
  claimOAuthStartToken,
  consumeOAuthState,
  createOAuthState,
  sweepOAuthState,
} from '../services/integrationOAuth';
import { mintOAuthStartToken } from '../lib/scopedToken';

const START = '/api/integrations/oauth/start';
const CALLBACK = '/api/admin/integrations/oauth/callback';
const DEFAULT_CALLBACK_PATH = '/api/admin/integrations/oauth/callback';
const FAR_FUTURE = () => Date.now() + 24 * 60 * 60 * 1000;

const human = {
  id: 'user-1',
  username: 'u',
  userType: 'HUMAN',
  displayName: 'U',
  isAdmin: false,
  isActive: true,
  canTriggerAI: false,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', integrationsRouter);
  app.use('/api/admin', adminRouter);
  return app;
}

type Flow = ReturnType<typeof createOAuthState>;

function newFlow(overrides: { provider?: 'microsoft' | 'atlassian'; scope?: string; userId?: string } = {}): Flow {
  return createOAuthState({
    provider: overrides.provider ?? 'microsoft',
    scope: overrides.scope ?? 'sharepoint',
    userId: overrides.userId ?? 'user-1',
    mode: 'user',
    targetPath: '/settings/connections',
  });
}

function cookieFor(flow: Pick<Flow, 'nonce' | 'bindingSecret'>): string {
  return `oauth_bind_${flow.nonce}=${flow.bindingSecret}`;
}

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? (raw as string[]) : [];
}

function clearingCookie(res: { headers: Record<string, unknown> }, nonce: string, path = DEFAULT_CALLBACK_PATH) {
  const found = setCookies(res).find((c) => c.startsWith(`oauth_bind_${nonce}=;`));
  expect(found).toBeDefined();
  expect(found).toContain(`Path=${path}`);
  expect(found).toMatch(/Expires=Thu, 01 Jan 1970/);
  return found!;
}

function tokenResponse(ok = true): Response {
  return {
    ok,
    text: async () => 'provider said no',
    json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  sweepOAuthState(FAR_FUTURE());
  process.env.MICROSOFT_CLIENT_ID = 'ms-client';
  process.env.MICROSOFT_CLIENT_SECRET = 'ms-secret';
  process.env.ATLASSIAN_CLIENT_ID = 'at-client';
  process.env.ATLASSIAN_CLIENT_SECRET = 'at-secret';
  // The loopback test server answers on 127.0.0.1.
  process.env.APP_URL = 'http://127.0.0.1:3000';
  delete process.env.MICROSOFT_REDIRECT_URI;
  delete process.env.ATLASSIAN_REDIRECT_URI;
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(human);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(tokenResponse());
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const key of [
    'APP_URL',
    'MICROSOFT_CLIENT_ID',
    'MICROSOFT_CLIENT_SECRET',
    'ATLASSIAN_CLIENT_ID',
    'ATLASSIAN_CLIENT_SECRET',
    'MICROSOFT_REDIRECT_URI',
    'ATLASSIAN_REDIRECT_URI',
  ]) {
    delete process.env[key];
  }
});

// ── Callback ───────────────────────────────────────────────────────────────

describe('GET /api/admin/integrations/oauth/callback, browser binding', () => {
  it('stores the tokens under the flow user when the cookie of that flow is presented, and clears it', async () => {
    const flow = newFlow();

    const res = await request(buildApp())
      .get(CALLBACK)
      .set('Cookie', `other=1; ${cookieFor(flow)}; another=2`)
      .query({ code: 'abc', state: flow.state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/settings/connections?success=1');
    expect(storeToken).toHaveBeenCalledTimes(1);
    expect((storeToken as jest.Mock).mock.calls[0][0]).toBe('microsoft');
    expect((storeToken as jest.Mock).mock.calls[0][3]).toBe('user-1');
    clearingCookie(res, flow.nonce);
  });

  it('stores the Atlassian tokens too (cloud id from the accessible resources)', async () => {
    const flow = newFlow({ provider: 'atlassian', scope: 'jira' });
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'cloud-1' }] });

    const res = await request(buildApp())
      .get(CALLBACK)
      .set('Cookie', cookieFor(flow))
      .query({ code: 'abc', state: flow.state });

    expect(res.headers.location).toBe('/settings/connections?success=1');
    expect(storeToken).toHaveBeenCalledTimes(1);
    expect((storeToken as jest.Mock).mock.calls[0][2]).toMatchObject({ tenantId: 'cloud-1' });
    clearingCookie(res, flow.nonce);
  });

  it('refuses a callback without the cookie, stores nothing, and spends the nonce', async () => {
    const flow = newFlow();
    const app = buildApp();

    const res = await request(app).get(CALLBACK).query({ code: 'abc', state: flow.state });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin?error=invalid_state');
    expect(storeToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    clearingCookie(res, flow.nonce);

    // The refusal consumed the nonce: the right cookie cannot rescue the flow.
    const retry = await request(app)
      .get(CALLBACK)
      .set('Cookie', cookieFor(flow))
      .query({ code: 'abc', state: flow.state });
    expect(retry.headers.location).toBe('/admin?error=invalid_state');
    expect(storeToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a cookie with the right name and a wrong value', async () => {
    const flow = newFlow();

    const res = await request(buildApp())
      .get(CALLBACK)
      .set('Cookie', `oauth_bind_${flow.nonce}=not-the-secret`)
      .query({ code: 'abc', state: flow.state });

    expect(res.headers.location).toBe('/admin?error=invalid_state');
    expect(storeToken).not.toHaveBeenCalled();
    clearingCookie(res, flow.nonce);
  });

  it('refuses an empty cookie value', async () => {
    const flow = newFlow();

    const res = await request(buildApp())
      .get(CALLBACK)
      .set('Cookie', `oauth_bind_${flow.nonce}=`)
      .query({ code: 'abc', state: flow.state });

    expect(res.headers.location).toBe('/admin?error=invalid_state');
    expect(storeToken).not.toHaveBeenCalled();
  });

  it('refuses crossed flows: the cookie of flow B does not complete flow A, and flow B still completes', async () => {
    const flowA = newFlow({ userId: 'attacker' });
    const flowB = newFlow({ userId: 'victim' });
    const app = buildApp();

    // B's cookie under B's name, A's state: A's own cookie is absent.
    const crossed = await request(app)
      .get(CALLBACK)
      .set('Cookie', cookieFor(flowB))
      .query({ code: 'abc', state: flowA.state });
    expect(crossed.headers.location).toBe('/admin?error=invalid_state');
    expect(storeToken).not.toHaveBeenCalled();

    // B's secret under A's cookie name.
    const flowA2 = newFlow({ userId: 'attacker' });
    const renamed = await request(app)
      .get(CALLBACK)
      .set('Cookie', `oauth_bind_${flowA2.nonce}=${flowB.bindingSecret}`)
      .query({ code: 'abc', state: flowA2.state });
    expect(renamed.headers.location).toBe('/admin?error=invalid_state');
    expect(storeToken).not.toHaveBeenCalled();

    // Flow B is untouched by A's refusals.
    const own = await request(app)
      .get(CALLBACK)
      .set('Cookie', cookieFor(flowB))
      .query({ code: 'abc', state: flowB.state });
    expect(own.headers.location).toBe('/settings/connections?success=1');
    expect((storeToken as jest.Mock).mock.calls[0][3]).toBe('victim');
  });

  it('two tabs: both flows complete, each with its own cookie', async () => {
    const flowA = newFlow({ scope: 'sharepoint' });
    const flowB = newFlow({ scope: 'teams' });
    const both = `${cookieFor(flowA)}; ${cookieFor(flowB)}`;
    const app = buildApp();

    const a = await request(app).get(CALLBACK).set('Cookie', both).query({ code: 'abc', state: flowA.state });
    const b = await request(app).get(CALLBACK).set('Cookie', both).query({ code: 'abc', state: flowB.state });

    expect(a.headers.location).toBe('/settings/connections?success=1');
    expect(b.headers.location).toBe('/settings/connections?success=1');
    expect(storeToken).toHaveBeenCalledTimes(2);
  });

  describe('every exit clears the cookie', () => {
    it('invalid_state for an unknown nonce that names a provider', async () => {
      const flow = newFlow();
      sweepOAuthState(FAR_FUTURE()); // forget the nonce

      const res = await request(buildApp())
        .get(CALLBACK)
        .set('Cookie', cookieFor(flow))
        .query({ code: 'abc', state: flow.state });

      expect(res.headers.location).toBe('/admin?error=invalid_state');
      clearingCookie(res, flow.nonce);
    });

    it('oauth_failed when the provider sent no code (user denied consent)', async () => {
      const flow = newFlow();

      const res = await request(buildApp())
        .get(CALLBACK)
        .set('Cookie', cookieFor(flow))
        .query({ error: 'access_denied', state: flow.state });

      expect(res.headers.location).toBe('/admin?error=oauth_failed');
      expect(storeToken).not.toHaveBeenCalled();
      clearingCookie(res, flow.nonce);
    });

    it('a callback without a state sets no cookie header', async () => {
      const res = await request(buildApp()).get(CALLBACK).query({ code: 'abc' });

      expect(res.headers.location).toBe('/admin?error=oauth_failed');
      expect(setCookies(res)).toEqual([]);
    });

    it.each(['microsoft', 'atlassian'] as const)('token_exchange_failed (%s)', async (provider) => {
      const flow = newFlow({ provider, scope: 'x' });
      fetchMock.mockResolvedValueOnce(tokenResponse(false));

      const res = await request(buildApp())
        .get(CALLBACK)
        .set('Cookie', cookieFor(flow))
        .query({ code: 'abc', state: flow.state });

      expect(res.headers.location).toMatch(/^\/admin\?error=token_exchange_failed/);
      expect(storeToken).not.toHaveBeenCalled();
      clearingCookie(res, flow.nonce);
    });

    it('oauth_failed from the catch when the exchange throws', async () => {
      const flow = newFlow();
      fetchMock.mockRejectedValueOnce(new Error('network down'));

      const res = await request(buildApp())
        .get(CALLBACK)
        .set('Cookie', cookieFor(flow))
        .query({ code: 'abc', state: flow.state });

      expect(res.headers.location).toMatch(/^\/admin\?error=oauth_failed/);
      clearingCookie(res, flow.nonce);
    });

    it('success with a redirect-URI override: the clearing Path and the exchange follow it', async () => {
      process.env.MICROSOFT_REDIRECT_URI = 'https://127.0.0.1/custom/oauth/cb';
      const flow = newFlow();

      const res = await request(buildApp())
        .get(CALLBACK)
        .set('Cookie', cookieFor(flow))
        .query({ code: 'abc', state: flow.state });

      expect(res.headers.location).toBe('/settings/connections?success=1');
      clearingCookie(res, flow.nonce, '/custom/oauth/cb');
      expect(fetchMock.mock.calls[0][1].body.get('redirect_uri')).toBe('https://127.0.0.1/custom/oauth/cb');
    });
  });

  it('the callback response is not cacheable', async () => {
    const res = await request(buildApp()).get(CALLBACK).query({ code: 'abc', state: 'x' });

    expect(res.headers['cache-control']).toBe('no-store');
  });
});

// ── consumeOAuthState (unit) ───────────────────────────────────────────────

describe('consumeOAuthState binding', () => {
  it('needs the cookie of this nonce, picked out of several', () => {
    const flow = newFlow();
    expect(consumeOAuthState(flow.state, `a=1; ${cookieFor(flow)}`)).not.toBeNull();
  });

  it.each([
    ['no Cookie header', undefined],
    ['an unrelated cookie', 'session=abc'],
    ['a cookie without a value separator', 'oauth_bind_x'],
  ])('refuses %s', (_label, header) => {
    const flow = newFlow();
    expect(consumeOAuthState(flow.state, header)).toBeNull();
  });

  it('refuses a state naming an unknown provider or a malformed nonce', () => {
    const flow = newFlow();
    const forged = Buffer.from(JSON.stringify({ provider: 'github', scope: 'sharepoint', nonce: flow.nonce })).toString('base64url');
    const shortNonce = Buffer.from(JSON.stringify({ provider: 'microsoft', scope: 'sharepoint', nonce: 'abc' })).toString('base64url');
    expect(consumeOAuthState(forged, cookieFor(flow))).toBeNull();
    expect(consumeOAuthState(shortNonce, cookieFor(flow))).toBeNull();
    // The real flow is still there: neither forgery spent its nonce.
    expect(consumeOAuthState(flow.state, cookieFor(flow))).not.toBeNull();
  });

  it('refuses a state whose provider or scope was changed, and spends the nonce', () => {
    const flow = newFlow();
    const tampered = Buffer.from(JSON.stringify({ provider: 'microsoft', scope: 'teams', nonce: flow.nonce })).toString('base64url');
    expect(consumeOAuthState(tampered, cookieFor(flow))).toBeNull();
    expect(consumeOAuthState(flow.state, cookieFor(flow))).toBeNull();
  });
});

// ── Start: cookie ──────────────────────────────────────────────────────────

async function startVia(host?: string, provider = 'microsoft', scope = 'sharepoint', userId = 'user-1') {
  const { token } = mintOAuthStartToken(provider, scope, userId);
  const req = request(buildApp()).get(START).query({ provider, scope, st: token });
  if (host) req.set('Host', host);
  return { res: await req, token };
}

function nonceFromLocation(location: string): string {
  const state = new URL(location).searchParams.get('state')!;
  return JSON.parse(Buffer.from(state, 'base64url').toString()).nonce;
}

describe('GET /api/integrations/oauth/start, binding cookie', () => {
  it('sets an HttpOnly, SameSite=Lax, host-only cookie scoped to the callback path, then redirects to the provider', async () => {
    const { res } = await startVia();

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\//);
    const nonce = nonceFromLocation(res.headers.location);
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(1);
    const cookie = cookies[0];
    expect(cookie).toMatch(new RegExp(`^oauth_bind_${nonce}=[A-Za-z0-9_-]{43};`));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain(`Path=${DEFAULT_CALLBACK_PATH}`);
    expect(cookie).toContain('Max-Age=600');
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).not.toContain('Secure');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('the cookie from the start response completes the callback (and only it)', async () => {
    const { res } = await startVia();
    const state = new URL(res.headers.location).searchParams.get('state')!;
    const nonce = nonceFromLocation(res.headers.location);
    const pair = setCookies(res)[0].split(';')[0];
    expect(pair.startsWith(`oauth_bind_${nonce}=`)).toBe(true);

    const done = await request(buildApp()).get(CALLBACK).set('Cookie', pair).query({ code: 'abc', state });

    expect(done.headers.location).toBe('/settings/connections?success=1');
    expect((storeToken as jest.Mock).mock.calls[0][3]).toBe('user-1');
  });

  it('every start gets its own secret and name', async () => {
    const a = await startVia();
    const b = await startVia(undefined, 'microsoft', 'teams');

    expect(setCookies(a.res)[0].split(';')[0]).not.toBe(setCookies(b.res)[0].split(';')[0]);
  });

  it('sets no cookie when the provider is not configured (500)', async () => {
    delete process.env.MICROSOFT_CLIENT_ID;

    const { res } = await startVia();

    expect(res.status).toBe(500);
    expect(setCookies(res)).toEqual([]);
  });

  // Inputs: APP_URL scheme, redirect-URI override set or not. The request host
  // is equal to the redirect-URI host in these cases (host cases follow).
  //   Secure  <- APP_URL alone
  //   Path    <- override when set, else the APP_URL default path
  it.each([
    ['https APP_URL, no override', 'https://127.0.0.1', undefined, true, DEFAULT_CALLBACK_PATH],
    ['http APP_URL, no override', 'http://127.0.0.1:3000', undefined, false, DEFAULT_CALLBACK_PATH],
    ['https APP_URL, http override', 'https://127.0.0.1', 'http://127.0.0.1/over/ride', true, '/over/ride'],
    ['http APP_URL, https override', 'http://127.0.0.1:3000', 'https://127.0.0.1/over/ride', false, '/over/ride'],
    ['https APP_URL, https override', 'https://127.0.0.1', 'https://127.0.0.1/over/ride', true, '/over/ride'],
    ['http APP_URL, http override', 'http://127.0.0.1:3000', 'http://127.0.0.1/over/ride', false, '/over/ride'],
  ])('%s', async (_label, appUrl, override, secure, path) => {
    process.env.APP_URL = appUrl;
    if (override) process.env.MICROSOFT_REDIRECT_URI = override;

    const { res } = await startVia();

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\//);
    const cookie = setCookies(res)[0];
    expect(cookie).toContain(`Path=${path}`);
    if (secure) expect(cookie).toContain('Secure');
    else expect(cookie).not.toContain('Secure');
  });

  it('the Atlassian override is read for Atlassian and not for Microsoft', async () => {
    process.env.ATLASSIAN_REDIRECT_URI = 'http://127.0.0.1/atl/cb';

    const atlassian = await startVia(undefined, 'atlassian', 'jira');
    const microsoft = await startVia();

    expect(setCookies(atlassian.res)[0]).toContain('Path=/atl/cb');
    expect(setCookies(microsoft.res)[0]).toContain(`Path=${DEFAULT_CALLBACK_PATH}`);
  });
});

// ── Start: host redirect ───────────────────────────────────────────────────

describe('GET /api/integrations/oauth/start, host redirect', () => {
  // Inputs: request host equal or not, override set or not. The redirect
  // target is the origin of the override when set, else of APP_URL; path and
  // query are kept; no cookie is set on the redirect and `st` is not spent.
  it.each([
    ['no override', 'https://app.example.com', undefined, 'https://app.example.com'],
    ['with override', 'https://app.example.com', 'https://login.example.org:8443/cb', 'https://login.example.org:8443'],
  ])('other host, %s: 302 to the redirect-URI origin with the query intact, no cookie', async (_l, appUrl, override, origin) => {
    process.env.APP_URL = appUrl;
    if (override) process.env.MICROSOFT_REDIRECT_URI = override;
    const { token } = mintOAuthStartToken('microsoft', 'sharepoint', 'user-1');
    const app = buildApp();

    const res = await request(app)
      .get(START)
      .set('Host', 'www.example.com')
      .query({ provider: 'microsoft', scope: 'sharepoint', st: token });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `${origin}${START}?provider=microsoft&scope=sharepoint&st=${encodeURIComponent(token)}`,
    );
    expect(setCookies(res)).toEqual([]);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('the st token is not spent by the host redirect', async () => {
    process.env.APP_URL = 'https://app.example.com';
    const { token } = mintOAuthStartToken('microsoft', 'sharepoint', 'user-1');
    const app = buildApp();
    const query = { provider: 'microsoft', scope: 'sharepoint', st: token };

    const moved = await request(app).get(START).set('Host', 'www.example.com').query(query);
    expect(moved.status).toBe(302);
    // A second hit on the wrong host redirects again instead of reporting a replay.
    const movedAgain = await request(app).get(START).set('Host', 'www.example.com').query(query);
    expect(movedAgain.status).toBe(302);
    expect(movedAgain.headers.location).toMatch(/^https:\/\/app\.example\.com\//);
  });

  it.each([
    ['no override', undefined],
    ['with override', 'https://app.example.com/cb'],
  ])('same host, %s: cookie and provider redirect', async (_l, override) => {
    process.env.APP_URL = 'https://app.example.com';
    if (override) process.env.MICROSOFT_REDIRECT_URI = override;

    const { res } = await startVia('app.example.com');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\//);
    expect(setCookies(res)).toHaveLength(1);
  });

  it('compares host names, not ports or letter case', async () => {
    process.env.APP_URL = 'https://app.example.com';

    const { res } = await startVia('APP.Example.com:8443');

    expect(res.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\//);
    expect(setCookies(res)).toHaveLength(1);
  });

  it('the override host wins over the APP_URL host for the comparison', async () => {
    process.env.APP_URL = 'https://app.example.com';
    process.env.MICROSOFT_REDIRECT_URI = 'https://auth.example.com/cb';

    const onAppUrlHost = await startVia('app.example.com');
    expect(onAppUrlHost.res.headers.location).toMatch(/^https:\/\/auth\.example\.com\//);

    const onOverrideHost = await startVia('auth.example.com');
    expect(onOverrideHost.res.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\//);
  });

  it('an unknown provider is not redirected and keeps its own error', async () => {
    process.env.APP_URL = 'https://app.example.com';

    const res = await request(buildApp())
      .get(START)
      .set('Host', 'www.example.com')
      .set('Authorization', 'Bearer x')
      .query({ provider: 'github' });

    expect(res.headers.location).toBeUndefined();
  });
});

// ── st single use ──────────────────────────────────────────────────────────

describe('st token is single use', () => {
  it('first use starts a flow, the replay is refused like an expired token', async () => {
    const { token } = mintOAuthStartToken('microsoft', 'sharepoint', 'user-1');
    const app = buildApp();
    const query = { provider: 'microsoft', scope: 'sharepoint', st: token };

    const first = await request(app).get(START).query(query);
    const second = await request(app).get(START).query(query);

    expect(first.status).toBe(302);
    expect(second.status).toBe(401);
    expect(second.headers.location).toBeUndefined();
    expect(setCookies(second)).toEqual([]);
  });

  it('a token of another scope is a different token and is not affected', async () => {
    const app = buildApp();
    const a = mintOAuthStartToken('microsoft', 'sharepoint', 'user-1').token;
    const b = mintOAuthStartToken('microsoft', 'teams', 'user-1').token;

    expect((await request(app).get(START).query({ provider: 'microsoft', scope: 'sharepoint', st: a })).status).toBe(302);
    expect((await request(app).get(START).query({ provider: 'microsoft', scope: 'teams', st: b })).status).toBe(302);
  });

  it('a forged token does not spend the real one', async () => {
    const { token } = mintOAuthStartToken('microsoft', 'sharepoint', 'user-1');
    const forged = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    const app = buildApp();

    expect((await request(app).get(START).query({ provider: 'microsoft', scope: 'sharepoint', st: forged })).status).toBe(401);
    expect((await request(app).get(START).query({ provider: 'microsoft', scope: 'sharepoint', st: token })).status).toBe(302);
  });

  it('the Authorization header path carries no st and can start repeatedly', async () => {
    const session = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!);
    const app = buildApp();
    const call = () =>
      request(app).get(START).set('Authorization', `Bearer ${session}`).query({ provider: 'microsoft', scope: 'sharepoint' });

    const first = await call();
    const second = await call();

    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    expect(setCookies(second)).toHaveLength(1);
  });

  it('claimOAuthStartToken keeps a token until it expires and forgets it at the sweep after', () => {
    const nowMs = 1_800_000_000_000;
    const minted = mintOAuthStartToken('microsoft', 'sharepoint', 'sweep-user', nowMs);

    expect(claimOAuthStartToken(minted.token)).toBe(true);
    expect(claimOAuthStartToken(minted.token)).toBe(false);

    sweepOAuthState(minted.expiresAt * 1000 - 1);
    expect(claimOAuthStartToken(minted.token)).toBe(false);

    sweepOAuthState(minted.expiresAt * 1000);
    expect(claimOAuthStartToken(minted.token)).toBe(true);
  });
});
