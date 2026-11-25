/**
 * Real-concurrency check of invite redemption against Postgres. The mocked
 * suite in authInviteRedemption.test.ts serialises whole transactions, so it
 * cannot see a redemption that reads the code and then writes it unguarded;
 * here the requests run on separate pooled connections and really interleave.
 *
 * Skipped unless RUN_DB_TESTS is set (CI runs it against its postgres service).
 */
import express from 'express';
import { PrismaClient } from '@prisma/client';
import request from './helpers/loopbackRequest';

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

const prisma = new PrismaClient();
const OWNER = 'invite_race_owner';
const CODE = 'DBRACE0001';
const CODE_PREFIX = 'DBRACE';

// Test seam for the different-codes race. While `readBarrier` is set, every
// project read waits (after the read itself) until `parties` reads arrived or
// `timeoutMs` passed since the first one. Without a row lock all redemptions
// of one project read the team array before any of them writes, so the
// lost update happens on every run instead of by luck of the scheduler; with
// the lock only one redemption is in the transaction at a time, the barrier
// then times out once and everyone behind it passes straight through.
interface ReadBarrier { parties: number; timeoutMs: number; arrived: number; release: () => void; gate: Promise<void> }
let readBarrier: ReadBarrier | null = null;
function armReadBarrier(parties: number, timeoutMs = 1500): void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const barrier: ReadBarrier = { parties, timeoutMs, arrived: 0, release, gate };
  readBarrier = barrier;
}
const seamClient = prisma.$extends({
  query: {
    project: {
      async findUnique({ args, query }) {
        const result = await query(args);
        const barrier = readBarrier;
        if (barrier) {
          barrier.arrived += 1;
          if (barrier.arrived === 1) setTimeout(barrier.release, barrier.timeoutMs);
          if (barrier.arrived >= barrier.parties) barrier.release();
          await barrier.gate;
        }
        return result;
      },
    },
  },
});

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

const body = (n: number, code: string = CODE) => ({
  username: `invite_racer_${n}`,
  email: `invite_racer_${n}@example.com`,
  password: 'Password123',
  displayName: `Racer ${n}`,
  userType: 'HUMAN',
  inviteCode: code,
});

async function cleanup() {
  const racers = await prisma.user.findMany({
    where: { OR: [{ username: { startsWith: 'invite_racer_' } }, { username: OWNER }] },
    select: { id: true },
  });
  const ids = racers.map((u) => u.id);
  await prisma.roomParticipant.deleteMany({ where: { userId: { in: ids } } });
  await prisma.inviteCode.deleteMany({ where: { code: { startsWith: CODE_PREFIX } } });
  await prisma.project.deleteMany({ where: { name: 'invite race project' } });
  await prisma.room.deleteMany({ where: { name: 'invite race room' } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

describeOrSkip('POST /api/auth/register: invite redemption under real concurrency', () => {
  const original = process.env.REGISTRATION_MODE;
  let ownerId: string;

  beforeEach(async () => {
    await cleanup();
    const owner = await prisma.user.create({
      data: { username: OWNER, email: `${OWNER}@example.com`, displayName: 'Owner', userType: 'HUMAN', isActive: true },
    });
    ownerId = owner.id;
  });

  afterEach(() => {
    readBarrier = null;
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    if (original === undefined) delete process.env.REGISTRATION_MODE;
    else process.env.REGISTRATION_MODE = original;
  });

  const racers = () => prisma.user.count({ where: { username: { startsWith: 'invite_racer_' } } });

  it('8 parallel registrations at a maxUses=1 code create exactly one user', async () => {
    await prisma.inviteCode.create({ data: { code: CODE, maxUses: 1, createdById: ownerId } });
    const app = loadApp();

    const res = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => request(app).post('/api/auth/register').send(body(n))));

    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of res.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(403);
      expect(r.body).toEqual({ error: 'This invite code has already been used.' });
    }
    expect(await racers()).toBe(1);
    const inv = await prisma.inviteCode.findUnique({ where: { code: CODE } });
    expect(inv).toMatchObject({ useCount: 1, isActive: false });
  }, 60_000);

  it('8 parallel registrations at a maxUses=2 project invite give exactly two memberships', async () => {
    const room = await prisma.room.create({ data: { name: 'invite race room', isPrivate: true } });
    const project = await prisma.project.create({
      data: { name: 'invite race project', ownerId, roomId: room.id, teamMemberIds: [ownerId] },
    });
    await prisma.inviteCode.create({
      data: { code: CODE, maxUses: 2, createdById: ownerId, note: `project:${project.id}|email:x@example.com` },
    });
    const app = loadApp();

    const res = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => request(app).post('/api/auth/register').send(body(n))));

    expect(res.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await racers()).toBe(2);
    const inv = await prisma.inviteCode.findUnique({ where: { code: CODE } });
    expect(inv).toMatchObject({ useCount: 2, isActive: false });
    const after = await prisma.project.findUnique({ where: { id: project.id } });
    expect(after!.teamMemberIds).toHaveLength(3);
    expect(await prisma.roomParticipant.count({ where: { roomId: room.id } })).toBe(2);
  }, 60_000);

  // N different single-use codes of ONE project, one registration each, all at
  // once. The codes sit on different rows, so nothing but the project row
  // serialises the team array update.
  describe.each([
    { n: 2, seam: false },
    { n: 5, seam: false },
    { n: 2, seam: true },
    { n: 5, seam: true },
  ])('$n parallel registrations with different codes of one project (read barrier: $seam)', ({ n, seam }) => {
    it('keep every new user in teamMemberIds exactly once, keep the owner and add every room participant', async () => {
      const room = await prisma.room.create({ data: { name: 'invite race room', isPrivate: true } });
      // The owner is deliberately absent from the stored array: the redemption
      // adds the owner itself, so the owner assertion below is not satisfied
      // by the seed row.
      const project = await prisma.project.create({
        data: { name: 'invite race project', ownerId, roomId: room.id, teamMemberIds: [] },
      });
      const nums = Array.from({ length: n }, (_, i) => i + 1);
      for (const k of nums) {
        await prisma.inviteCode.create({
          data: {
            code: `${CODE_PREFIX}${String(k).padStart(4, '0')}`,
            maxUses: 1,
            createdById: ownerId,
            note: `project:${project.id}|email:x${k}@example.com`,
          },
        });
      }
      if (seam) {
        (globalThis as { prisma?: unknown }).prisma = seamClient;
        armReadBarrier(n);
      }
      const app = loadApp();

      const res = await Promise.all(
        nums.map((k) => request(app).post('/api/auth/register').send(body(k, `${CODE_PREFIX}${String(k).padStart(4, '0')}`))),
      );

      expect(res.map((r) => r.status)).toEqual(nums.map(() => 201));
      const users = await prisma.user.findMany({ where: { username: { startsWith: 'invite_racer_' } }, select: { id: true } });
      expect(users).toHaveLength(n);
      const after = await prisma.project.findUnique({ where: { id: project.id } });
      expect(after!.teamMemberIds).toHaveLength(n + 1);
      expect(after!.teamMemberIds).toContain(ownerId);
      expect([...after!.teamMemberIds].sort()).toEqual([ownerId, ...users.map((u) => u.id)].sort());
      expect(new Set(after!.teamMemberIds).size).toBe(n + 1);
      const parts = await prisma.roomParticipant.findMany({ where: { roomId: room.id }, select: { userId: true } });
      expect(parts.map((p) => p.userId).sort()).toEqual(users.map((u) => u.id).sort());
    }, 60_000);
  });
});
