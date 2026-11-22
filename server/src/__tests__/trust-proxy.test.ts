/**
 * TRUST_PROXY_HOPS: the number of reverse proxies Express trusts when it reads
 * req.ip from X-Forwarded-For, and so the key of every IP-keyed rate limiter.
 *
 * Production chain: client -> Traefik -> frontend nginx -> api. nginx appends
 * the address of its peer (Traefik) to X-Forwarded-For, so the api sees
 * "<whatever arrived at Traefik>, <client>, <traefik>" from the nginx socket.
 * With 2 hops req.ip is <client>; anything further left was written by the
 * client and is ignored. With 1 hop (the old fixed value) req.ip is <traefik>
 * for everyone: one shared bucket.
 *
 * Groups:
 *   1. parseTrustProxyHops / resolveTrustProxyHops, one case per input value.
 *   2. req.ip on a minimal app that uses the same setter as index.ts.
 *   3. The real app from ../index: separate RateLimit-Remaining counts per
 *      client address, no new bucket from a spoofed leftmost entry.
 *   4. The global limiter's skip list: /agents/message, /agents/me/presence and
 *      /auth/config are not counted (and /health, pinned elsewhere).
 *
 * Every request goes to an app on 127.0.0.1 (helpers/loopbackRequest); the
 * socket peer is the innermost trusted hop.
 */

import express from 'express';
import request from './helpers/loopbackRequest';
import {
  DEFAULT_TRUST_PROXY_HOPS,
  MAX_TRUST_PROXY_HOPS,
  parseTrustProxyHops,
  resolveTrustProxyHops,
} from '../utils/trust-proxy';

const SPOOF = '198.51.100.7';
const OTHER_SPOOF = '198.51.100.8';
const CLIENT_A = '203.0.113.10';
const CLIENT_B = '203.0.113.20';
const TRAEFIK = '172.18.0.2';

const chain = (spoof: string, client: string) => `${spoof}, ${client}, ${TRAEFIK}`;

describe('parseTrustProxyHops: one case per input value', () => {
  const accepted: Array<[string, string | undefined, number]> = [
    ['absent (undefined) gives the default 1', undefined, 1],
    ['empty string gives the default 1', '', 1],
    ['whitespace only gives the default 1', ' \t\n ', 1],
    ['"0" gives 0 (api reached directly)', '0', 0],
    ['"1" gives 1', '1', 1],
    ['"2" gives 2', '2', 2],
    ['"10" gives 10 (the maximum)', '10', 10],
    ['" 2 " is trimmed and gives 2', ' 2 ', 2],
  ];
  for (const [label, raw, hops] of accepted) {
    it(label, () => {
      expect(parseTrustProxyHops(raw)).toEqual({ ok: true, hops });
    });
  }

  const refused: Array<[string, string]> = [
    ['"11" (above the maximum)', '11'],
    ['"-1" (negative)', '-1'],
    ['"1.5" (not an integer)', '1.5'],
    ['"abc"', 'abc'],
    ['"true" (Express would trust every hop)', 'true'],
    ['an address list', '127.0.0.1,10.0.0.0/8'],
    ['"+2" (sign)', '+2'],
    ['"02" (leading zero)', '02'],
    ['"2 3" (two numbers)', '2 3'],
  ];
  for (const [label, raw] of refused) {
    it(`refuses ${label} and names the variable`, () => {
      const result = parseTrustProxyHops(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain('TRUST_PROXY_HOPS');
        expect(result.message).toContain(`0 to ${MAX_TRUST_PROXY_HOPS}`);
      }
    });
  }

  it('keeps the old fixed value as the default', () => {
    expect(DEFAULT_TRUST_PROXY_HOPS).toBe(1);
    expect(MAX_TRUST_PROXY_HOPS).toBe(10);
  });
});

describe('resolveTrustProxyHops', () => {
  it('returns a number, never the raw string (Express reads a string as an address list)', () => {
    const hops = resolveTrustProxyHops('2');
    expect(typeof hops).toBe('number');
    expect(hops).toBe(2);
  });

  it('returns the default number for an absent value', () => {
    expect(resolveTrustProxyHops(undefined)).toBe(1);
  });

  it('throws on an invalid value, naming the variable', () => {
    expect(() => resolveTrustProxyHops('true')).toThrow(/TRUST_PROXY_HOPS/);
  });
});

