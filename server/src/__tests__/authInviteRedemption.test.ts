/**
 * POST /api/auth/register invite redemption is atomic, and POST
 * /api/auth/invite-codes mints codes from crypto.
 *
 * No live Postgres is available to the default jest run, so Prisma is replaced
 * by a small in-memory store that models the two properties the fix relies on:
 * `$transaction` serialises writers on the invite row (the row lock Postgres
 * takes on the conditional UPDATE) and rolls every write back when the callback
 * throws, and `updateMany` evaluates its `where` against the committed state.
 * The race itself comes from the real handler: the pre-check reads the code,
 * then the (delayed) password hash yields, so parallel requests all pass the
 * pre-check before any of them writes.
 */
import express from 'express';
import request from './helpers/loopbackRequest';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Store {
  users: Row[];
  invites: Row[];
  projects: Row[];
  participants: Row[];
  failProjectUpdate: boolean;
  failUserCreate: boolean;
}

// The mock factories below re-run for every jest.isolateModules() load, so each
// returns a globalThis-backed singleton: the route and the assertions then see
// the same store and the same jest.fn()s.
const g = globalThis as {
  __inviteRedemptionStore?: Store;
  __inviteRedemptionPrisma?: Row;
  __inviteRedemptionBcrypt?: Row;
};
g.__inviteRedemptionStore ??= {
  users: [], invites: [], projects: [], participants: [],
  failProjectUpdate: false, failUserCreate: false,
};

jest.mock('bcryptjs', () => {
  const gg = globalThis as { __inviteRedemptionBcrypt?: Row };
  // Yield long enough that every parallel request has passed the pre-check.
  gg.__inviteRedemptionBcrypt ??= {
    hash: jest.fn(() => new Promise((resolve) => setTimeout(() => resolve('hashed'), 30))),
    compare: jest.fn(),
  };
  return { __esModule: true, default: gg.__inviteRedemptionBcrypt };
});

jest.mock('../lib/prisma', () => {
  const gg = globalThis as { __inviteRedemptionStore?: Store; __inviteRedemptionPrisma?: Row };
  if (gg.__inviteRedemptionPrisma) return { __esModule: true, default: gg.__inviteRedemptionPrisma };
  const store = gg.__inviteRedemptionStore!;
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v), (_k, val) =>
    typeof val === 'string' && /^\d{4}-\d\d-\d\dT/.test(val) ? new Date(val) : val);

  const matches = (row: Row, where: Row): boolean => Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Row;
      if ('lt' in c && !(row[k] < c.lt)) return false;
      if ('gte' in c && !(row[k] >= c.gte)) return false;
      if ('gt' in c && !(row[k] > c.gt)) return false;
      return true;
    }
    return row[k] === cond;
  });
  const applyData = (row: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && typeof v === 'object' && 'increment' in (v as Row)) row[k] += (v as Row).increment;
      else if (v !== undefined) row[k] = v;
    }
  };

  // A client bound to one state: the root client writes the committed store,
  // a transaction client writes a staged copy that is merged on commit and
  // dropped on rollback, so a write that bypasses the transaction client is
  // not rolled back.
  const makeClient = (store: Store) => ({
    user: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: Row) => {
        if (store.failUserCreate) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row = { id: `user-${store.users.length + 1}`, authToken: null, ...data };
        store.users.push(row);
        return row;
      }),
    },
    inviteCode: {
      findUnique: jest.fn(async ({ where }: Row) => {
        const r = store.invites.find((i) => i.code === where.code);
        return r ? { ...r } : null;
      }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const hit = store.invites.filter((i) => matches(i, where));
        hit.forEach((i) => applyData(i, data));
        return { count: hit.length };
      }),
    },
    project: {
      findUnique: jest.fn(async ({ where }: Row) => store.projects.find((p) => p.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: Row) => {
        if (store.failProjectUpdate) throw new Error('project update failed');
        applyData(store.projects.find((p) => p.id === where.id)!, data);
      }),
    },
    roomParticipant: {
      upsert: jest.fn(async ({ create }: Row) => { store.participants.push({ ...create }); }),
      create: jest.fn(),
    },
    room: { findMany: jest.fn(async () => []) },
  });
  const client = makeClient(store);

  let lock: Promise<unknown> = Promise.resolve();
  const prisma = {
    ...client,
    $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => {
      const run = lock.then(async () => {
        const staged = clone(store) as Store;
        const result = await cb(makeClient(staged));
        Object.assign(store, { users: staged.users, invites: staged.invites, projects: staged.projects, participants: staged.participants });
        return result;
      });
      lock = run.catch(() => undefined);
      return run;
    }),
  };
  gg.__inviteRedemptionPrisma = prisma;
  return { __esModule: true, default: prisma };
});

