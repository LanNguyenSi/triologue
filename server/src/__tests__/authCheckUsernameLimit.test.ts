/**
 * GET /api/auth/check-username has its own rate limiter (30 per 5 minutes per
 * IP), separate from registerLimit, so an anonymous word list cannot
 * enumerate accounts at the global 600/min rate.
 *
 * Both limiters skip under NODE_ENV=test; like the login limiter test, these
 * cases switch NODE_ENV to 'production' around the requests so the real
 * limiters run. Each case loads a fresh route module (own in-memory stores),
 * so no case inherits another's counts.
 */
import express from 'express';
import request from './helpers/loopbackRequest';

jest.mock('../lib/prisma', () => {
  const g = globalThis as { __authCheckLimitPrismaMock?: object };
  const mock: Record<string, unknown> = {
    user: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    inviteCode: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    room: { findMany: jest.fn() },
    roomParticipant: { create: jest.fn(), upsert: jest.fn() },
    project: { findUnique: jest.fn(), update: jest.fn() },
  };
  mock.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(mock));
  g.__authCheckLimitPrismaMock ??= mock;
  return { __esModule: true, default: g.__authCheckLimitPrismaMock };
});

import prisma from '../lib/prisma';

const prismaMock = prisma as unknown as {
  user: { findFirst: jest.Mock; findUnique: jest.Mock };
};

const CHECK_MAX = 30;
const REGISTER_MAX = 3;

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
  return app;
}

const prevNodeEnv = process.env.NODE_ENV;
beforeEach(() => {
  process.env.NODE_ENV = 'production';
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.user.findFirst.mockResolvedValue(null);
});
afterEach(() => {
  process.env.NODE_ENV = prevNodeEnv;
  jest.clearAllMocks();
});

const check = (app: express.Express) =>
  request(app).get('/api/auth/check-username').query({ username: 'someone' });

describe('check-username rate limit', () => {
  it('answers 200 up to the limit', async () => {
    const app = loadApp();
    for (let i = 0; i < CHECK_MAX; i++) {
      await check(app).expect(200);
    }
  });

  it('answers 429 with the limiter message past the limit, without reading the database', async () => {
    const app = loadApp();
    for (let i = 0; i < CHECK_MAX; i++) {
      await check(app).expect(200);
    }
    prismaMock.user.findUnique.mockClear();
    const res = await check(app).expect(429);
    expect(res.body.error).toContain('Too many username checks');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('is separate from registerLimit: exhausting check-username leaves register usable', async () => {
    const app = loadApp();
    for (let i = 0; i <= CHECK_MAX; i++) {
      await check(app);
    }
    await check(app).expect(429);
    // Registration is not rate limited here (an invalid body answers 400 from validation, not 429).
    const res = await request(app).post('/api/auth/register').send({});
    expect(res.status).not.toBe(429);
  });

  it('is separate from registerLimit: exhausting register leaves check-username usable', async () => {
    const app = loadApp();
    for (let i = 0; i < REGISTER_MAX + 1; i++) {
      await request(app).post('/api/auth/register').send({});
    }
    const reg = await request(app).post('/api/auth/register').send({});
    expect(reg.status).toBe(429);
    expect(reg.body.error).toContain('Too many registration attempts');
    await check(app).expect(200);
  });
});