describe('req.ip behind the production chain (minimal app, same setter as index.ts)', () => {
  const ipApp = (raw: string | undefined) => {
    const app = express();
    app.set('trust proxy', resolveTrustProxyHops(raw));
    app.get('/ip', (req, res) => {
      res.json({ ip: req.ip });
    });
    return app;
  };

  it('2 hops: req.ip is the address Traefik added, the spoofed leftmost entry is ignored', async () => {
    const res = await request(ipApp('2')).get('/ip').set('X-Forwarded-For', chain(SPOOF, CLIENT_A));
    expect(res.body.ip).toBe(CLIENT_A);
  });

  it('1 hop (the old fixed value): req.ip is the Traefik address for every client, one shared bucket', async () => {
    const res = await request(ipApp('1')).get('/ip').set('X-Forwarded-For', chain(SPOOF, CLIENT_A));
    expect(res.body.ip).toBe(TRAEFIK);
  });

  it('absent: the default 1 hop gives the same result as "1"', async () => {
    const res = await request(ipApp(undefined)).get('/ip').set('X-Forwarded-For', chain(SPOOF, CLIENT_A));
    expect(res.body.ip).toBe(TRAEFIK);
  });

  it('0 hops: req.ip is the socket peer and X-Forwarded-For is ignored', async () => {
    const res = await request(ipApp('0')).get('/ip').set('X-Forwarded-For', chain(SPOOF, CLIENT_A));
    expect(res.body.ip).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
  });

  it('2 hops without X-Forwarded-For (host-local caller on port 4001): req.ip is the socket peer', async () => {
    const res = await request(ipApp('2')).get('/ip');
    expect(res.body.ip).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
  });
});

// GLOBAL_RATE_LIMIT_MAX and TRUST_PROXY_HOPS are read when ../index executes,
// so each case loads a fresh copy (with its own limiter store) under overrides.
function loadApp(env: Record<string, string | undefined>): express.Express {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  let app: express.Express | undefined;
  // Startup logging of the module (validation summary, optional variables).
  const quiet = [
    jest.spyOn(console, 'log').mockImplementation(() => { /* no-op: suppress startup output */ }),
    jest.spyOn(console, 'warn').mockImplementation(() => { /* no-op: suppress startup output */ }),
  ];
  try {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports -- deferred load so the env overrides are set before the module executes
      app = require('../index').app;
    });
  } finally {
    quiet.forEach(spy => spy.mockRestore());
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  if (!app) throw new Error('../index did not export an app');
  return app;
}

// A counted route: the global limiter is mounted at /api, an unknown path
// answers 404 after the limiter has counted it.
const COUNTED = '/api/__trust-proxy-probe';

async function remaining(app: express.Express, xff: string): Promise<number> {
  const res = await request(app).get(COUNTED).set('X-Forwarded-For', xff);
  return Number(res.headers['ratelimit-remaining']);
}

describe('global limiter buckets in the real app', () => {
  it('2 hops: two client addresses get separate counts, a spoofed leftmost entry opens no new bucket', async () => {
    const app = loadApp({ TRUST_PROXY_HOPS: '2', GLOBAL_RATE_LIMIT_MAX: '5' });
    expect(app.get('trust proxy')).toBe(2);
    expect(await remaining(app, chain(SPOOF, CLIENT_A))).toBe(4);
    expect(await remaining(app, chain(OTHER_SPOOF, CLIENT_A))).toBe(3);
    expect(await remaining(app, chain(SPOOF, CLIENT_B))).toBe(4);
    expect(await remaining(app, chain(SPOOF, CLIENT_A))).toBe(2);
  });

  it('1 hop (the old fixed value): every client shares the Traefik bucket', async () => {
    const app = loadApp({ TRUST_PROXY_HOPS: '1', GLOBAL_RATE_LIMIT_MAX: '5' });
    expect(await remaining(app, chain(SPOOF, CLIENT_A))).toBe(4);
    expect(await remaining(app, chain(SPOOF, CLIENT_B))).toBe(3);
  });

  it('absent TRUST_PROXY_HOPS: the app trusts the default 1 hop', async () => {
    const app = loadApp({ TRUST_PROXY_HOPS: undefined, GLOBAL_RATE_LIMIT_MAX: '5' });
    expect(app.get('trust proxy')).toBe(1);
    expect(await remaining(app, chain(SPOOF, CLIENT_A))).toBe(4);
    expect(await remaining(app, chain(SPOOF, CLIENT_B))).toBe(3);
  });
});

describe('global limiter skip list', () => {
  // With a budget of 1 the second counted request is a 429; skipped routes
  // must still not answer 429 after that, and a counted route still does.
  it('does not count /agents/message, /agents/me/presence or /auth/config', async () => {
    const app = loadApp({ TRUST_PROXY_HOPS: '2', GLOBAL_RATE_LIMIT_MAX: '1' });
    const xff = chain(SPOOF, CLIENT_A);

    const first = await request(app).get(COUNTED).set('X-Forwarded-For', xff);
    const second = await request(app).get(COUNTED).set('X-Forwarded-For', xff);
    expect([first.status, second.status]).toEqual([404, 429]);

    const message = await request(app).post('/api/agents/message').set('X-Forwarded-For', xff).send({});
    const presence = await request(app).post('/api/agents/me/presence').set('X-Forwarded-For', xff).send({});
    const config = await request(app).get('/api/auth/config').set('X-Forwarded-For', xff);
    expect(message.status).not.toBe(429);
    expect(presence.status).not.toBe(429);
    expect(config.status).toBe(200);

    const third = await request(app).get(COUNTED).set('X-Forwarded-For', xff);
    expect(third.status).toBe(429);
  });
});
