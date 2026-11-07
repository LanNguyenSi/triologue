/**
 * DB-backed tests (RUN_DB_TESTS=1) for the thread routes against a real
 * Postgres: the unique index on rootMessageId (sequential and concurrent), the
 * ON DELETE SET NULL of rootMessageId, the lastActivity order and `before`
 * cursor as Postgres evaluates them, the isDeleted filter of the filtered
 * message list, the transactional counter on POST /api/agents/message, a byoa
 * agent creating a thread, and a NUL character being refused with 400 before
 * Postgres would reject it. Self-delete of a thread creator is covered in
 * auth-self-delete-other-owners.test.ts.
 *
 * Mutation guards (each is killed by a named test below):
 *   - dropping `@unique` on Thread.rootMessageId: the sequential and the
 *     concurrent duplicate-root tests
 *   - `onDelete: SetNull` replaced by Restrict on the root relation: the
 *     hard-deleted root test
 *   - dropping the `isDeleted: false` filter: the deleted-reply test
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from './helpers/loopbackRequest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

const PREFIX = 'thdb';
let seq = 0;
function uniq(label: string) {
  seq += 1;
  return `${PREFIX}-${label}-${Date.now().toString(36)}-${seq}-${crypto.randomBytes(3).toString('hex')}`;
}

const userIds: string[] = [];
const roomIds: string[] = [];

function bearer(userId: string) {
  return `Bearer ${jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`;
}

async function makeUser(label: string, userType: 'HUMAN' | 'AI_AGENT' = 'HUMAN') {
  const user = await prisma.user.create({
    data: { username: uniq(label), displayName: `TH ${label}`, userType },
  });
  userIds.push(user.id);
  return user;
}

async function makeRoom(members: Array<[string, 'OWNER' | 'ADMIN' | 'MEMBER']>) {
  const room = await prisma.room.create({ data: { name: uniq('room') } });
  roomIds.push(room.id);
  for (const [userId, role] of members) {
    await prisma.roomParticipant.create({ data: { userId, roomId: room.id, role } });
  }
  return room;
}

function msg(roomId: string, senderId: string, over: Record<string, unknown> = {}) {
  return prisma.message.create({
    data: { content: 'hello', roomId, senderId, ...over },
  });
}

afterAll(async () => {
  await prisma.room.deleteMany({ where: { id: { in: roomIds } } });
  await prisma.agentAuditLog.deleteMany({ where: { agentId: { in: userIds } } });
  await prisma.agentToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describeOrSkip('thread routes on a real database', () => {
  let alice: { id: string };
  let bob: { id: string };
  let room: { id: string };

  beforeEach(async () => {
    alice = await makeUser('alice');
    bob = await makeUser('bob');
    room = await makeRoom([
      [alice.id, 'MEMBER'],
      [bob.id, 'MEMBER'],
    ]);
  });

  const create = (userId: string, body: object, roomId = room.id) =>
    request(app)
      .post(`/api/rooms/${roomId}/threads`)
      .set('Authorization', bearer(userId))
      .send(body);

  it('stores rootMessageId, leaves the root message a top-level message and starts the counters at zero', async () => {
    const root = await msg(room.id, bob.id);

    const res = await create(alice.id, { title: 'About it', rootMessageId: root.id });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      rootMessageId: root.id,
      createdBy: alice.id,
      messageCount: 0,
      isResolved: false,
    });
    const after = await prisma.message.findUniqueOrThrow({ where: { id: root.id } });
    expect(after.threadId).toBeNull();
    expect(after.updatedAt.getTime()).toBe(root.updatedAt.getTime());
  });

  it('refuses a second thread on the same root (unique index) and keeps exactly one row', async () => {
    const root = await msg(room.id, bob.id);
    expect((await create(alice.id, { title: 'First', rootMessageId: root.id })).status).toBe(201);

    const second = await create(bob.id, { title: 'Second', rootMessageId: root.id });

    expect(second.status).toBe(400);
    expect(second.body.error).toBe('rootMessageId is no longer available');
    expect(await prisma.thread.count({ where: { rootMessageId: root.id } })).toBe(1);
    expect(await prisma.thread.count({ where: { roomId: room.id } })).toBe(1);
  });

  it('two concurrent creations on one root: one 201, one 400, one row and no orphan thread', async () => {
    const root = await msg(room.id, bob.id);

    const [a, b] = await Promise.all([
      create(alice.id, { title: 'Racer A', rootMessageId: root.id }),
      create(bob.id, { title: 'Racer B', rootMessageId: root.id }),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 400]);
    const loser = a.status === 400 ? a : b;
    expect(loser.body.error).toBe('rootMessageId is no longer available');
    expect(await prisma.thread.count({ where: { roomId: room.id } })).toBe(1);
  });

  it('refuses a root that is a reply, a soft-deleted message or a message of another room, and writes nothing', async () => {
    const other = await makeRoom([[alice.id, 'MEMBER']]);
    const host = await prisma.thread.create({ data: { title: 'host', roomId: room.id, createdBy: bob.id } });
    const reply = await msg(room.id, bob.id, { threadId: host.id });
    const deleted = await msg(room.id, bob.id, { isDeleted: true });
    const foreign = await msg(other.id, alice.id);

    const results = await Promise.all(
      [reply, deleted, foreign].map((m) => create(alice.id, { title: 'No', rootMessageId: m.id })),
    );

    expect(results.map((r) => r.status)).toEqual([400, 400, 400]);
    expect(results.map((r) => r.body.error)).toEqual([
      'rootMessageId must be a top-level message, not a reply in a thread',
      'rootMessageId names a deleted message',
      'rootMessageId must name a message in this room',
    ]);
    expect(await prisma.thread.count({ where: { roomId: room.id } })).toBe(1); // only the host
    expect(await prisma.thread.count({ where: { roomId: other.id } })).toBe(0);
  });

  it('keeps the thread when the root message row is hard-deleted (rootMessageId becomes null)', async () => {
    const root = await msg(room.id, bob.id);
    const made = await create(alice.id, { title: 'Survivor', rootMessageId: root.id });
    expect(made.status).toBe(201);

    await prisma.message.delete({ where: { id: root.id } });

    const row = await prisma.thread.findUniqueOrThrow({ where: { id: made.body.id } });
    expect(row.rootMessageId).toBeNull();
    expect(row.title).toBe('Survivor');
  });

  it('keeps the reference when the root message is only soft-deleted afterwards', async () => {
    const root = await msg(room.id, bob.id);
    const made = await create(alice.id, { title: 'Still rooted', rootMessageId: root.id });
    await prisma.message.update({ where: { id: root.id }, data: { isDeleted: true } });

    const list = await request(app)
      .get(`/api/rooms/${room.id}/threads`)
      .set('Authorization', bearer(bob.id));

    expect(list.status).toBe(200);
    expect(list.body.find((t: { id: string }) => t.id === made.body.id).rootMessageId).toBe(root.id);
  });

  it.each([
    ['title', { title: 'bad\u0000title' }],
    ['rootMessageId', { title: 'ok', rootMessageId: 'x\u0000y' }],
  ])('a NUL character in %s is 400, not a 500 from Postgres', async (_label, body) => {
    const res = await create(alice.id, body);

    expect(res.status).toBe(400);
    expect(await prisma.thread.count({ where: { roomId: room.id } })).toBe(0);
  });

  it('a NUL character in ?threadId=, ?before= and the thread path is refused without reaching Postgres', async () => {
    const asBob = (path: string) => request(app).get(path).set('Authorization', bearer(bob.id));

    expect((await asBob(`/api/rooms/${room.id}/messages?threadId=a%00b`)).status).toBe(400);
    expect((await asBob(`/api/rooms/${room.id}/threads?before=a%00b`)).status).toBe(400);
    const patch = await request(app)
      .patch(`/api/rooms/${room.id}/threads/a%00b`)
      .set('Authorization', bearer(bob.id))
      .send({ isResolved: true });
    expect(patch.status).toBe(404);
  });

  it('orders the list by lastActivity and pages with before exactly as Postgres evaluates it', async () => {
    const t = [];
    for (let i = 0; i < 4; i += 1) {
      t.push(await prisma.thread.create({
        data: { title: `t${i}`, roomId: room.id, createdBy: alice.id, lastActivity: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) },
      }));
    }
    // t0 gets the newest activity; t2 and t3 tie, so the id breaks the tie.
    await prisma.thread.update({ where: { id: t[0].id }, data: { lastActivity: new Date(Date.UTC(2026, 0, 1, 1, 0, 0)) } });
    await prisma.thread.update({ where: { id: t[2].id }, data: { lastActivity: t[3].lastActivity } });
    const tied = [t[2].id, t[3].id].sort().reverse();
    const expectedIds = [t[0].id, ...tied, t[1].id];

    const get = (q: string) =>
      request(app).get(`/api/rooms/${room.id}/threads${q}`).set('Authorization', bearer(bob.id));
    const all = await get('');
    expect(all.body.map((x: { id: string }) => x.id)).toEqual(expectedIds);

    const p1 = await get('?limit=2');
    const p2 = await get(`?limit=2&before=${p1.body[1].id}`);
    expect([...p1.body, ...p2.body].map((x: { id: string }) => x.id)).toEqual(expectedIds);
  });

  it('GET messages?threadId= leaves out a soft-deleted reply while the room list still has it', async () => {
    const host = await prisma.thread.create({ data: { title: 'host', roomId: room.id, createdBy: alice.id } });
    const live = await msg(room.id, bob.id, { threadId: host.id, content: 'kept reply' });
    const gone = await msg(room.id, bob.id, { threadId: host.id, content: 'secret', isDeleted: true });

    const filtered = await request(app)
      .get(`/api/rooms/${room.id}/messages?threadId=${host.id}`)
      .set('Authorization', bearer(alice.id));
    const whole = await request(app)
      .get(`/api/rooms/${room.id}/messages`)
      .set('Authorization', bearer(alice.id));

    expect(filtered.body.map((m: { id: string }) => m.id)).toEqual([live.id]);
    expect(whole.body.map((m: { id: string }) => m.id).sort()).toEqual([live.id, gone.id].sort());
  });

  it('a byoa agent that is a room member creates a thread, and its reply through POST /api/agents/message bumps the counters in step with the insert', async () => {
    const agentUser = await makeUser('agent', 'AI_AGENT');
    const rawToken = 'byoa_' + crypto.randomBytes(32).toString('hex');
    await prisma.agentToken.create({
      data: {
        token: rawToken,
        name: 'TH agent',
        mentionKey: uniq('mk'),
        userId: agentUser.id,
        createdById: alice.id,
        status: 'active',
        isActive: true,
      },
    });
    await prisma.roomParticipant.create({ data: { userId: agentUser.id, roomId: room.id } });

    const made = await request(app)
      .post(`/api/rooms/${room.id}/threads`)
      .set('Authorization', `Bearer ${rawToken}`)
      .send({ title: 'From the agent' });
    expect(made.status).toBe(201);
    expect(made.body.createdBy).toBe(agentUser.id);

    const before = await prisma.thread.findUniqueOrThrow({ where: { id: made.body.id } });
    const sent = await request(app)
      .post('/api/agents/message')
      .set('Authorization', `Bearer ${rawToken}`)
      .send({ roomId: room.id, content: 'a reply in the thread', threadId: made.body.id });
    expect(sent.status).toBe(201);

    const after = await prisma.thread.findUniqueOrThrow({ where: { id: made.body.id } });
    expect(after.messageCount).toBe(1);
    expect(after.lastActivity.getTime()).toBeGreaterThan(before.lastActivity.getTime());
    expect(await prisma.message.count({ where: { threadId: made.body.id } })).toBe(1);

    const refused = await request(app)
      .post('/api/agents/message')
      .set('Authorization', `Bearer ${rawToken}`)
      .send({ roomId: room.id, content: 'a different words reply', threadId: 'thread-does-not-exist' });
    expect(refused.status).toBe(400);
    expect((await prisma.thread.findUniqueOrThrow({ where: { id: made.body.id } })).messageCount).toBe(1);
  });

  it('a non-member gets 403 on all three routes', async () => {
    const outsider = await makeUser('outsider');
    const t = await prisma.thread.create({ data: { title: 'closed', roomId: room.id, createdBy: alice.id } });
    const auth = bearer(outsider.id);

    expect((await request(app).post(`/api/rooms/${room.id}/threads`).set('Authorization', auth).send({ title: 'x' })).status).toBe(403);
    expect((await request(app).get(`/api/rooms/${room.id}/threads`).set('Authorization', auth)).status).toBe(403);
    expect((await request(app).patch(`/api/rooms/${room.id}/threads/${t.id}`).set('Authorization', auth).send({ isResolved: true })).status).toBe(403);
  });
});
