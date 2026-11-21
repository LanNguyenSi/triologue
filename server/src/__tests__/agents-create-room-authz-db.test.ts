/**
 * DB-backed check of POST /api/agents with a foreign private room: a creator
 * who is not an OWNER or ADMIN of the room is refused with 403 and the
 * database holds no trace of the attempt (no agent user, no agent token, no
 * participant row in the room). An OWNER's request adds exactly one agent
 * participant. Gated on RUN_DB_TESTS=1 (needs a migrated Postgres).
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

const suffix = crypto.randomBytes(4).toString('hex');
const userIds: string[] = [];
const roomIds: string[] = [];

const signJwt = (userId: string) =>
  jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: '1h' });

async function makeHuman(label: string) {
  const user = await prisma.user.create({
    data: { username: `raz-${label}-${suffix}`, displayName: label, userType: 'HUMAN' },
  });
  userIds.push(user.id);
  return { id: user.id, jwt: signJwt(user.id) };
}

describeOrSkip('POST /api/agents room authorization (database)', () => {
  let owner: { id: string; jwt: string };
  let outsider: { id: string; jwt: string };
  let privateRoomId: string;

  beforeAll(async () => {
    await prisma.room.upsert({
      where: { id: 'registration' },
      create: { id: 'registration', name: 'registration', isPrivate: true },
      update: {},
    });
    owner = await makeHuman('owner');
    outsider = await makeHuman('outsider');
    const room = await prisma.room.create({
      data: { name: `raz-private-${suffix}`, isPrivate: true },
    });
    privateRoomId = room.id;
    roomIds.push(room.id);
    await prisma.roomParticipant.create({
      data: { userId: owner.id, roomId: room.id, role: 'OWNER' },
    });
  });

  afterAll(async () => {
    const agentUserIds = (
      await prisma.agentToken.findMany({
        where: { createdById: { in: userIds } },
        select: { userId: true },
      })
    ).map((a) => a.userId);
    await prisma.roomParticipant.deleteMany({
      where: { userId: { in: [...userIds, ...agentUserIds] } },
    });
    await prisma.agentToken.deleteMany({ where: { createdById: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: agentUserIds } } });
    await prisma.room.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('a non-member creator is refused and nothing is written', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${outsider.jwt}`)
      .send({ name: `RazOutsider${suffix}`, roomId: privateRoomId });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Only room owners/admins can invite users' });
    expect(await prisma.agentToken.count({ where: { createdById: outsider.id } })).toBe(0);
    expect(
      await prisma.user.count({ where: { username: { startsWith: `agent_razoutsider${suffix}` } } }),
    ).toBe(0);
    const participants = await prisma.roomParticipant.findMany({
      where: { roomId: privateRoomId },
    });
    expect(participants.map((p) => p.userId)).toEqual([owner.id]);
  });

  it('the room OWNER adds the agent as exactly one extra participant', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${owner.jwt}`)
      .send({ name: `RazOwner${suffix}`, roomId: privateRoomId });

    expect(res.status).toBe(201);
    const participants = await prisma.roomParticipant.findMany({
      where: { roomId: privateRoomId },
      orderBy: { joinedAt: 'asc' },
    });
    expect(participants.map((p) => [p.userId, p.role])).toEqual([
      [owner.id, 'OWNER'],
      [res.body.agentUserId, 'MEMBER'],
    ]);
  });
});
