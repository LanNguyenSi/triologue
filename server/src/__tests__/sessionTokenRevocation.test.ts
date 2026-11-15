/**
 * Session JWT revocation (User.tokenVersion).
 *
 * A human session JWT carries the user's `tokenVersion`; a password change
 * increments it, so tokens signed earlier stop verifying everywhere a session
 * JWT is accepted, while the account stays active. Rule under test (see
 * lib/sessionToken.ts): a token without the claim counts as version 0; it is
 * accepted only when its version is an integer equal to the user's current
 * one. `byoa_` agent tokens never go through this check.
 *
 * Route-level unit test: Prisma is replaced by a small in-memory user store
 * that applies `{ increment: 1 }` the way the database does, so the full
 * login -> change password -> old token -> new token flow runs without a
 * database. The real-database round trip is in auth.test.ts (RUN_DB_TESTS).
 *
 * Mutation-check intent (each one makes at least one test below fail):
 *   - drop the version comparison in sessionTokenIsCurrent -> every
 *     "stale token" case fails;
 *   - treat a missing claim as "accept" -> "no claim after a bump" fails;
 *   - drop `tokenVersion: { increment: 1 }` from change-password or from
 *     PATCH /me -> the matching "old token is refused" case fails;
 *   - sign the replacement token with the pre-increment row -> "new token
 *     works" fails;
 *   - drop the claim from the login or register payload -> the claim-in-payload
 *     cases fail;
 *   - drop the check from authenticate, optionalAuth or /verify -> the
 *     matching stale-token case fails.
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import request from './helpers/loopbackRequest';

type FakeUser = {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  userType: 'HUMAN' | 'AI_AGENT';
  isActive: boolean;
  isAdmin: boolean;
  canTriggerAI: boolean;
  passwordHash: string | null;
  authToken: string | null;
  tokenVersion: number;
  lastSeen: Date;
};

const users = new Map<string, FakeUser>();

jest.mock('../lib/prisma', () => {
  const g = globalThis as { __sessionRevocationPrisma?: object };
  const mock: Record<string, unknown> = {};
  g.__sessionRevocationPrisma ??= mock;
  return { __esModule: true, default: g.__sessionRevocationPrisma };
});

jest.mock('../services/agentTokenRotation', () => ({
  findAgentTokenByRawToken: jest.fn(),
}));

import prisma from '../lib/prisma';
import { findAgentTokenByRawToken } from '../services/agentTokenRotation';
import { authRoutes } from '../routes/auth';
import { authenticate, optionalAuth } from '../middleware/auth';
import { sessionTokenIsCurrent } from '../lib/sessionToken';

const findAgentToken = findAgentTokenByRawToken as jest.Mock;
const SECRET = process.env.JWT_SECRET!;
const OLD_PASSWORD = 'OldPassword1';
const NEW_PASSWORD = 'NewPassword2';

function installFakePrisma() {
  const update = jest.fn(async ({ where, data }: { where: { id?: string; username?: string }; data: Record<string, unknown> }) => {
    const row = where.id ? users.get(where.id) : [...users.values()].find((u) => u.username === where.username);
    if (!row) throw new Error('no such user');
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && 'increment' in (value as object)) {
        (row as Record<string, unknown>)[key] = (row[key as keyof FakeUser] as number) + (value as { increment: number }).increment;
      } else {
        (row as Record<string, unknown>)[key] = value;
      }
    }
    return { ...row };
  });
  const findUnique = jest.fn(async ({ where }: { where: { id?: string; username?: string } }) => {
    const row = where.id ? users.get(where.id) : [...users.values()].find((u) => u.username === where.username);
    return row ? { ...row } : null;
  });
  Object.assign(prisma as unknown as Record<string, unknown>, { user: { findUnique, update } });
  return { update, findUnique };
}

let fake: ReturnType<typeof installFakePrisma>;

function addUser(overrides: Partial<FakeUser> = {}): FakeUser {
  const user: FakeUser = {
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    displayName: 'Alice',
    userType: 'HUMAN',
    isActive: true,
    isAdmin: false,
    canTriggerAI: true,
    passwordHash: bcrypt.hashSync(OLD_PASSWORD, 4),
    authToken: null,
    tokenVersion: 0,
    lastSeen: new Date(),
    ...overrides,
  };
  users.set(user.id, user);
  return user;
}

/** A session token as login signed it, with or without the claim. */
function sessionToken(user: FakeUser, claim: number | string | null | 'absent'): string {
  const payload: Record<string, unknown> = {
    userId: user.id,
    username: user.username,
    userType: user.userType,
    displayName: user.displayName,
  };
  if (claim !== 'absent') payload.tokenVersion = claim;
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.get('/protected', authenticate, (req, res) => res.json({ id: req.user!.id }));
  app.get('/optional', optionalAuth, (req, res) => res.json({ id: req.user?.id ?? null }));
  return app;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => {
  users.clear();
  findAgentToken.mockReset();
  fake = installFakePrisma();
});

