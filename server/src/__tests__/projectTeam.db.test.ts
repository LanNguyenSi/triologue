/**
 * Real-concurrency checks of the writers of `projects.teamMemberIds` against
 * Postgres. The mocked suites serialise whole transactions, so they cannot see
 * a writer that reads the team array and writes the whole array back; here the
 * requests run on separate pooled connections and really interleave.
 *
 * Each race test pairs two writers of different kinds that add DIFFERENT users
 * at the same time. A read barrier forces the interleaving that loses an update
 * in a read-then-write writer: every project read waits (after the read itself)
 * until both parties have read, so both see the old array before either writes.
 * With the atomic helper the barrier is harmless: the second writer's UPDATE
 * waits on the row lock and appends to what the first one committed.
 *
 * The room delete test holds a registration between its project lock and its
 * room participant insert while a delete of the same room runs, 20 times, and
 * expects no deadlock.
 *
 * Skipped unless RUN_DB_TESTS is set (CI runs it against its postgres service).
 */
import crypto from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import request from './helpers/loopbackRequest';
import { addProjectTeamMembers } from '../lib/projectTeam';

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

const prisma = new PrismaClient();
const suffix = crypto.randomBytes(3).toString('hex');
const P = `ptm${suffix}`; // prefix of every row this file creates
const CODE_PREFIX = `PTM${suffix.toUpperCase()}`;

// ---- test seams on project reads -------------------------------------------

interface ReadBarrier { parties: number; timeoutMs: number; arrived: number; release: () => void; gate: Promise<void> }
let readBarrier: ReadBarrier | null = null;
function armReadBarrier(parties: number, timeoutMs = 3000): void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  readBarrier = { parties, timeoutMs, arrived: 0, release, gate };
}

// Holds the first project read (the registration's read under its row lock)
// until `release()` is called or `timeoutMs` passed.
interface Hold { arrived: Promise<void>; release: () => void }
let hold: { markArrived: () => void; gate: Promise<void>; used: boolean; timeoutMs: number } | null = null;
function armHold(timeoutMs = 15000): Hold {
  let markArrived!: () => void;
  const arrived = new Promise<void>((resolve) => { markArrived = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  hold = { markArrived, gate, used: false, timeoutMs };
  return { arrived, release };
}

// One-shot hooks run (and awaited) right after the next read of that kind, to
// let a test do something between a writer's read and its write.
let afterNextProjectRead: (() => Promise<void>) | null = null;
let afterNextParticipantsRead: (() => Promise<void>) | null = null;
async function runOnce(slot: 'project' | 'participants'): Promise<void> {
  const fn = slot === 'project' ? afterNextProjectRead : afterNextParticipantsRead;
  if (slot === 'project') afterNextProjectRead = null; else afterNextParticipantsRead = null;
  if (fn) await fn();
}

async function afterProjectRead(): Promise<void> {
  const barrier = readBarrier;
  if (barrier) {
    barrier.arrived += 1;
    if (barrier.arrived === 1) setTimeout(barrier.release, barrier.timeoutMs).unref();
    if (barrier.arrived >= barrier.parties) barrier.release();
    await barrier.gate;
  }
  const h = hold;
  if (h && !h.used) {
    h.used = true;
    h.markArrived();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([h.gate, new Promise<void>((resolve) => { timer = setTimeout(resolve, h.timeoutMs); })]);
    clearTimeout(timer);
  }
  await runOnce('project');
}

const seamClient = prisma.$extends({
  query: {
    project: {
      async findUnique({ args, query }) {
        const result = await query(args);
        await afterProjectRead();
        return result;
      },
      async findFirst({ args, query }) {
        const result = await query(args);
        await afterProjectRead();
        return result;
      },
    },
    roomParticipant: {
      async findMany({ args, query }) {
        const result = await query(args);
        await runOnce('participants');
        return result;
      },
    },
  },
});

function resetSeams(): void {
  readBarrier = null;
  hold = null;
  afterNextProjectRead = null;
  afterNextParticipantsRead = null;
}

// ---- app and fixtures ------------------------------------------------------

function loadApp(): express.Express {
  process.env.REGISTRATION_MODE = 'invite';
  (globalThis as { prisma?: unknown }).prisma = seamClient;
  let routes!: {
    auth: express.Router; rooms: express.Router; agents: express.Router; projects: express.Router;
  };
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- REGISTRATION_MODE is read at import time */
    routes = {
      auth: require('../routes/auth').authRoutes,
      rooms: require('../routes/rooms').roomRoutes,
      agents: require('../routes/agents').agentRoutes,
      projects: require('../routes/projects').projectRoutes,
    };
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', routes.auth);
  app.use('/api/rooms', routes.rooms);
  app.use('/api/agents', routes.agents);
  app.use('/api/projects', routes.projects);
  return app;
}

const signJwt = (userId: string) => jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: '1h' });
const bearer = (userId: string) => `Bearer ${signJwt(userId)}`;