const store = g.__inviteRedemptionStore!;

const ORIGINAL_MODE = process.env.REGISTRATION_MODE;

function loadApp(): express.Express {
  process.env.REGISTRATION_MODE = 'invite';
  let authRoutes: express.Router | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- REGISTRATION_MODE is read at import time
    authRoutes = require('../routes/auth').authRoutes;
  });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes!);
  return app;
}

const body = (n: number, code: string) => ({
  username: `racer_${n}`,
  email: `racer${n}@example.com`,
  password: 'Password123',
  displayName: `Racer ${n}`,
  userType: 'HUMAN',
  inviteCode: code,
});

const invite = (over: Row = {}): Row => ({
  code: 'RACECODE1', isActive: true, expiresAt: null, useCount: 0, maxUses: 1, note: null, ...over,
});

beforeEach(() => {
  store.users = []; store.invites = []; store.projects = []; store.participants = [];
  store.failProjectUpdate = false; store.failUserCreate = false;
});

afterAll(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.REGISTRATION_MODE;
  else process.env.REGISTRATION_MODE = ORIGINAL_MODE;
});

describe('POST /api/auth/register: atomic invite redemption', () => {
  it('creates exactly one user when 6 parallel requests redeem a maxUses=1 code', async () => {
    store.invites = [invite()];
    const app = loadApp();

    const responses = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) => request(app).post('/api/auth/register').send(body(n, 'RACECODE1'))),
    );

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 403, 403, 403, 403, 403]);
    expect(store.users).toHaveLength(1);
    expect(store.invites[0].useCount).toBe(1);
    expect(store.invites[0].isActive).toBe(false);
    for (const r of responses.filter((x) => x.status === 403)) {
      expect(r.body).toEqual({ error: 'This invite code has already been used.' });
    }
  });

  it('lets exactly maxUses=3 of 6 parallel requests through and deactivates the code', async () => {
    store.invites = [invite({ maxUses: 3 })];
    const app = loadApp();

    const responses = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) => request(app).post('/api/auth/register').send(body(n, 'RACECODE1'))),
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(3);
    expect(store.users).toHaveLength(3);
    expect(store.invites[0].useCount).toBe(3);
    expect(store.invites[0].isActive).toBe(false);
  });

  it('keeps a multi-use code active until its last use', async () => {
    store.invites = [invite({ maxUses: 2 })];
    const app = loadApp();

    const first = await request(app).post('/api/auth/register').send(body(1, 'RACECODE1'));

    expect(first.status).toBe(201);
    expect(store.invites[0]).toMatchObject({ useCount: 1, isActive: true, usedById: 'user-1' });
  });

  it('refuses an exhausted code at the pre-check with the original message and creates nothing', async () => {
    store.invites = [invite({ useCount: 1 })];
    const app = loadApp();

    const res = await request(app).post('/api/auth/register').send(body(1, 'RACECODE1'));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'This invite code has already been used.' });
    expect(store.users).toHaveLength(0);
  });

  it('answers a code that expires between pre-check and write like an exhausted code and rolls back', async () => {
    store.invites = [invite({ expiresAt: new Date(Date.now() + 3_600_000) })];
    // The code is valid at the pre-check and expires while the password is hashed.
    g.__inviteRedemptionBcrypt!.hash.mockImplementationOnce(async () => {
      store.invites[0].expiresAt = new Date(Date.now() - 1);
      return 'hashed';
    });
    const app = loadApp();

    const res = await request(app).post('/api/auth/register').send(body(1, 'RACECODE1'));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'This invite code has already been used.' });
    expect(store.users).toHaveLength(0);
    expect(store.invites[0].useCount).toBe(0);
  });

  it('refuses on useCount alone when a still-active code is used up between pre-check and write', async () => {
    store.invites = [invite({ maxUses: 2, useCount: 1 })];
    // A use lands while the password is hashed and the row is still isActive
    // (as rows deactivated by the old read-then-write path can be).
    g.__inviteRedemptionBcrypt!.hash.mockImplementationOnce(async () => {
      store.invites[0].useCount = 2;
      return 'hashed';
    });
    const app = loadApp();

    const res = await request(app).post('/api/auth/register').send(body(1, 'RACECODE1'));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'This invite code has already been used.' });
    expect(store.users).toHaveLength(0);
    expect(store.invites[0].useCount).toBe(2);
  });

  it('refuses a code deactivated between pre-check and write (account deletion deactivates used multi-use codes)', async () => {
    store.invites = [invite({ maxUses: 3, useCount: 1 })];
    g.__inviteRedemptionBcrypt!.hash.mockImplementationOnce(async () => {
      store.invites[0].isActive = false;
      return 'hashed';
    });
    const app = loadApp();

    const res = await request(app).post('/api/auth/register').send(body(1, 'RACECODE1'));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'This invite code has already been used.' });
    expect(store.users).toHaveLength(0);
    expect(store.invites[0].useCount).toBe(1);
  });

  it('project invite race adds membership for the winner only', async () => {
    store.invites = [invite({ note: 'project:proj-1|email:x@example.com' })];
    store.projects = [{ id: 'proj-1', ownerId: 'owner-1', teamMemberIds: ['owner-1'], roomId: 'room-1' }];
    const app = loadApp();

    const responses = await Promise.all(
      [1, 2, 3, 4].map((n) => request(app).post('/api/auth/register').send(body(n, 'RACECODE1'))),
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(store.users).toHaveLength(1);
    expect(store.projects[0].teamMemberIds).toEqual(['owner-1', store.users[0].id]);
    expect(store.participants).toEqual([{ userId: store.users[0].id, roomId: 'room-1', role: 'MEMBER' }]);
  });

  it('rolls the invite use back when the user insert fails (increment shares the user transaction)', async () => {
    store.invites = [invite()];
    store.failUserCreate = true;
    const app = loadApp();

    const res = await request(app).post('/api/auth/register').send(body(1, 'RACECODE1'));

    expect(res.status).toBe(500);
    expect(store.users).toHaveLength(0);
    expect(store.invites[0]).toMatchObject({ useCount: 0, isActive: true });
  });

  it('rolls the user and the invite use back when the project membership write fails', async () => {
    store.invites = [invite({ note: 'project:proj-1|email:x@example.com' })];
    store.projects = [{ id: 'proj-1', ownerId: 'owner-1', teamMemberIds: ['owner-1'], roomId: 'room-1' }];
    store.failProjectUpdate = true;
    const app = loadApp();

    const res = await request(app).post('/api/auth/register').send(body(1, 'RACECODE1'));

    expect(res.status).toBe(500);
    expect(store.users).toHaveLength(0);
    expect(store.invites[0]).toMatchObject({ useCount: 0, isActive: true });
  });

  it('hashes the password before opening the transaction', async () => {
    store.invites = [invite()];
    const order: string[] = [];
    const bcrypt = g.__inviteRedemptionBcrypt!;
    const prisma = g.__inviteRedemptionPrisma!;
    bcrypt.hash.mockImplementationOnce(async () => { order.push('hash'); return 'hashed'; });
    prisma.$transaction.mockImplementationOnce((cb: (tx: unknown) => Promise<unknown>) => {
      order.push('tx');
      return cb(prisma);
    });
    const app = loadApp();

    const res = await request(app).post('/api/auth/register').send(body(1, 'RACECODE1'));

    expect(res.status).toBe(201);
    expect(order).toEqual(['hash', 'tx']);
  });
});

