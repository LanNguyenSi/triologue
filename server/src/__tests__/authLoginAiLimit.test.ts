/**
 * POST /api/auth/login never runs without a limiter outside NODE_ENV=test.
 * loginLimit (5 per 15 minutes per IP, every request) skips only AI-typed
 * bodies, and aiLoginLimit (10 per 15 minutes per IP, failed requests only,
 * skipSuccessfulRequests) handles exactly those AI_* bodies. So claiming
 * `userType: 'AI_*'` no longer removes the limit: failed AI logins from one
 * IP (the enumeration case: unknown username + AI_* type) hit 429 after the
 * bound, while a gateway logging in with valid agent tokens keeps answering
 * 200 beyond the bound because successes are not counted.
 *
 * Like authCheckUsernameLimit.test.ts, these cases switch NODE_ENV to
 * 'production' around the requests so the real limiters run, and each case
 * loads a fresh route module (own in-memory stores), so no case inherits
 * another's counts. The two limiters are told apart by their RateLimit-Policy
 * header: '5;w=900' is loginLimit, '10;w=900' is aiLoginLimit.
 */
import express from 'express';
import request from './helpers/loopbackRequest';

jest.mock('../lib/prisma', () => {
  const g = globalThis as { __loginAiLimitPrismaMock?: object };
  const mock: Record<string, unknown> = {
    user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    agentToken: { findFirst: jest.fn() },
    inviteCode: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    room: { findMany: jest.fn() },
    roomParticipant: { create: jest.fn(), upsert: jest.fn() },
    project: { findUnique: jest.fn(), update: jest.fn() },
  };
  mock.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(mock));
  g.__loginAiLimitPrismaMock ??= mock;
  return { __esModule: true, default: g.__loginAiLimitPrismaMock };
});

import prisma from '../lib/prisma';

const prismaMock = prisma as unknown as {
  user: { findFirst: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
  agentToken: { findFirst: jest.Mock };
};

const LOGIN_MAX = 5;
const AI_LOGIN_MAX = 10;
const LOGIN_POLICY = '5;w=900';
const AI_LOGIN_POLICY = '10;w=900';

const aiUser = {
  id: 'user-agent-1',
  username: 'bot1',
  displayName: 'Bot One',
  userType: 'AI_AGENT',
  isActive: true,
  passwordHash: null,
  authToken: null,
  tokenVersion: 0,
};
const activeAgentToken = { id: 'tok-1', token: 'byoa_secret', status: 'active', isActive: true };

function loadApp(): express.Express {
  let authRoutes: express.Router | undefined;
  jest.resetModules();
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- fresh module instance so the limiter stores start empty
    authRoutes = require('../routes/auth').authRoutes;
  });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes!);
  // loginLimit's skip() dereferences .startsWith on body.userType without a
  // type guard, so a truthy non-string userType throws there (pre-existing
  // behavior this file pins); answer 500 quietly instead of dumping a stack.
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: 'limiter middleware error' });
  });
  return app;
}

const login = (app: express.Express, body: Record<string, unknown>) =>
  request(app).post('/api/auth/login').send(body);

const aiBody = (userType: string) => ({ username: 'nobody', userType, aiToken: 'byoa_probe' });
const humanBody = { username: 'nobody', password: 'WrongPassw0rd!' };

const prevNodeEnv = process.env.NODE_ENV;
beforeEach(() => {
  process.env.NODE_ENV = 'production';
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.user.update.mockResolvedValue({});
  prismaMock.agentToken.findFirst.mockResolvedValue(null);
});
afterEach(() => {
  process.env.NODE_ENV = prevNodeEnv;
  jest.clearAllMocks();
});

