/**
 * POST /api/auth/register and GET /api/auth/check-username refuse the
 * service-account usernames (SERVICE_ACCOUNT_USERNAMES in
 * lib/serviceAccounts.ts) in every REGISTRATION_MODE.
 *
 * Without the reservation, anyone could register e.g. `gateway` on an
 * instance where that account does not exist yet. Such an account would be
 * hidden from participant and user lists (rooms.ts/users.ts), and it would
 * hold the name before the operator provisions the real gateway account.
 * agents.ts trusts a bearer token as the gateway's when its user carries a
 * reserved name, so it would also trust such an account if it ever held a
 * token.
 *
 * Route-level unit test with a mocked prisma (no DB), in the style of
 * authRegistrationModes.test.ts.
 */
import express from 'express';
import request from './helpers/loopbackRequest';
import { SERVICE_ACCOUNT_USERNAMES, isServiceAccountUsername } from '../lib/serviceAccounts';

jest.mock('../lib/prisma', () => {
  const g = globalThis as { __authReservedPrismaMock?: object };
  g.__authReservedPrismaMock ??= {
    user: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    inviteCode: { findUnique: jest.fn(), update: jest.fn() },
    room: { findMany: jest.fn() },
    roomParticipant: { create: jest.fn(), upsert: jest.fn() },
    project: { findUnique: jest.fn(), update: jest.fn() },
  };
  return { __esModule: true, default: g.__authReservedPrismaMock };
});

import prisma from '../lib/prisma';

const prismaMock = prisma as unknown as {
  user: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock };
  inviteCode: { findUnique: jest.Mock; update: jest.Mock };
  room: { findMany: jest.Mock };
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

type Mode = 'open' | 'invite' | 'closed';