describe('sessionTokenIsCurrent (the single rule every verifier uses)', () => {
  // [claim in the token ("absent" = no claim), version on the user, accepted]
  const table: [unknown, number, boolean][] = [
    ['absent', 0, true], // legacy token while the user was never bumped
    ['absent', 1, false], // legacy token after the first bump
    [0, 0, true],
    [1, 1, true],
    [0, 1, false], // stale
    [1, 0, false], // from the future (user row restored from a backup)
    [2, 1, false],
    ['1', 1, false], // wrong type is not coerced
    [1.5, 1, false],
    [null, 0, false], // an explicit null is not "absent"
    [Number.NaN, 0, false],
  ];
  it.each(table)('claim %p against user version %p -> %p', (claim, version, expected) => {
    const decoded = claim === 'absent' ? {} : { tokenVersion: claim };
    expect(sessionTokenIsCurrent(decoded, { tokenVersion: version })).toBe(expected);
  });

  it('fails closed when the user row carries no version at all', () => {
    expect(sessionTokenIsCurrent({}, {} as { tokenVersion: number })).toBe(false);
    expect(sessionTokenIsCurrent({ tokenVersion: 0 }, {} as { tokenVersion: number })).toBe(false);
  });
});

describe('authenticate', () => {
  it('accepts a token whose version equals the user version', async () => {
    const user = addUser({ tokenVersion: 3 });
    const res = await request(buildApp()).get('/protected').set(bearer(sessionToken(user, 3)));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('user-1');
  });

  it('refuses a stale token with the same 401 body as an invalid token', async () => {
    const user = addUser({ tokenVersion: 1 });
    const stale = await request(buildApp()).get('/protected').set(bearer(sessionToken(user, 0)));
    const garbage = await request(buildApp()).get('/protected').set(bearer('not-a-jwt'));
    expect(stale.status).toBe(401);
    expect(stale.body).toEqual({ error: 'Invalid token' });
    expect(stale.body).toEqual(garbage.body);
    expect(stale.status).toBe(garbage.status);
  });

  it('accepts a token without the claim while the user is still at the default version', async () => {
    const user = addUser({ tokenVersion: 0 });
    const res = await request(buildApp()).get('/protected').set(bearer(sessionToken(user, 'absent')));
    expect(res.status).toBe(200);
  });

  it('refuses a token without the claim once the user version was bumped', async () => {
    const user = addUser({ tokenVersion: 1 });
    const res = await request(buildApp()).get('/protected').set(bearer(sessionToken(user, 'absent')));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid token' });
  });

  it('refuses a token whose claim is not an integer', async () => {
    const user = addUser({ tokenVersion: 1 });
    const res = await request(buildApp()).get('/protected').set(bearer(sessionToken(user, '1')));
    expect(res.status).toBe(401);
  });

  it('leaves a byoa_ agent token alone, whatever the owner user version is', async () => {
    findAgentToken.mockResolvedValue({
      isActive: true,
      status: 'active',
      agentUser: { id: 'agent-1', username: 'bot', displayName: 'Bot', userType: 'AI_AGENT', isActive: true, isAdmin: false },
    });
    addUser({ id: 'agent-1', username: 'bot', userType: 'AI_AGENT', passwordHash: null, tokenVersion: 7 });
    const res = await request(buildApp()).get('/protected').set(bearer('byoa_whatever'));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('agent-1');
    expect(fake.findUnique).not.toHaveBeenCalled();
  });

  it('keeps an AI user JWT (30 day login token) working at the default version', async () => {
    const agent = addUser({ id: 'agent-2', username: 'bot2', userType: 'AI_AGENT', passwordHash: null, tokenVersion: 0 });
    const res = await request(buildApp()).get('/protected').set(bearer(sessionToken(agent, 0)));
    expect(res.status).toBe(200);
  });
});