let counter = 0;
const next = () => { counter += 1; return counter; };

async function makeUser(label: string, extra: { isAdmin?: boolean } = {}) {
  const n = next();
  return prisma.user.create({
    data: {
      username: `${P}_${label}_${n}`,
      email: `${P}_${label}_${n}@example.com`,
      displayName: label,
      userType: 'HUMAN',
      isActive: true,
      ...extra,
    },
  });
}

// A project with its private room; the owner is the room OWNER and the only
// team member stored (the owner is deliberately absent from the stored array
// in some tests, see below).
async function makeProject(ownerId: string, teamMemberIds: string[]) {
  const n = next();
  const room = await prisma.room.create({ data: { name: `${P} room ${n}`, isPrivate: true } });
  const project = await prisma.project.create({
    data: { name: `${P} project ${n}`, ownerId, roomId: room.id, teamMemberIds },
  });
  await prisma.roomParticipant.create({ data: { userId: ownerId, roomId: room.id, role: 'OWNER' } });
  return { room, project };
}

async function makeInvite(projectId: string, ownerId: string) {
  const code = `${CODE_PREFIX}${String(next()).padStart(4, '0')}`;
  await prisma.inviteCode.create({
    data: { code, maxUses: 1, createdById: ownerId, note: `project:${projectId}|email:x@example.com` },
  });
  return code;
}