function loadApp(mode: Mode): express.Express {
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

const humanUser = (overrides: Record<string, unknown> = {}) => ({
  username: 'plain_human',
  email: 'human@example.com',
  password: 'Password123',
  displayName: 'Plain Human',
  userType: 'HUMAN',
  inviteCode: 'VALIDCODE1',
  ...overrides,
});

// The reservation check runs after the username/email uniqueness lookup
// (user.findFirst, read-only) so that an existing service account keeps
// answering 409, and before the invite-code step.
function expectNothingTouched() {
  expect(prismaMock.user.create).not.toHaveBeenCalled();
  expect(prismaMock.inviteCode.findUnique).not.toHaveBeenCalled();
  expect(prismaMock.inviteCode.update).not.toHaveBeenCalled();
}

beforeEach(() => {
  // A valid, unused invite code: if the reservation check were missing or
  // ran after the invite step, invite mode would proceed to create the user
  // and consume this code.
  prismaMock.inviteCode.findUnique.mockResolvedValue({
    code: 'VALIDCODE1',
    isActive: true,
    expiresAt: null,
    useCount: 0,
    maxUses: 1,
    note: null,
  });
  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.user.create.mockResolvedValue({
    id: 'user-1',
    username: 'x',
    email: 'human@example.com',
    displayName: 'Plain Human',
    userType: 'HUMAN',
    passwordHash: 'hashed',
    authToken: null,
    isActive: true,
  });
  prismaMock.room.findMany.mockResolvedValue([]);
});

describe('SERVICE_ACCOUNT_USERNAMES', () => {
  it('pins the reserved names independently of the constant', () => {
    expect([...SERVICE_ACCOUNT_USERNAMES].sort()).toEqual(['gateway', 'gateway-agent-001']);
  });

  it('lists the gateway service accounts in lowercase', () => {
    expect(SERVICE_ACCOUNT_USERNAMES.length).toBeGreaterThan(0);
    for (const name of SERVICE_ACCOUNT_USERNAMES) {
      expect(name).toBe(name.toLowerCase().trim());
    }
  });

  it('isServiceAccountUsername ignores case and surrounding whitespace', () => {
    for (const name of SERVICE_ACCOUNT_USERNAMES) {
      expect(isServiceAccountUsername(name)).toBe(true);
      expect(isServiceAccountUsername(name.toUpperCase())).toBe(true);
      expect(isServiceAccountUsername(`  ${name} `)).toBe(true);
    }
    expect(isServiceAccountUsername('plain_human')).toBe(false);
    expect(isServiceAccountUsername(undefined)).toBe(false);
  });
});

describe('POST /api/auth/register — reserved service-account usernames', () => {
  it.each(['gateway', 'gateway-agent-001'])('refuses the literal name %s in open mode', async (name) => {
    const app = loadApp('open');

    const response = await request(app).post('/api/auth/register').send(humanUser({ username: name }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('This username is reserved.');
    expectNothingTouched();
  });

  const modes: Mode[] = ['open', 'invite'];
  const cases = modes.flatMap((mode) =>
    SERVICE_ACCOUNT_USERNAMES.map((name) => [mode, name] as const),
  );

  it.each(cases)('REGISTRATION_MODE=%s refuses %s without creating a user or touching an invite', async (mode, name) => {
    const app = loadApp(mode);

    const response = await request(app).post('/api/auth/register').send(humanUser({ username: name }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('This username is reserved.');
    expectNothingTouched();
  });

  it.each([...SERVICE_ACCOUNT_USERNAMES])('REGISTRATION_MODE=closed refuses %s (the closed gate answers first) without any DB access', async (name) => {
    const app = loadApp('closed');

    const response = await request(app).post('/api/auth/register').send(humanUser({ username: name }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Registration is currently closed.');
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expectNothingTouched();
  });

  it.each(cases)('REGISTRATION_MODE=%s still answers 409 for %s when the service account exists', async (mode, name) => {
    const app = loadApp(mode);
    prismaMock.user.findFirst.mockResolvedValueOnce({ id: 'gw-1', username: name, email: 'gw@example.com' });

    const response = await request(app).post('/api/auth/register').send(humanUser({ username: name }));

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Username already taken.');
    expectNothingTouched();
  });

  it.each(cases)('REGISTRATION_MODE=%s checks the sanitized username for %s against the uniqueness lookup', async (mode, name) => {
    const app = loadApp(mode);

    await request(app).post('/api/auth/register').send(humanUser({ username: name.toUpperCase() }));

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ username: name }, { email: 'human@example.com' }] },
    });
  });

  it.each(cases)('REGISTRATION_MODE=%s refuses an upper-case variant of %s (the route lowercases usernames)', async (mode, name) => {
    const app = loadApp(mode);

    const response = await request(app)
      .post('/api/auth/register')
      .send(humanUser({ username: name.toUpperCase() }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('This username is reserved.');
    expectNothingTouched();
  });

  it('refuses a reserved username without an invite code under invite mode', async () => {
    const app = loadApp('invite');
    const { inviteCode: _drop, ...body } = humanUser({ username: SERVICE_ACCOUNT_USERNAMES[0] });

    const response = await request(app).post('/api/auth/register').send(body);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('This username is reserved.');
    expectNothingTouched();
  });

  it('still registers a non-reserved username that merely contains a reserved one', async () => {
    const app = loadApp('open');

    const response = await request(app)
      .post('/api/auth/register')
      .send(humanUser({ username: `${SERVICE_ACCOUNT_USERNAMES[0]}_fan` }));

    expect(response.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
  });

  it('still registers and consumes the invite for a non-reserved username under invite mode', async () => {
    const app = loadApp('invite');

    const response = await request(app).post('/api/auth/register').send(humanUser());

    expect(response.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.inviteCode.update).toHaveBeenCalled();
  });
});

describe('GET /api/auth/check-username — reserved service-account usernames', () => {
  it.each([...SERVICE_ACCOUNT_USERNAMES])('reports %s as unavailable (reserved) without a DB lookup', async (name) => {
    const app = loadApp('open');

    const response = await request(app)
      .get('/api/auth/check-username')
      .query({ username: name.toUpperCase() });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ available: false, reason: 'reserved' });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});