describe('optionalAuth', () => {
  it('attaches the user for a current token and continues anonymously for a stale one', async () => {
    const user = addUser({ tokenVersion: 2 });
    const current = await request(buildApp()).get('/optional').set(bearer(sessionToken(user, 2)));
    const stale = await request(buildApp()).get('/optional').set(bearer(sessionToken(user, 1)));
    expect(current.body.id).toBe('user-1');
    expect(stale.status).toBe(200);
    expect(stale.body.id).toBeNull();
  });
});

describe('GET /api/auth/verify', () => {
  it('answers 200 for a current token and for a no-claim token at the default version', async () => {
    const user = addUser({ tokenVersion: 0 });
    const withClaim = await request(buildApp()).get('/api/auth/verify').set(bearer(sessionToken(user, 0)));
    const noClaim = await request(buildApp()).get('/api/auth/verify').set(bearer(sessionToken(user, 'absent')));
    expect(withClaim.status).toBe(200);
    expect(noClaim.status).toBe(200);
  });

  it('answers 401 Invalid token for a stale token and for a no-claim token after a bump', async () => {
    const user = addUser({ tokenVersion: 1 });
    const stale = await request(buildApp()).get('/api/auth/verify').set(bearer(sessionToken(user, 0)));
    const noClaim = await request(buildApp()).get('/api/auth/verify').set(bearer(sessionToken(user, 'absent')));
    expect(stale.status).toBe(401);
    expect(stale.body).toEqual({ error: 'Invalid token' });
    expect(noClaim.status).toBe(401);
    expect(noClaim.body).toEqual({ error: 'Invalid token' });
  });
});

describe('login and register put the version in the token', () => {
  it('login signs the user version into the payload', async () => {
    addUser({ tokenVersion: 4 });
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ username: 'alice', password: OLD_PASSWORD, userType: 'HUMAN' });
    expect(res.status).toBe(200);
    const claims = jwt.verify(res.body.token, SECRET) as { tokenVersion?: number };
    expect(claims.tokenVersion).toBe(4);
    // and the fresh token passes the middleware
    const again = await request(buildApp()).get('/protected').set(bearer(res.body.token));
    expect(again.status).toBe(200);
  });

  it('a token from before a password change cannot be re-used, a new login works', async () => {
    const user = addUser();
    const before = await request(buildApp())
      .post('/api/auth/login')
      .send({ username: 'alice', password: OLD_PASSWORD, userType: 'HUMAN' });
    user.passwordHash = bcrypt.hashSync(NEW_PASSWORD, 4);
    user.tokenVersion += 1;
    const old = await request(buildApp()).get('/protected').set(bearer(before.body.token));
    const relogin = await request(buildApp())
      .post('/api/auth/login')
      .send({ username: 'alice', password: NEW_PASSWORD, userType: 'HUMAN' });
    expect(old.status).toBe(401);
    const fresh = await request(buildApp()).get('/protected').set(bearer(relogin.body.token));
    expect(fresh.status).toBe(200);
  });
});