describe('AI-typed logins are limited by aiLoginLimit (failures only)', () => {
  it('answers 429 after 10 failed AI-typed logins from one IP (enumeration of unknown usernames)', async () => {
    const app = loadApp();
    const first = await login(app, aiBody('AI_LAVA')).expect(401);
    expect(first.headers['ratelimit-policy']).toBe(AI_LOGIN_POLICY);
    for (let i = 1; i < AI_LOGIN_MAX; i++) {
      await login(app, aiBody('AI_LAVA')).expect(401);
    }
    prismaMock.user.findUnique.mockClear();
    const blocked = await login(app, aiBody('AI_LAVA')).expect(429);
    expect(blocked.body.error).toContain('Too many login attempts');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('keeps answering 200 beyond the bound while the AI logins succeed (valid token, failures only are counted)', async () => {
    const app = loadApp();
    prismaMock.user.findUnique.mockResolvedValue(aiUser);
    prismaMock.agentToken.findFirst.mockResolvedValue(activeAgentToken);
    prismaMock.user.update.mockResolvedValue(aiUser);
    for (let i = 0; i < AI_LOGIN_MAX + 5; i++) {
      const res = await login(app, { username: 'bot1', userType: 'AI_AGENT', aiToken: 'byoa_secret' }).expect(200);
      expect(res.body.token).toEqual(expect.any(String));
    }
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(AI_LOGIN_MAX + 5);
  });

  it('is skipped under NODE_ENV=test: far past the bound every AI login answers 401', async () => {
    process.env.NODE_ENV = 'test';
    const app = loadApp();
    for (let i = 0; i < AI_LOGIN_MAX + 5; i++) {
      await login(app, aiBody('AI_LAVA')).expect(401);
    }
  });
});

describe('human/unset userType keeps loginLimit', () => {
  it('answers 429 after 5 failed human logins from one IP, unchanged', async () => {
    const app = loadApp();
    for (let i = 0; i < LOGIN_MAX; i++) {
      await login(app, humanBody).expect(401);
    }
    prismaMock.user.findUnique.mockClear();
    const blocked = await login(app, humanBody).expect(429);
    expect(blocked.body.error).toContain('Too many login attempts');
    expect(blocked.headers['ratelimit-policy']).toBe(LOGIN_POLICY);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('limiter selection per userType (precedence)', () => {
  it('an absent userType is limited by loginLimit (policy 5;w=900)', async () => {
    const app = loadApp();
    const res = await login(app, humanBody).expect(401);
    expect(res.headers['ratelimit-policy']).toBe(LOGIN_POLICY);
  });

  it('userType HUMAN is limited by loginLimit (policy 5;w=900)', async () => {
    const app = loadApp();
    const res = await login(app, { ...humanBody, userType: 'HUMAN' }).expect(401);
    expect(res.headers['ratelimit-policy']).toBe(LOGIN_POLICY);
  });

  it('an empty-string userType is limited by loginLimit, not aiLoginLimit', async () => {
    const app = loadApp();
    // '' is not in the Joi valid list, so validation answers 400 after
    // loginLimit has counted the attempt.
    const res = await login(app, { ...humanBody, userType: '' }).expect(400);
    expect(res.headers['ratelimit-policy']).toBe(LOGIN_POLICY);
  });

  it.each(['AI_AGENT', 'AI_ICE', 'AI_LAVA', 'AI_OTHER'] as const)(
    'userType %s is limited by aiLoginLimit (policy 10;w=900)',
    async (userType) => {
      const app = loadApp();
      const res = await login(app, aiBody(userType)).expect(401);
      expect(res.headers['ratelimit-policy']).toBe(AI_LOGIN_POLICY);
    },
  );

  it('a falsy non-string userType (false) falls to loginLimit (not an AI_ prefix)', async () => {
    const app = loadApp();
    const res = await login(app, { ...humanBody, userType: false }).expect(400);
    expect(res.headers['ratelimit-policy']).toBe(LOGIN_POLICY);
  });

  it('a truthy non-string userType (123) fails inside loginLimit and reaches neither auth branch', async () => {
    // Pre-existing behavior, pinned: loginLimit's skip dereferences
    // .startsWith on it, the middleware chain errors before the handler,
    // so no login succeeds and no limiter is escaped (no token is issued).
    const app = loadApp();
    const res = await login(app, { ...humanBody, userType: 123 }).expect(500);
    expect(res.body.token).toBeUndefined();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('a non-string object userType behaves like the numeric case (no login, no bypass)', async () => {
    const app = loadApp();
    const res = await login(app, { ...humanBody, userType: {} }).expect(500);
    expect(res.body.token).toBeUndefined();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('the two login limiters are independent', () => {
  it('exhausting aiLoginLimit leaves loginLimit usable', async () => {
    const app = loadApp();
    for (let i = 0; i <= AI_LOGIN_MAX; i++) {
      await login(app, aiBody('AI_LAVA'));
    }
    await login(app, aiBody('AI_LAVA')).expect(429);
    const human = await login(app, humanBody).expect(401);
    expect(human.headers['ratelimit-policy']).toBe(LOGIN_POLICY);
  });

  it('exhausting loginLimit leaves aiLoginLimit usable', async () => {
    const app = loadApp();
    for (let i = 0; i <= LOGIN_MAX; i++) {
      await login(app, humanBody);
    }
    await login(app, humanBody).expect(429);
    const ai = await login(app, aiBody('AI_AGENT')).expect(401);
    expect(ai.headers['ratelimit-policy']).toBe(AI_LOGIN_POLICY);
  });
});
