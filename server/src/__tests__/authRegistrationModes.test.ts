/**
 * Regression coverage for POST /api/auth/register under REGISTRATION_MODE
 * closed/invite.
 *
 * Both mode gates in routes/auth.ts used to be conditioned on
 * `userType === 'HUMAN'`, so a self-declared non-HUMAN userType (AI_AGENT,
 * AI_ICE, AI_LAVA, AI_OTHER) skipped the closed-beta block and the
 * invite-code requirement entirely: an anonymous, unauthenticated caller
 * could mint an active account with a 30-day JWT (userType !== 'HUMAN' gets
 * the longer expiry) by simply setting userType in the request body.
 *
 * AI accounts are provisioned exclusively through the authenticated BYOA
 * agent-token flow (POST /api/agents, see routes/agents.ts), never through
 * this public route (see the QUARANTINED tests in auth.test.ts), so the fix
 * rejects any client-supplied non-HUMAN userType outright, independent of
 * REGISTRATION_MODE.
 *
 * This is a route-level unit test (mocked prisma, no DB), so it runs
 * without RUN_DB_TESTS / a live Postgres, unlike the integration suite in
 * auth.test.ts.
 */
import express from 'express';
import request from 'supertest';

// The factory returns a globalThis-backed singleton: loadApp() below uses
// jest.resetModules()/isolateModules(), which re-executes this factory per
// load. Without the singleton each isolated router instance would get FRESH
// jest.fn()s, so assertions on the top-level `prismaMock` would inspect a
// different object than the one the route actually called (making
// not.toHaveBeenCalled() checks inert and the happy path un-mockable).
jest.mock('../lib/prisma', () => {
  const g = globalThis as { __authRegModesPrismaMock?: object };
  g.__authRegModesPrismaMock ??= {
    user: { findFirst: jest.fn(), create: jest.fn() },
    inviteCode: { findUnique: jest.fn(), update: jest.fn() },
    room: { findMany: jest.fn() },
    roomParticipant: { create: jest.fn(), upsert: jest.fn() },
    project: { findUnique: jest.fn(), update: jest.fn() },
  };
  return { __esModule: true, default: g.__authRegModesPrismaMock };
});

import prisma from '../lib/prisma';

const prismaMock = prisma as unknown as {
  user: { findFirst: jest.Mock; create: jest.Mock };
  inviteCode: { findUnique: jest.Mock; update: jest.Mock };
  room: { findMany: jest.Mock };
  roomParticipant: { create: jest.Mock; upsert: jest.Mock };
};

const ORIGINAL_REGISTRATION_MODE = process.env.REGISTRATION_MODE;

afterEach(() => {
  jest.clearAllMocks();
  if (ORIGINAL_REGISTRATION_MODE === undefined) {
    delete process.env.REGISTRATION_MODE;
  } else {
    process.env.REGISTRATION_MODE = ORIGINAL_REGISTRATION_MODE;
  }
});

/**
 * Loads a fresh `authRoutes` with REGISTRATION_MODE set before import,
 * since routes/auth.ts resolves REGISTRATION_MODE from process.env once at
 * module-import time. Returns a minimal app with only the auth router
 * mounted.
 */
function loadApp(mode: 'open' | 'invite' | 'closed'): express.Express {
  process.env.REGISTRATION_MODE = mode;
  let authRoutes: express.Router | undefined;
  jest.resetModules();
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- deferred load so REGISTRATION_MODE is read fresh for this module instance
    authRoutes = require('../routes/auth').authRoutes;
  });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes!);
  return app;
}

const aiUser = (overrides: Record<string, unknown> = {}) => ({
  username: 'rogue_ai',
  email: 'rogue@example.com',
  // The register schema requires `password` unconditionally (unlike login),
  // so a realistic attacker payload includes one even for a self-declared
  // AI userType.
  password: 'Password123',
  displayName: 'Rogue AI',
  userType: 'AI_AGENT',
  ...overrides,
});

const humanUser = (overrides: Record<string, unknown> = {}) => ({
  username: 'plain_human',
  email: 'human@example.com',
  password: 'Password123',
  displayName: 'Plain Human',
  userType: 'HUMAN',
  ...overrides,
});

describe('POST /api/auth/register — non-HUMAN userType bypass', () => {
  it('rejects a self-declared AI_AGENT registration under REGISTRATION_MODE=closed', async () => {
    const app = loadApp('closed');

    const response = await request(app).post('/api/auth/register').send(aiUser());

    expect(response.status).toBe(403);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('rejects a self-declared AI_AGENT registration under REGISTRATION_MODE=invite, even without an invite code', async () => {
    const app = loadApp('invite');

    const response = await request(app).post('/api/auth/register').send(aiUser());

    expect(response.status).toBe(403);
    expect(prismaMock.inviteCode.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it.each(['AI_AGENT', 'AI_ICE', 'AI_LAVA', 'AI_OTHER'])(
    'rejects userType %s even under REGISTRATION_MODE=open',
    async (userType) => {
      const app = loadApp('open');

      const response = await request(app)
        .post('/api/auth/register')
        .send(aiUser({ userType }));

      expect(response.status).toBe(403);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    }
  );

  it('rejects a case-tricked userType (ai_agent) at the Joi layer with 400, before the guard', async () => {
    const app = loadApp('open');

    const response = await request(app)
      .post('/api/auth/register')
      .send(aiUser({ userType: 'ai_agent' }));

    expect(response.status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('does not reach the uniqueness/DB path for a rejected non-HUMAN request', async () => {
    const app = loadApp('closed');

    await request(app).post('/api/auth/register').send(aiUser());

    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/register — HUMAN registration behavior is unchanged', () => {
  it('still blocks a HUMAN registration under REGISTRATION_MODE=closed with the original message', async () => {
    const app = loadApp('closed');

    const response = await request(app).post('/api/auth/register').send(humanUser());

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Registration is currently closed.');
  });

  it('still requires an invite code for a HUMAN registration under REGISTRATION_MODE=invite', async () => {
    const app = loadApp('invite');

    const response = await request(app).post('/api/auth/register').send(humanUser());

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('An invite code is required (closed beta).');
  });

  it('still registers a HUMAN under REGISTRATION_MODE=open (201, user created)', async () => {
    const app = loadApp('open');
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-1',
      username: 'plain_human',
      email: 'human@example.com',
      displayName: 'Plain Human',
      userType: 'HUMAN',
      passwordHash: 'hashed',
      authToken: null,
      isActive: true,
    });
    prismaMock.room.findMany.mockResolvedValue([]);

    const response = await request(app).post('/api/auth/register').send(humanUser());

    expect(response.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.create.mock.calls[0][0].data.userType).toBe('HUMAN');
  });

  it('an omitted userType defaults to HUMAN and is still subject to the closed gate', async () => {
    const app = loadApp('closed');
    const { userType: _drop, ...withoutUserType } = humanUser();

    const response = await request(app).post('/api/auth/register').send(withoutUserType);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Registration is currently closed.');
  });
});