describe('PUT /api/auth/change-password', () => {
  const change = (token: string, body: Record<string, string> = { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD }) =>
    request(buildApp()).put('/api/auth/change-password').set(bearer(token)).send(body);

  it('increments the version, returns a fresh token, and revokes the old one', async () => {
    const user = addUser({ tokenVersion: 0 });
    const oldToken = sessionToken(user, 0);

    const res = await change(oldToken);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Password changed successfully');
    expect(user.tokenVersion).toBe(1);
    expect(fake.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tokenVersion: { increment: 1 } }) }),
    );

    // the replacement carries the NEW version and works
    const claims = jwt.verify(res.body.token, SECRET) as { tokenVersion: number; userId: string };
    expect(claims).toMatchObject({ tokenVersion: 1, userId: 'user-1' });
    const works = await request(buildApp()).get('/protected').set(bearer(res.body.token));
    expect(works.status).toBe(200);

    // the token used for the request is dead, over HTTP
    const dead = await request(buildApp()).get('/protected').set(bearer(oldToken));
    expect(dead.status).toBe(401);
    expect(dead.body).toEqual({ error: 'Invalid token' });
  });

  it('revokes a legacy token without the claim', async () => {
    const user = addUser({ tokenVersion: 0 });
    const legacy = sessionToken(user, 'absent');
    expect((await change(legacy)).status).toBe(200);
    const dead = await request(buildApp()).get('/protected').set(bearer(legacy));
    expect(dead.status).toBe(401);
  });

  it('changes nothing and issues no token when the current password is wrong', async () => {
    const user = addUser({ tokenVersion: 0 });
    const res = await change(sessionToken(user, 0), { currentPassword: 'WrongPassword1', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(user.tokenVersion).toBe(0);
    expect(fake.update).not.toHaveBeenCalled();
  });

  it('refuses a stale token before it can change the password', async () => {
    const user = addUser({ tokenVersion: 1 });
    const res = await change(sessionToken(user, 0));
    expect(res.status).toBe(401);
    expect(user.tokenVersion).toBe(1);
    expect(fake.update).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/auth/me', () => {
  const patch = (token: string, body: Record<string, string>) =>
    request(buildApp()).patch('/api/auth/me').set(bearer(token)).send(body);

  it('a password change increments the version, returns a fresh token, and revokes the old one', async () => {
    const user = addUser({ tokenVersion: 0 });
    const oldToken = sessionToken(user, 0);

    const res = await patch(oldToken, { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(user.tokenVersion).toBe(1);
    expect((jwt.verify(res.body.token, SECRET) as { tokenVersion: number }).tokenVersion).toBe(1);
    expect((await request(buildApp()).get('/protected').set(bearer(res.body.token))).status).toBe(200);
    expect((await request(buildApp()).get('/protected').set(bearer(oldToken))).status).toBe(401);
  });

  it('a display name change leaves the version and the token alone', async () => {
    const user = addUser({ tokenVersion: 0 });
    const oldToken = sessionToken(user, 0);

    const res = await patch(oldToken, { displayName: 'Alice Two' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(user.tokenVersion).toBe(0);
    expect((await request(buildApp()).get('/protected').set(bearer(oldToken))).status).toBe(200);
  });

  it('a wrong current password changes nothing', async () => {
    const user = addUser({ tokenVersion: 0 });
    const res = await patch(sessionToken(user, 0), { currentPassword: 'WrongPassword1', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(user.tokenVersion).toBe(0);
    expect(fake.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/register', () => {
  it('signs the new user version into the token', async () => {
    // routes/auth.ts reads REGISTRATION_MODE once at import; jest.setup.js sets "open".
    const created: FakeUser = {
      id: 'user-9',
      username: 'newbie',
      email: 'newbie@example.com',
      displayName: 'Newbie',
      userType: 'HUMAN',
      isActive: true,
      isAdmin: false,
      canTriggerAI: true,
      passwordHash: 'x',
      authToken: null,
      tokenVersion: 3, // read from the created row, not assumed to be the default
      lastSeen: new Date(),
    };
    const userModel = (prisma as unknown as { user: Record<string, jest.Mock> }).user;
    userModel.findFirst = jest.fn().mockResolvedValue(null);
    userModel.create = jest.fn().mockResolvedValue(created);
    Object.assign(prisma as unknown as Record<string, unknown>, {
      room: { findMany: jest.fn().mockResolvedValue([]) },
      roomParticipant: { create: jest.fn(), upsert: jest.fn() },
      inviteCode: { findUnique: jest.fn() },
      project: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    });

    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ username: 'newbie', email: 'newbie@example.com', password: 'Password123', displayName: 'Newbie', userType: 'HUMAN' });
    expect(res.status).toBe(201);
    expect((jwt.verify(res.body.token, SECRET) as { tokenVersion?: number }).tokenVersion).toBe(3);
  });
});