const registrationBody = (code: string) => {
  const n = next();
  return {
    username: `${P}_reg_${n}`,
    email: `${P}_reg_${n}@example.com`,
    password: 'Password123',
    displayName: `Registrant ${n}`,
    userType: 'HUMAN',
    inviteCode: code,
  };
};

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: `${P}_` } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.agentToken.deleteMany({ where: { createdById: { in: ids } } });
  await prisma.roomParticipant.deleteMany({ where: { userId: { in: ids } } });
  await prisma.inviteCode.deleteMany({ where: { code: { startsWith: CODE_PREFIX } } });
  await prisma.project.deleteMany({ where: { name: { startsWith: `${P} ` } } });
  await prisma.room.deleteMany({ where: { name: { startsWith: `${P} ` } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

const teamOf = async (projectId: string) =>
  (await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).teamMemberIds;

describeOrSkip('projects.teamMemberIds writers under real concurrency', () => {
  const originalMode = process.env.REGISTRATION_MODE;
  let app: express.Express;

  beforeAll(() => {
    app = loadApp();
  });

  beforeEach(async () => {
    await cleanup();
    resetSeams();
  });

  afterEach(() => {
    resetSeams();
  });

  afterAll(async () => {
    await cleanup();
    delete (globalThis as { prisma?: unknown }).prisma;
    await prisma.$disconnect();
    if (originalMode === undefined) delete process.env.REGISTRATION_MODE;
    else process.env.REGISTRATION_MODE = originalMode;
  });

  // ---- the helper itself ---------------------------------------------------

  describe('addProjectTeamMembers', () => {
    it('puts the owner first, keeps stored members in order and appends new ids in input order without duplicates', async () => {
      const owner = await makeUser('owner');
      const { project } = await makeProject(owner.id, ['m1', 'm2']);

      const changed = await addProjectTeamMembers(prisma, project.id, ['n2', 'm1', 'n1', 'n2', '']);

      expect(changed).toBe(true);
      expect(await teamOf(project.id)).toEqual([owner.id, 'm1', 'm2', 'n2', 'n1']);
    });

    it('moves a stored owner to the front and drops stored duplicates when it writes', async () => {
      const owner = await makeUser('owner');
      const { project } = await makeProject(owner.id, ['m1', owner.id, 'm1']);

      await addProjectTeamMembers(prisma, project.id, ['n1']);

      expect(await teamOf(project.id)).toEqual([owner.id, 'm1', 'n1']);
    });

    it('writes nothing and reports false when every id is present and the owner is stored', async () => {
      const owner = await makeUser('owner');
      const { project } = await makeProject(owner.id, ['m1', owner.id]);
      const before = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });

      expect(await addProjectTeamMembers(prisma, project.id, ['m1', owner.id])).toBe(false);
      expect(await addProjectTeamMembers(prisma, project.id, [])).toBe(false);

      const after = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(after.teamMemberIds).toEqual(['m1', owner.id]);
      expect(after.updatedAt).toEqual(before.updatedAt);
    });

    it('adds the owner alone when only the owner is missing', async () => {
      const owner = await makeUser('owner');
      const { project } = await makeProject(owner.id, ['m1']);

      expect(await addProjectTeamMembers(prisma, project.id, [])).toBe(true);

      expect(await teamOf(project.id)).toEqual([owner.id, 'm1']);
    });

    it('bumps updatedAt when it writes and reports false for a project that does not exist', async () => {
      const owner = await makeUser('owner');
      const { project } = await makeProject(owner.id, [owner.id]);
      const before = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(await addProjectTeamMembers(prisma, project.id, ['n1'])).toBe(true);
      expect(await addProjectTeamMembers(prisma, `${P}-missing`, ['n1'])).toBe(false);

      const after = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    });

    it('works on a transaction client and rolls back with it', async () => {
      const owner = await makeUser('owner');
      const { project } = await makeProject(owner.id, [owner.id]);

      await expect(
        prisma.$transaction(async (tx) => {
          await addProjectTeamMembers(tx, project.id, ['n1']);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await teamOf(project.id)).toEqual([owner.id]);

      await prisma.$transaction((tx) => addProjectTeamMembers(tx, project.id, ['n1']));
      expect(await teamOf(project.id)).toEqual([owner.id, 'n1']);
    });

    it('writes updatedAt in UTC whatever the session time zone is', async () => {
      const owner = await makeUser('owner');
      const { project } = await makeProject(owner.id, [owner.id]);

      // The column is `timestamp without time zone` and Prisma stores UTC in it;
      // a session 14 hours ahead of UTC shows a `now()` written as it is.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`);
        expect(await addProjectTeamMembers(tx, project.id, ['n1'])).toBe(true);
      });

      const after = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(Math.abs(after.updatedAt.getTime() - Date.now())).toBeLessThan(10_000);
    });

    describe('a stored NULL team array', () => {
      const setNull = (projectId: string) =>
        prisma.$executeRaw`UPDATE "projects" SET "teamMemberIds" = NULL WHERE "id" = ${projectId}`;

      it('is treated as empty: the owner and the new id are written', async () => {
        const owner = await makeUser('owner');
        const { project } = await makeProject(owner.id, [owner.id]);
        await setNull(project.id);

        expect(await addProjectTeamMembers(prisma, project.id, ['n1'])).toBe(true);

        expect(await teamOf(project.id)).toEqual([owner.id, 'n1']);
      });

      it('gets the owner even when no id is added', async () => {
        const owner = await makeUser('owner');
        const { project } = await makeProject(owner.id, [owner.id]);
        await setNull(project.id);

        expect(await addProjectTeamMembers(prisma, project.id, [])).toBe(true);

        expect(await teamOf(project.id)).toEqual([owner.id]);
      });
    });

    it('keeps every id of 12 parallel calls with different ids', async () => {
      const owner = await makeUser('owner');
      const { project } = await makeProject(owner.id, [owner.id]);
      const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);

      await Promise.all(ids.map((id) => addProjectTeamMembers(prisma, project.id, [id])));

      const team = await teamOf(project.id);
      expect(team[0]).toBe(owner.id);
      expect([...team].sort()).toEqual([owner.id, ...ids].sort());
    });
  });

  // ---- writer pairs --------------------------------------------------------

  /**
   * A registration through a project invite (lock, read, atomic append) at the
   * same time as `other`, with the read barrier armed for both reads.
   */
  async function raceWithRegistration(
    ownerId: string,
    projectId: string,
    other: () => PromiseLike<{ status: number }>,
  ) {
    const code = await makeInvite(projectId, ownerId);
    armReadBarrier(2);
    const [reg, second] = await Promise.all([
      request(app).post('/api/auth/register').send(registrationBody(code)),
      other(),
    ]);
    const registered = await prisma.user.findFirstOrThrow({
      where: { usedInviteCode: code },
      select: { id: true },
    });
    return { reg, second, registeredId: registered.id };
  }

  const expectTeam = (team: string[], ownerId: string, ...members: string[]) => {
    expect(team[0]).toBe(ownerId);
    expect(new Set(team).size).toBe(team.length);
    expect([...team].sort()).toEqual([ownerId, ...members].sort());
  };

  it('room invite (room sync) and a project-invite registration both stay members', async () => {
    const owner = await makeUser('owner');
    const invitee = await makeUser('invitee');
    const { room, project } = await makeProject(owner.id, [owner.id]);

    const { reg, second, registeredId } = await raceWithRegistration(owner.id, project.id, () =>
      request(app)
        .post(`/api/rooms/${room.id}/invite`)
        .set('Authorization', bearer(owner.id))
        .send({ username: invitee.username }),
    );

    expect(reg.status).toBe(201);
    expect(second.status).toBe(200);
    expectTeam(await teamOf(project.id), owner.id, invitee.id, registeredId);
  }, 60_000);

  it('project auto-sync from room membership and a project-invite registration both stay members', async () => {
    const owner = await makeUser('owner');
    const roomMember = await makeUser('roommember');
    const { room, project } = await makeProject(owner.id, [owner.id]);
    await prisma.roomParticipant.create({ data: { userId: roomMember.id, roomId: room.id, role: 'MEMBER' } });

    const { reg, second, registeredId } = await raceWithRegistration(owner.id, project.id, () =>
      request(app)
        .get(`/api/projects/${project.id}/export`)
        .set('Authorization', bearer(roomMember.id)),
    );

    expect(reg.status).toBe(201);
    expect(second.status).toBe(200);
    expectTeam(await teamOf(project.id), owner.id, roomMember.id, registeredId);
  }, 60_000);

  it('project team add by the owner and a project-invite registration both stay members', async () => {
    const owner = await makeUser('owner');
    const added = await makeUser('added');
    const { project } = await makeProject(owner.id, [owner.id]);

    const { reg, second, registeredId } = await raceWithRegistration(owner.id, project.id, () =>
      request(app)
        .post(`/api/projects/${project.id}/team`)
        .set('Authorization', bearer(owner.id))
        .send({ userId: added.id }),
    );

    expect(reg.status).toBe(201);
    expect(second.status).toBe(200);
    expectTeam(await teamOf(project.id), owner.id, added.id, registeredId);
  }, 60_000);

  it('agent room add (agents sync) and a room invite (room sync) both stay members', async () => {
    const owner = await makeUser('owner');
    const admin = await makeUser('admin', { isAdmin: true });
    const invitee = await makeUser('invitee');
    const agentUser = await prisma.user.create({
      data: { username: `${P}_agent_${next()}`, displayName: 'agent', userType: 'AI_AGENT', isActive: true },
    });
    const agentToken = await prisma.agentToken.create({
      data: {
        token: `byoa_${crypto.randomBytes(8).toString('hex')}`,
        name: `${P} agent`,
        mentionKey: `${P}agent${next()}`,
        userId: agentUser.id,
        createdById: admin.id,
        status: 'active',
        isActive: true,
      },
    });
    const { room, project } = await makeProject(owner.id, [owner.id]);

    armReadBarrier(2);
    const [agentRes, inviteRes] = await Promise.all([
      request(app)
        .put(`/api/agents/${agentToken.id}/rooms`)
        .set('Authorization', bearer(admin.id))
        .send({ roomId: room.id, action: 'add' }),
      request(app)
        .post(`/api/rooms/${room.id}/invite`)
        .set('Authorization', bearer(owner.id))
        .send({ username: invitee.username }),
    ]);

    expect(agentRes.status).toBe(200);
    expect(inviteRes.status).toBe(200);
    expectTeam(await teamOf(project.id), owner.id, agentUser.id, invitee.id);
  }, 60_000);

  it('room invite reports teamSynced true for a new member and false when the member is already on the team', async () => {
    const owner = await makeUser('owner');
    const invitee = await makeUser('invitee');
    const { room, project } = await makeProject(owner.id, [owner.id]);

    const first = await request(app)
      .post(`/api/rooms/${room.id}/invite`)
      .set('Authorization', bearer(owner.id))
      .send({ username: invitee.username });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ syncedProjectId: project.id, teamSynced: true });
    expect(await teamOf(project.id)).toEqual([owner.id, invitee.id]);

    await prisma.roomParticipant.delete({ where: { userId_roomId: { userId: invitee.id, roomId: room.id } } });
    const second = await request(app)
      .post(`/api/rooms/${room.id}/invite`)
      .set('Authorization', bearer(owner.id))
      .send({ username: invitee.username });
    expect(second.body).toMatchObject({ syncedProjectId: project.id, teamSynced: false });
    expect(await teamOf(project.id)).toEqual([owner.id, invitee.id]);
  }, 60_000);

  it('project GET merges the room participants and keeps a member another writer added after its room read', async () => {
    const owner = await makeUser('owner');
    const roomMember = await makeUser('roommember');
    const invitee = await makeUser('invitee');
    const { room, project } = await makeProject(owner.id, [owner.id]);
    await prisma.roomParticipant.create({ data: { userId: roomMember.id, roomId: room.id, role: 'MEMBER' } });
    // After the GET read the room participants (and the team it holds), a room
    // invite adds another user to the team; the GET then writes its merge.
    afterNextParticipantsRead = async () => {
      const invite = await request(app)
        .post(`/api/rooms/${room.id}/invite`)
        .set('Authorization', bearer(owner.id))
        .send({ username: invitee.username });
      expect(invite.status).toBe(200);
    };

    const res = await request(app).get(`/api/projects/${project.id}`).set('Authorization', bearer(owner.id));

    expect(res.status).toBe(200);
    expect(await teamOf(project.id)).toEqual([owner.id, invitee.id, roomMember.id]);
    // The response carries the team as stored after the write.
    expect(res.body.teamMemberIds).toEqual([owner.id, invitee.id, roomMember.id]);
  }, 60_000);

  it('project GET auto-sync keeps a team-only member another writer added after its project read', async () => {
    const owner = await makeUser('owner');
    const roomMember = await makeUser('roommember');
    const { room, project } = await makeProject(owner.id, [owner.id]);
    await prisma.roomParticipant.create({ data: { userId: roomMember.id, roomId: room.id, role: 'MEMBER' } });
    // A member that is on the team but not in the room, so the GET's later room
    // merge cannot repair a lost write.
    afterNextProjectRead = async () => {
      await addProjectTeamMembers(prisma, project.id, ['team-only']);
    };

    const res = await request(app).get(`/api/projects/${project.id}`).set('Authorization', bearer(roomMember.id));

    expect(res.status).toBe(200);
    expect(await teamOf(project.id)).toEqual([owner.id, 'team-only', roomMember.id]);
  }, 60_000);

  // A project deleted between a writer's read and its write: the atomic update
  // matches no row and the writer answers like a project that is not there.
  describe('a project deleted between the read and the team write', () => {
    const deleteProject = (projectId: string) => async () => {
      await prisma.project.delete({ where: { id: projectId } });
    };

    it('answers 404 on a route that auto-syncs through the access check', async () => {
      const owner = await makeUser('owner');
      const roomMember = await makeUser('roommember');
      const { room, project } = await makeProject(owner.id, [owner.id]);
      await prisma.roomParticipant.create({ data: { userId: roomMember.id, roomId: room.id, role: 'MEMBER' } });
      afterNextProjectRead = deleteProject(project.id);

      const res = await request(app).get(`/api/projects/${project.id}/export`).set('Authorization', bearer(roomMember.id));

      expect(res.status).toBe(404);
    }, 60_000);

    it('answers 404 on the project GET auto-sync', async () => {
      const owner = await makeUser('owner');
      const roomMember = await makeUser('roommember');
      const { room, project } = await makeProject(owner.id, [owner.id]);
      await prisma.roomParticipant.create({ data: { userId: roomMember.id, roomId: room.id, role: 'MEMBER' } });
      afterNextProjectRead = deleteProject(project.id);

      const res = await request(app).get(`/api/projects/${project.id}`).set('Authorization', bearer(roomMember.id));

      expect(res.status).toBe(404);
    }, 60_000);

    it('answers 404 on the project GET room merge', async () => {
      const owner = await makeUser('owner');
      const roomMember = await makeUser('roommember');
      const { room, project } = await makeProject(owner.id, [owner.id]);
      await prisma.roomParticipant.create({ data: { userId: roomMember.id, roomId: room.id, role: 'MEMBER' } });
      afterNextParticipantsRead = deleteProject(project.id);

      const res = await request(app).get(`/api/projects/${project.id}`).set('Authorization', bearer(owner.id));

      expect(res.status).toBe(404);
    }, 60_000);

    it('fails the team add with 500 and no membership', async () => {
      const owner = await makeUser('owner');
      const added = await makeUser('added');
      const { project } = await makeProject(owner.id, [owner.id]);
      afterNextProjectRead = deleteProject(project.id);

      const res = await request(app)
        .post(`/api/projects/${project.id}/team`)
        .set('Authorization', bearer(owner.id))
        .send({ userId: added.id });

      expect(res.status).toBe(500);
      expect(await prisma.project.count({ where: { id: project.id } })).toBe(0);
    }, 60_000);
  });

  // ---- room delete vs registration -----------------------------------------

  it('deleting a project room while a registration holds the project row ends without a deadlock, 20 times', async () => {
    for (let i = 0; i < 20; i += 1) {
      const owner = await makeUser(`downer${i}`);
      const { room, project } = await makeProject(owner.id, [owner.id]);
      const code = await makeInvite(project.id, owner.id);
      const body = registrationBody(code);

      // The registration locks the project row, reads it and stops there.
      const held = armHold();
      const registration = Promise.resolve(request(app).post('/api/auth/register').send(body));
      await held.arrived;
      // The delete starts while the registration still holds the row. With the
      // room taken before the project the two wait on each other once the
      // registration goes on to insert its room participant.
      const deletion = Promise.resolve(
        request(app).delete(`/api/rooms/${room.id}`).set('Authorization', bearer(owner.id)),
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      held.release();
      const [regRes, delRes] = await Promise.all([registration, deletion]);

      // Defined outcome: the registration holds the row first, so it succeeds
      // with its membership, and the delete then removes room and project.
      expect({ iteration: i, reg: regRes.status, del: delRes.status }).toEqual({ iteration: i, reg: 201, del: 200 });
      expect(delRes.body).toMatchObject({ ok: true, deletedRoomId: room.id, deletedProjectId: project.id });
      expect(await prisma.room.count({ where: { id: room.id } })).toBe(0);
      expect(await prisma.project.count({ where: { id: project.id } })).toBe(0);
      expect(await prisma.user.count({ where: { username: body.username } })).toBe(1);
      hold = null;
    }
  }, 180_000);

  it('a registration that waits on a room delete holding the project row registers without a membership, 10 times', async () => {
    for (let i = 0; i < 10; i += 1) {
      const owner = await makeUser(`dfirst${i}`);
      const { room, project } = await makeProject(owner.id, [owner.id]);
      const code = await makeInvite(project.id, owner.id);
      const body = registrationBody(code);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let locked!: () => void;
      const lockedP = new Promise<void>((resolve) => { locked = resolve; });

      // The delete's transaction takes the project row first, as the route does,
      // deletes room and project and stays open until the registration is waiting.
      const deletion = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "projects" WHERE "roomId" = ${room.id} FOR UPDATE`;
        await tx.room.delete({ where: { id: room.id } });
        await tx.project.delete({ where: { id: project.id } });
        locked();
        await gate;
      }, { timeout: 20_000 });
      await lockedP;
      const registration = Promise.resolve(request(app).post('/api/auth/register').send(body));
      await new Promise((resolve) => setTimeout(resolve, 300));
      release();
      await deletion;
      const regRes = await registration;

      expect({ iteration: i, status: regRes.status }).toEqual({ iteration: i, status: 201 });
      const registered = await prisma.user.findFirstOrThrow({ where: { username: body.username } });
      expect(await prisma.roomParticipant.count({ where: { userId: registered.id, roomId: room.id } })).toBe(0);
      expect(await prisma.project.count({ where: { id: project.id } })).toBe(0);
    }
  }, 120_000);

  it('a registration that starts after the room delete finished registers without a membership', async () => {
    const owner = await makeUser('owner');
    const { room, project } = await makeProject(owner.id, [owner.id]);
    const code = await makeInvite(project.id, owner.id);

    const del = await request(app).delete(`/api/rooms/${room.id}`).set('Authorization', bearer(owner.id));
    const reg = await request(app).post('/api/auth/register').send(registrationBody(code));

    expect(del.status).toBe(200);
    expect(reg.status).toBe(201);
    expect(await prisma.project.count({ where: { id: project.id } })).toBe(0);
  }, 60_000);

  it('deleting a room without a linked project still deletes the room only', async () => {
    const owner = await makeUser('owner');
    const room = await prisma.room.create({ data: { name: `${P} plain room`, isPrivate: true } });
    await prisma.roomParticipant.create({ data: { userId: owner.id, roomId: room.id, role: 'OWNER' } });

    const res = await request(app).delete(`/api/rooms/${room.id}`).set('Authorization', bearer(owner.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, deletedRoomId: room.id });
    expect(await prisma.room.count({ where: { id: room.id } })).toBe(0);
  }, 60_000);
});
