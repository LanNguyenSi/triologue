/**
 * Browser binding of the OAuth account-linking flow, both legs.
 *
 *   - POST /api/integrations/oauth/start-token hands the minting browser a
 *     secret as an HttpOnly, SameSite=Strict cookie and keeps only its hash
 *     next to the minted `st` token. GET /oauth/start with `st` needs that
 *     cookie: a token pasted into another browser, replayed, or paired with
 *     the cookie of another mint is refused (401) and the token is spent.
 *   - GET /oauth/start then sets the flow cookie (HttpOnly, SameSite=Lax)
 *     whose hash lives with the state nonce, and GET
 *     /api/admin/integrations/oauth/callback stores provider tokens only when
 *     the browser presents it, clearing it on every exit.
 *   - Both cookies are host-only, so a request on another host than the
 *     redirect URI's is refused (409 JSON naming the canonical origin for the
 *     start-token and header requests, a redirect to the app's connections
 *     page carrying only the error code and the provider for a navigation;
 *     the page reads the origin itself from
 *     GET /api/integrations/oauth/canonical-origin, below).
 *
 * Precedence of the inputs (one test per combination below):
 *   - Path and host of the flow cookie and of the host check come from the
 *     provider's redirect-URI override when it is set, else from APP_URL.
 *   - `Secure` (both cookies) comes from APP_URL alone, never from the
 *     override or the request.
 *   - The request host decides only whether the host check refuses.
 *
 * Mutation-check intent (each neutralised on its own, the named tests go red):
 *   - consumeOAuthState: skip the binding comparison -> no-cookie, wrong-cookie
 *     and crossed-flow tests.
 *   - consumeOAuthState: compare before deleting the nonce -> the "retry with
 *     the right cookie" test.
 *   - setOAuthBindingCookie / setOAuthStartCookie: drop an attribute -> the
 *     attribute tests.
 *   - clearOAuthBindingCookie in the callback / clearOAuthStartCookie in the
 *     start route -> the clears-the-cookie tests.
 *   - consumeOAuthStartBinding: skip the comparison, keep the entry after use,
 *     or never expire entries -> the attacker, wrong-cookie, replay and sweep
 *     tests.
 *   - wrongHostOrigin / requireCanonicalHost: always allow -> the host tests.
 *   - requireCanonicalHost navigation: drop the provider from the 302, or
 *     write the origin into it -> the navigation tests.
 *   - canonical-origin route: drop requireHuman or authenticate -> its 403 /
 *     401 tests; drop the provider guard -> its 400 test; let the unparseable
 *     redirect URI answer its APP_URL fallback or throw an unhandled 500 ->
 *     its 404 test.
 *   - callback redirects: re-add provider text as a `detail` query parameter
 *     -> the token_exchange_failed and catch tests.
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
import { findAgentTokenByRawToken } from '../services/agentTokenRotation';
import { storeToken } from '../services/tokenManager';
import integrationsRouter from '../routes/integrations';
import adminRouter from '../routes/admin';
import {
  consumeOAuthStartBinding,
  consumeOAuthState,
  createOAuthState,
  issueOAuthStartBinding,
  startCookieName,
  sweepOAuthState,
} from '../services/integrationOAuth';
import { mintOAuthStartToken } from '../lib/scopedToken';
import { mintBoundStartToken } from './helpers/oauthStart';

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

    it.each(['microsoft', 'atlassian'] as const)('token_exchange_failed (%s): the redirect is the fixed code with no detail, the provider answer goes to the log', async (provider) => {
      const flow = newFlow({ provider, scope: 'x' });
      fetchMock.mockResolvedValueOnce(tokenResponse(false));

      const res = await request(buildApp())
        .get(CALLBACK)
        .set('Cookie', cookieFor(flow))
        .query({ code: 'abc', state: flow.state });

      expect(res.headers.location).toBe('/admin?error=token_exchange_failed');
      expect(storeToken).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('[admin] Token exchange failed:', 'provider said no');
      clearingCookie(res, flow.nonce);
    });

    it('oauth_failed from the catch when the exchange throws: fixed code, no detail, the error goes to the log', async () => {
      const flow = newFlow();
      fetchMock.mockRejectedValueOnce(new Error('network down'));

      const res = await request(buildApp())
        .get(CALLBACK)
        .set('Cookie', cookieFor(flow))
        .query({ code: 'abc', state: flow.state });

      expect(res.headers.location).toBe('/admin?error=oauth_failed');
      expect(console.error).toHaveBeenCalledWith('[admin] OAuth callback error:', 'network down');
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

  it('refuses a cookie whose name only starts with the expected name', () => {
    const flow = newFlow();
    const [name, value] = cookieFor(flow).split('=');
    expect(consumeOAuthState(flow.state, `${name}x=${value}`)).toBeNull();
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

// ── Start-token: cookie ────────────────────────────────────────────────────

const MINT = '/api/integrations/oauth/start-token';
const START_PATH = '/api/integrations/oauth/start';

function pairOf(res: { headers: Record<string, unknown> }, namePrefix: string): string {
  const found = setCookies(res).find((c) => c.startsWith(namePrefix));
  expect(found).toBeDefined();
  return found!.split(';')[0];
}

describe('POST /api/integrations/oauth/start-token, start cookie', () => {
  const header = () => `Bearer ${jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!)}`;

  async function mint(app = buildApp(), provider = 'microsoft', scope = 'sharepoint', host?: string) {
    const req = request(app).post(MINT).set('Authorization', header()).send({ provider, scope });
    if (host) req.set('Host', host);
    return req;
  }

  it('sets an HttpOnly, SameSite=Strict, host-only cookie scoped to the start route, valid as long as the token', async () => {
    const res = await mint();

    expect(res.status).toBe(200);
    const cookies = setCookies(res);
    expect(cookies).toHaveLength(1);
    const cookie = cookies[0];
    expect(cookie).toMatch(new RegExp(`^${startCookieName(res.body.token)}=[A-Za-z0-9_-]{43};`));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain(`Path=${START_PATH}`);
    expect(cookie).toMatch(/Max-Age=(1[01][0-9]|120);/);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).not.toContain('Secure');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('marks the cookie Secure exactly when APP_URL is https', async () => {
    process.env.APP_URL = 'https://127.0.0.1';
    const https = await mint();
    expect(setCookies(https)[0]).toContain('Secure');

    process.env.APP_URL = 'http://127.0.0.1:3000';
    const http = await mint();
    expect(setCookies(http)[0]).not.toContain('Secure');
  });

  it('Secure follows APP_URL, not the redirect-URI override', async () => {
    process.env.APP_URL = 'http://127.0.0.1:3000';
    process.env.MICROSOFT_REDIRECT_URI = 'https://127.0.0.1/cb';
    expect(setCookies(await mint())[0]).not.toContain('Secure');

    process.env.APP_URL = 'https://127.0.0.1';
    process.env.MICROSOFT_REDIRECT_URI = 'http://127.0.0.1/cb';
    expect(setCookies(await mint())[0]).toContain('Secure');
  });

  it('refuses a start-token on another host with 409 naming the canonical origin, and sets no cookie', async () => {
    process.env.APP_URL = 'https://app.example.com';

    const res = await mint(buildApp(), 'microsoft', 'sharepoint', 'www.example.com');

    expect(res.status).toBe(409);
    expect(res.body.canonicalOrigin).toBe('https://app.example.com');
    expect(res.body.error).toContain('https://app.example.com');
    expect(res.body.token).toBeUndefined();
    expect(setCookies(res)).toEqual([]);
  });

  it('refuses a subdomain of the canonical host (www against the apex) with 409, and sets no cookie', async () => {
    process.env.APP_URL = 'https://example.com';

    const res = await mint(buildApp(), 'microsoft', 'sharepoint', 'www.example.com');

    expect(res.status).toBe(409);
    expect(res.body.canonicalOrigin).toBe('https://example.com');
    expect(setCookies(res)).toEqual([]);
  });

  it('names the override origin, not the APP_URL one, when the override is set', async () => {
    process.env.APP_URL = 'https://app.example.com';
    process.env.MICROSOFT_REDIRECT_URI = 'https://login.example.org:8443/cb';

    const res = await mint(buildApp(), 'microsoft', 'sharepoint', 'app.example.com');

    expect(res.status).toBe(409);
    expect(res.body.canonicalOrigin).toBe('https://login.example.org:8443');
  });

  it('mints on the canonical host whatever the port or letter case', async () => {
    process.env.APP_URL = 'https://app.example.com';

    const res = await mint(buildApp(), 'microsoft', 'sharepoint', 'APP.Example.com:8443');

    expect(res.status).toBe(200);
  });
});

// ── Start: the attacker scenario and the start cookie ──────────────────────

async function startWith(opts: { token: string; cookie?: string; host?: string; provider?: string; scope?: string; app?: express.Express }) {
  const req = request(opts.app ?? buildApp())
    .get(START)
    .query({ provider: opts.provider ?? 'microsoft', scope: opts.scope ?? 'sharepoint', st: opts.token });
  if (opts.cookie) req.set('Cookie', opts.cookie);
  if (opts.host) req.set('Host', opts.host);
  return req;
}

function nonceFromLocation(location: string): string {
  const state = new URL(location).searchParams.get('state')!;
  return JSON.parse(Buffer.from(state, 'base64url').toString()).nonce;
}

describe('GET /api/integrations/oauth/start, start cookie', () => {
  it('starts a flow for the browser that minted the token, and clears the start cookie', async () => {
    const t = mintBoundStartToken('microsoft', 'sharepoint', 'user-1');

    const res = await startWith({ token: t.token, cookie: t.cookie });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\//);
    const clear = setCookies(res).find((c) => c.startsWith(`${startCookieName(t.token)}=;`));
    expect(clear).toBeDefined();
    expect(clear).toContain(`Path=${START_PATH}`);
    expect(clear).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(clear).toContain('SameSite=Strict');
  });

  it('end to end: the cookie from start-token and the cookie from start complete the callback', async () => {
    const app = buildApp();
    const minted = await request(app)
      .post(MINT)
      .set('Authorization', `Bearer ${jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!)}`)
      .send({ provider: 'microsoft', scope: 'sharepoint' });
    const startCookie = pairOf(minted, 'oauth_start_');

    const started = await startWith({ app, token: minted.body.token, cookie: startCookie });
    expect(started.status).toBe(302);
    const state = new URL(started.headers.location).searchParams.get('state')!;
    const flowCookie = pairOf(started, 'oauth_bind_');

    const done = await request(app).get(CALLBACK).set('Cookie', flowCookie).query({ code: 'abc', state });
    expect(done.headers.location).toBe('/settings/connections?success=1');
    expect((storeToken as jest.Mock).mock.calls[0][3]).toBe('user-1');
  });

  it('attacker scenario: a token minted under the attacker session is useless in the victim browser, and nothing is stored', async () => {
    const app = buildApp();
    // The attacker mints under their own session (user-1 here stands for the attacker).
    const attackerMint = await request(app)
      .post(MINT)
      .set('Authorization', `Bearer ${jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!)}`)
      .send({ provider: 'microsoft', scope: 'sharepoint' });
    expect(attackerMint.status).toBe(200);
    const attackerUrlToken = attackerMint.body.token;

    // The victim's browser opens the pasted URL: it holds no start cookie.
    const victim = await startWith({ app, token: attackerUrlToken });
    expect(victim.status).toBe(401);
    expect(victim.headers.location).toBeUndefined();
    expect(setCookies(victim).find((c) => c.startsWith('oauth_bind_'))).toBeUndefined();
    expect(storeToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    // The token is spent: the attacker's own browser cannot use it afterwards either.
    const late = await startWith({ app, token: attackerUrlToken, cookie: pairOf(attackerMint, 'oauth_start_') });
    expect(late.status).toBe(401);
  });

  it('refuses a request without the cookie (401), spends the token, and creates no flow', async () => {
    const t = mintBoundStartToken('microsoft', 'sharepoint', 'user-1');

    const without = await startWith({ token: t.token });
    expect(without.status).toBe(401);
    expect(setCookies(without).find((c) => c.startsWith('oauth_bind_'))).toBeUndefined();
    // Even the right cookie cannot use the token any more.
    const retry = await startWith({ token: t.token, cookie: t.cookie });
    expect(retry.status).toBe(401);
  });

  it('refuses a wrong cookie value and spends the token', async () => {
    const t = mintBoundStartToken('microsoft', 'sharepoint', 'user-1');

    const wrong = await startWith({ token: t.token, cookie: `${startCookieName(t.token)}=not-the-secret` });
    expect(wrong.status).toBe(401);
    const retry = await startWith({ token: t.token, cookie: t.cookie });
    expect(retry.status).toBe(401);
  });

  it('refuses the cookie of another mint: same user, other scope, secret under this token\'s name', async () => {
    const a = mintBoundStartToken('microsoft', 'sharepoint', 'user-1');
    const b = mintBoundStartToken('microsoft', 'teams', 'user-1');

    // B's secret presented under A's cookie name.
    const secretOfB = b.cookie.split('=')[1];
    const crossed = await startWith({ token: a.token, cookie: `${startCookieName(a.token)}=${secretOfB}` });
    expect(crossed.status).toBe(401);
    // B's cookie under B's own name does not help A either.
    const a2 = mintBoundStartToken('microsoft', 'sharepoint', 'user-1');
    const wrongName = await startWith({ token: a2.token, cookie: b.cookie });
    expect(wrongName.status).toBe(401);
    // B itself still works.
    const own = await startWith({ token: b.token, cookie: b.cookie, scope: 'teams' });
    expect(own.status).toBe(302);
  });

  it('replay with the right cookie is refused: the first start spent the token', async () => {
    const t = mintBoundStartToken('microsoft', 'sharepoint', 'user-1');
    const app = buildApp();

    const first = await startWith({ app, token: t.token, cookie: t.cookie });
    const second = await startWith({ app, token: t.token, cookie: t.cookie });

    expect(first.status).toBe(302);
    expect(second.status).toBe(401);
    expect(setCookies(second).find((c) => c.startsWith('oauth_bind_'))).toBeUndefined();
  });

  it('a token minted before a restart (no entry) is refused even with a cookie', async () => {
    const minted = mintOAuthStartToken('microsoft', 'sharepoint', 'user-1');

    const res = await startWith({ token: minted.token, cookie: `${startCookieName(minted.token)}=anything` });

    expect(res.status).toBe(401);
  });

  it('a forged token does not spend the real one', async () => {
    const t = mintBoundStartToken('microsoft', 'sharepoint', 'user-1');
    const forged = t.token.slice(0, -2) + (t.token.endsWith('AA') ? 'BB' : 'AA');

    expect((await startWith({ token: forged, cookie: t.cookie })).status).toBe(401);
    expect((await startWith({ token: t.token, cookie: t.cookie })).status).toBe(302);
  });

  it('the Authorization header path needs no start cookie and can start repeatedly', async () => {
    const session = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!);
    const app = buildApp();
    const call = () =>
      request(app).get(START).set('Authorization', `Bearer ${session}`).query({ provider: 'microsoft', scope: 'sharepoint' });

    const first = await call();
    const second = await call();

    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    expect(setCookies(second).filter((c) => c.startsWith('oauth_bind_'))).toHaveLength(1);
  });

  it('binding ledger: kept until the token expires, forgotten at the sweep after', () => {
    const nowMs = 1_800_000_000_000;
    const minted = mintOAuthStartToken('microsoft', 'sharepoint', 'sweep-user', nowMs);
    const secret = issueOAuthStartBinding(minted.token);
    const cookie = `${startCookieName(minted.token)}=${secret}`;

    sweepOAuthState(minted.expiresAt * 1000 - 1);
    // still there: a use before the expiry would succeed, so look without spending a wrong one
    expect(consumeOAuthStartBinding(minted.token, cookie)).toBe(true);

    const again = issueOAuthStartBinding(minted.token);
    sweepOAuthState(minted.expiresAt * 1000);
    expect(consumeOAuthStartBinding(minted.token, `${startCookieName(minted.token)}=${again}`)).toBe(false);
  });

  it('two tabs: tokens for different scopes keep separate cookies and both start', async () => {
    const a = mintBoundStartToken('microsoft', 'sharepoint', 'user-1');
    const b = mintBoundStartToken('microsoft', 'teams', 'user-1');
    const both = `${a.cookie}; ${b.cookie}`;

    expect((await startWith({ token: a.token, cookie: both })).status).toBe(302);
    expect((await startWith({ token: b.token, cookie: both, scope: 'teams' })).status).toBe(302);
  });
});

// ── Start: flow cookie ─────────────────────────────────────────────────────

describe('GET /api/integrations/oauth/start, flow cookie', () => {
  async function startBound(opts: { host?: string; provider?: string; scope?: string } = {}) {
    const provider = opts.provider ?? 'microsoft';
    const scope = opts.scope ?? 'sharepoint';
    const t = mintBoundStartToken(provider, scope, 'user-1');
    return startWith({ token: t.token, cookie: t.cookie, host: opts.host, provider, scope });
  }

  it('sets an HttpOnly, SameSite=Lax, host-only cookie scoped to the callback path, then redirects to the provider', async () => {
    const res = await startBound();

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\//);
    const nonce = nonceFromLocation(res.headers.location);
    const flow = setCookies(res).filter((c) => c.startsWith('oauth_bind_'));
    expect(flow).toHaveLength(1);
    const cookie = flow[0];
    expect(cookie).toMatch(new RegExp(`^oauth_bind_${nonce}=[A-Za-z0-9_-]{43};`));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain(`Path=${DEFAULT_CALLBACK_PATH}`);
    expect(cookie).toContain('Max-Age=600');
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).not.toContain('Secure');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('every start gets its own secret and name', async () => {
    const a = await startBound();
    const b = await startBound({ scope: 'teams' });

    expect(pairOf(a, 'oauth_bind_')).not.toBe(pairOf(b, 'oauth_bind_'));
  });

  it('sets no flow cookie when the provider is not configured (500)', async () => {
    delete process.env.MICROSOFT_CLIENT_ID;

    const res = await startBound();

    expect(res.status).toBe(500);
    expect(setCookies(res).find((c) => c.startsWith('oauth_bind_'))).toBeUndefined();
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

    const res = await startBound();

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\//);
    const cookie = setCookies(res).find((c) => c.startsWith('oauth_bind_'))!;
    expect(cookie).toContain(`Path=${path}`);
    if (secure) expect(cookie).toContain('Secure');
    else expect(cookie).not.toContain('Secure');
  });

  it('the Atlassian override is read for Atlassian and not for Microsoft', async () => {
    process.env.ATLASSIAN_REDIRECT_URI = 'http://127.0.0.1/atl/cb';

    const atlassian = await startBound({ provider: 'atlassian', scope: 'jira' });
    const microsoft = await startBound();

    expect(setCookies(atlassian).find((c) => c.startsWith('oauth_bind_'))).toContain('Path=/atl/cb');
    expect(setCookies(microsoft).find((c) => c.startsWith('oauth_bind_'))).toContain(`Path=${DEFAULT_CALLBACK_PATH}`);
  });
});

// ── Start: host refusal ────────────────────────────────────────────────────

describe('GET /api/integrations/oauth/start, host refusal', () => {
  // Inputs: request host equal or not, override set or not. The canonical
  // origin comes from the override when set, else from APP_URL.
  // The 302 carries the provider (already validated by the host check) so the
  // page can ask for the origin; it never carries the host itself, because a
  // crafted link could name any host there. Inputs: provider, override set or
  // not (the override picks the origin the page will later be told).
  it.each([
    ['microsoft', 'no override', 'https://app.example.com', undefined],
    ['microsoft', 'with override', 'https://app.example.com', 'https://login.example.org:8443/cb'],
    ['atlassian', 'no override', 'https://app.example.com', undefined],
    ['atlassian', 'with override', 'https://app.example.com', 'https://login.example.org:8443/cb'],
  ])('navigation on another host, %s %s: back to the connections page with the error code and the provider, no flow cookie, token spent', async (provider, _l, appUrl, override) => {
    process.env.APP_URL = appUrl;
    if (override) {
      if (provider === 'microsoft') process.env.MICROSOFT_REDIRECT_URI = override;
      else process.env.ATLASSIAN_REDIRECT_URI = override;
    }
    const scope = provider === 'microsoft' ? 'sharepoint' : 'jira';
    const t = mintBoundStartToken(provider, scope, 'user-1');
    const app = buildApp();

    const res = await startWith({ app, token: t.token, cookie: t.cookie, host: 'www.example.com', provider, scope });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/settings/connections?error=wrong_host&provider=${provider}`);
    expect(res.headers.location).not.toContain('example.com');
    expect(setCookies(res).find((c) => c.startsWith('oauth_bind_'))).toBeUndefined();
    const retry = await startWith({ app, token: t.token, cookie: t.cookie, host: 'www.example.com', provider, scope });
    expect(retry.status).toBe(401);
  });

  it.each([
    ['no override', 'https://app.example.com', undefined, 'https://app.example.com'],
    ['with override', 'https://app.example.com', 'https://login.example.org:8443/cb', 'https://login.example.org:8443'],
  ])('header request on another host, %s: 409 naming the canonical origin', async (_l, appUrl, override, origin) => {
    process.env.APP_URL = appUrl;
    if (override) process.env.MICROSOFT_REDIRECT_URI = override;
    const session = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!);

    const res = await request(buildApp())
      .get(START)
      .set('Host', 'www.example.com')
      .set('Authorization', `Bearer ${session}`)
      .query({ provider: 'microsoft', scope: 'sharepoint' });

    expect(res.status).toBe(409);
    expect(res.body.canonicalOrigin).toBe(origin);
    expect(res.headers.location).toBeUndefined();
    expect(setCookies(res)).toEqual([]);
  });

  it.each([
    ['no override', undefined],
    ['with override', 'https://app.example.com/cb'],
  ])('same host, %s: cookie and provider redirect', async (_l, override) => {
    process.env.APP_URL = 'https://app.example.com';
    if (override) process.env.MICROSOFT_REDIRECT_URI = override;
    const t = mintBoundStartToken('microsoft', 'sharepoint', 'user-1');

    const res = await startWith({ token: t.token, cookie: t.cookie, host: 'app.example.com' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\//);
    expect(setCookies(res).filter((c) => c.startsWith('oauth_bind_'))).toHaveLength(1);
  });

  it('the override host wins over the APP_URL host for the comparison', async () => {
    process.env.APP_URL = 'https://app.example.com';
    process.env.MICROSOFT_REDIRECT_URI = 'https://auth.example.com/cb';
    const a = mintBoundStartToken('microsoft', 'sharepoint', 'user-1');
    const onAppUrlHost = await startWith({ token: a.token, cookie: a.cookie, host: 'app.example.com' });
    expect(onAppUrlHost.headers.location).toBe('/settings/connections?error=wrong_host&provider=microsoft');

    const b = mintBoundStartToken('microsoft', 'sharepoint', 'user-1');
    const onOverrideHost = await startWith({ token: b.token, cookie: b.cookie, host: 'auth.example.com' });
    expect(onOverrideHost.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\//);
  });

  it('an unknown provider keeps its own error (no host check)', async () => {
    process.env.APP_URL = 'https://app.example.com';

    const res = await request(buildApp())
      .get(START)
      .set('Host', 'www.example.com')
      .set('Authorization', `Bearer ${jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!)}`)
      .query({ provider: 'github' });

    expect(res.status).toBe(400);
  });
});

// ── Canonical origin route ─────────────────────────────────────────────────

// The wrong_host navigation names no host, so the connections page asks this
// route for the configured origin. The answer is configuration (the
// *_REDIRECT_URI override when set, else APP_URL), never request headers, and
// nothing is written.
describe('GET /api/integrations/oauth/canonical-origin', () => {
  const ORIGIN = '/api/integrations/oauth/canonical-origin';
  const humanHeader = () => `Bearer ${jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!)}`;

  const get = (app: express.Express | undefined, provider?: string) => {
    const req = request(app ?? buildApp()).get(ORIGIN).set('Authorization', humanHeader());
    if (provider !== undefined) req.query({ provider });
    return req;
  };

  it('no override: APP_URL decides, the answer is its origin, nothing is written', async () => {
    process.env.APP_URL = 'https://app.example.com';

    const res = await get(undefined, 'microsoft');

    expect(res.status).toBe(200);
    expect(res.body.canonicalOrigin).toBe('https://app.example.com');
    expect(storeToken).not.toHaveBeenCalled();
    expect(prisma.integrationToken.update).not.toHaveBeenCalled();
  });

  it('with override: the override wins over APP_URL', async () => {
    process.env.APP_URL = 'https://app.example.com';
    process.env.MICROSOFT_REDIRECT_URI = 'https://login.example.org:8443/cb';

    const res = await get(undefined, 'microsoft');

    expect(res.status).toBe(200);
    expect(res.body.canonicalOrigin).toBe('https://login.example.org:8443');
  });

  it('the override is read per provider: Atlassian answers its own, Microsoft its own', async () => {
    process.env.APP_URL = 'https://app.example.com';
    process.env.ATLASSIAN_REDIRECT_URI = 'https://auth.example.org/atlassian/cb';

    const atlassian = await get(undefined, 'atlassian');
    const microsoft = await get(undefined, 'microsoft');

    expect(atlassian.body.canonicalOrigin).toBe('https://auth.example.org');
    expect(microsoft.body.canonicalOrigin).toBe('https://app.example.com');
  });

  it('unknown provider: 400 with start-token\'s shape', async () => {
    process.env.APP_URL = 'https://app.example.com';

    const res = await get(undefined, 'github');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Unknown provider: github' });
  });

  it('absent provider: 400 like an unknown one (empty name)', async () => {
    const res = await get(undefined);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Unknown provider: ' });
  });

  it('refuses a request without authentication (401)', async () => {
    const res = await request(buildApp()).get(ORIGIN).query({ provider: 'microsoft' });

    expect(res.status).toBe(401);
    expect(res.body.canonicalOrigin).toBeUndefined();
  });

  it.each([
    ['Bearer byoa_ header', 'Bearer byoa_agent_secret'],
    ['bare byoa_ header', 'byoa_agent_secret'],
  ])('refuses an agent token sent as %s (403, no origin)', async (_label, header) => {
    (findAgentTokenByRawToken as jest.Mock).mockResolvedValue({
      isActive: true,
      status: 'active',
      agentUser: { id: 'agent-1', username: 'a', displayName: 'A', userType: 'AI_AGENT', isAdmin: false, isActive: true },
    });

    const res = await request(buildApp()).get(ORIGIN).set('Authorization', header).query({ provider: 'microsoft' });

    expect(res.status).toBe(403);
    expect(res.body.canonicalOrigin).toBeUndefined();
    expect(findAgentTokenByRawToken).toHaveBeenCalled();
  });

  it("refuses an agent user's own JWT (403, no origin)", async () => {
    (prisma.user.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'agent-1'
        ? { id: 'agent-1', username: 'a', userType: 'AI_AGENT', displayName: 'A', isAdmin: false, isActive: true, canTriggerAI: false }
        : human,
    );
    const agentJwt = jwt.sign({ userId: 'agent-1' }, process.env.JWT_SECRET!);

    const res = await request(buildApp()).get(ORIGIN).set('Authorization', `Bearer ${agentJwt}`).query({ provider: 'microsoft' });

    expect(res.status).toBe(403);
    expect(res.body.canonicalOrigin).toBeUndefined();
  });

  // getOAuthRedirectOrigin reads the override as-is, so a value that is no URL
  // is exactly the not-configured case: 404 with an error, never an origin.
  it('redirect URI not configured: 404 with an error, no origin', async () => {
    process.env.APP_URL = 'https://app.example.com';
    process.env.MICROSOFT_REDIRECT_URI = 'not a url';

    const res = await get(undefined, 'microsoft');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('microsoft');
    expect(res.body.canonicalOrigin).toBeUndefined();
  });
});
