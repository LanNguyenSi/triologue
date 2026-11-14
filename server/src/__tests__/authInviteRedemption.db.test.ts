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

const body = (n: number) => ({
  username: `invite_racer_${n}`,
  email: `invite_racer_${n}@example.com`,
  password: 'Password123',
  displayName: `Racer ${n}`,
  userType: 'HUMAN',
  inviteCode: CODE,
});

async function cleanup() {
  const racers = await prisma.user.findMany({
    where: { OR: [{ username: { startsWith: 'invite_racer_' } }, { username: OWNER }] },
    select: { id: true },
  });
  const ids = racers.map((u) => u.id);
  await prisma.roomParticipant.deleteMany({ where: { userId: { in: ids } } });
  await prisma.inviteCode.deleteMany({ where: { code: CODE } });
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
});
