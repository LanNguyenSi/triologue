/**
 * Regression test for task 19e744b4 (issue 2): GET /api/agents/:mentionKey/context
 * must not 500 when a room's recent messages include one sent by a user who has
 * since been deleted.
 *
 * Message.senderId is nullable with onDelete: SetNull (prisma/schema.prisma), so a
 * deleted sender leaves `sender: null` on the message row rather than removing the
 * message. The route used to read `m.sender!.username` / `m.sender!.userType`
 * unconditionally, which throws a TypeError (reading a property of null) and
 * surfaces as an HTTP 500. rooms.ts already tolerates a null/deleted sender
 * elsewhere; this route now falls back consistently (matching the identical
 * recentMessages shape already used in agents.ts's own context route).
 *
 * This is a DB-backed integration test. It is skipped unless RUN_DB_TESTS=1 (or
 * "true") is set in the environment, mirroring the gating convention used by
 * auth.test.ts and reviewer-inbox.test.ts.
 *
 * Mutation-testability: reverting to `m.sender!.username` / `m.sender!.userType`
 * makes this test fail with a 500 instead of the expected 200.
 */
import request from 'supertest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

// Unique, stable usernames/keys scoped to this suite to avoid collisions with
// other DB-integration suites running against the same test database.
const ADMIN_USERNAME = 'agent-ctx-deleted-sender-admin';
const AGENT_USERNAME = 'agent-ctx-deleted-sender-agent';
const VICTIM_USERNAME = 'agent-ctx-deleted-sender-victim';
const MENTION_KEY = `dsagent${crypto.randomBytes(3).toString('hex')}`;

describeOrSkip('GET /api/agents/:mentionKey/context — deleted message sender', () => {
  let adminToken: string;
  let roomId: string;
  let messageId: string;
  let messageContent: string;

  beforeAll(async () => {
    // Clean up leftovers from a previous run.
    const staleUsers = await prisma.user.findMany({
      where: { username: { in: [ADMIN_USERNAME, AGENT_USERNAME, VICTIM_USERNAME] } },
      select: { id: true },
    });
    if (staleUsers.length > 0) {
      await prisma.agentAuditLog.deleteMany({
        where: { agentId: { in: staleUsers.map((u) => u.id) } },
      });
    }
    await prisma.agentToken.deleteMany({ where: { mentionKey: MENTION_KEY } });
    await prisma.user.deleteMany({
      where: { username: { in: [ADMIN_USERNAME, AGENT_USERNAME, VICTIM_USERNAME] } },
    });

    // Admin user (requester): the route allows the agent itself or an admin.
    const adminReg = await request(app)
      .post('/api/auth/register')
      .send({
        username: ADMIN_USERNAME,
        email: `${ADMIN_USERNAME}@test.example.com`,
        password: 'Password123',
        displayName: 'Agent Ctx Test Admin',
        userType: 'HUMAN',
      });
    expect(adminReg.status).toBe(201);
    adminToken = adminReg.body.token;
    await prisma.user.update({
      where: { id: adminReg.body.user.id },
      data: { isAdmin: true },
    });

    // Agent user + active AgentToken, created directly via Prisma (the HTTP
    // creation route requires canTriggerAI / admin approval plumbing that is
    // out of scope for this regression test).
    const agentUser = await prisma.user.create({
      data: {
        username: AGENT_USERNAME,
        displayName: 'Agent Ctx Test Agent',
        userType: 'AI_AGENT',
        isActive: true,
        canTriggerAI: false,
      },
    });

    await prisma.agentToken.create({
      data: {
        token: `byoa_${crypto.randomBytes(16).toString('hex')}`,
        name: 'Agent Ctx Test Agent',
        mentionKey: MENTION_KEY,
        userId: agentUser.id,
        createdById: adminReg.body.user.id,
        status: 'active',
        isActive: true,
      },
    });

    // Victim user: will send a message, then be deleted (senderId -> null via
    // the onDelete: SetNull FK).
    const victim = await prisma.user.create({
      data: {
        username: VICTIM_USERNAME,
        displayName: 'Agent Ctx Test Victim',
        userType: 'HUMAN',
        email: `${VICTIM_USERNAME}@test.example.com`,
        passwordHash: 'not-a-real-hash',
      },
    });

    // Room with the agent as a participant (so it shows up in the agent's
    // roomParticipations) and the victim as the sender of a recent message.
    const room = await prisma.room.create({
      data: {
        name: 'Agent Ctx Test Room',
        roomType: 'TRIOLOGUE',
        isPrivate: true,
        participants: {
          create: [
            { userId: agentUser.id, role: 'MEMBER' },
            { userId: victim.id, role: 'MEMBER' },
          ],
        },
      },
    });
    roomId = room.id;

    messageContent = 'This message will outlive its sender';
    const message = await prisma.message.create({
      data: {
        content: messageContent,
        senderId: victim.id,
        roomId: room.id,
      },
    });
    messageId = message.id;

    // Delete the victim: the real FK constraint (onDelete: SetNull) sets
    // message.senderId to null, leaving the message's `sender` relation null.
    await prisma.user.delete({ where: { id: victim.id } });
  });

  afterAll(async () => {
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.agentToken.deleteMany({ where: { mentionKey: MENTION_KEY } });
    const staleUsers = await prisma.user.findMany({
      where: { username: { in: [ADMIN_USERNAME, AGENT_USERNAME] } },
      select: { id: true },
    });
    if (staleUsers.length > 0) {
      await prisma.agentAuditLog.deleteMany({
        where: { agentId: { in: staleUsers.map((u) => u.id) } },
      });
    }
    await prisma.user.deleteMany({
      where: { username: { in: [ADMIN_USERNAME, AGENT_USERNAME] } },
    });
    await prisma.$disconnect();
  });

  it('returns 200 with a fallback sender/senderType for a message whose sender was deleted', async () => {
    // Sanity check: the message really has no sender relation left.
    const raw = await prisma.message.findUnique({
      where: { id: messageId },
      include: { sender: true },
    });
    expect(raw?.senderId).toBeNull();
    expect(raw?.sender).toBeNull();

    // This route lives in server/src/routes/batch.ts (router.get('/agents/:mentionKey/context', ...)),
    // mounted at app.use('/api/batch', batchRoutes) in index.ts — so the full
    // path is /api/batch/agents/:mentionKey/context, not /api/agents/....
    const res = await request(app)
      .get(`/api/batch/agents/${MENTION_KEY}/context`)
      .set('Authorization', `Bearer ${adminToken}`);

    // Under the old `m.sender!.username` code this would 500 instead of 200.
    expect(res.status).toBe(200);

    const room = res.body.rooms.find((r: { id: string }) => r.id === roomId);
    expect(room).toBeDefined();

    const msg = room.recentMessages.find((m: { id: string }) => m.id === messageId);
    expect(msg).toBeDefined();
    expect(msg.content).toBe(messageContent);
    expect(msg.sender).toBe('unknown');
    expect(msg.senderType).toBe('unknown');
  });
});