describe('POST /api/auth/invite-codes: code generation', () => {
  it('draws codes from crypto.randomBytes, not Math.random', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const crypto = require('crypto');
    const prisma = g.__inviteRedemptionPrisma!;
    prisma.user.findUnique = jest.fn(async () => ({ id: 'admin-1', isAdmin: true }));
    prisma.inviteCode.create = jest.fn(async ({ data }: Row) => ({ ...data }));
    jest.doMock('../middleware/auth', () => ({
      authenticate: (req: Row, _res: unknown, next: () => void) => { req.user = { id: 'admin-1' }; next(); },
      requireHuman: (_req: unknown, _res: unknown, next: () => void) => next(),
    }));
    const randomBytes = jest.spyOn(crypto, 'randomBytes');
    const mathRandom = jest.spyOn(Math, 'random');
    let authRoutes: express.Router | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      authRoutes = require('../routes/auth').authRoutes;
    });
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes!);

    const codes = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const res = await request(app).post('/api/auth/invite-codes').send({});
      expect(res.status).toBe(201);
      // Accepted by the register schema: alphanumeric, at most 20 characters;
      // 10 hex characters carry 40 bits against the 36 bits of the old 7-char base36 code.
      expect(res.body.code).toMatch(/^[0-9A-F]{10}$/);
      codes.add(res.body.code);
    }

    expect(codes.size).toBe(20);
    expect(randomBytes).toHaveBeenCalled();
    expect(mathRandom).not.toHaveBeenCalled();
    randomBytes.mockRestore();
    mathRandom.mockRestore();
    jest.dontMock('../middleware/auth');
  });
});
