/**
 * Regression test for task 19e744b4 (issue 1): GET /api/rooms/:roomId?include=project
 * must exclude DONE tasks from project.openTasks.
 *
 * The Task.status column stores LOWERCASE values (todo | in_progress | in_review |
 * done | blocked — see prisma/schema.prisma). The route's task filter used to read
 * `status: { not: 'DONE' } }` (uppercase), which never matches any stored value, so
 * it excluded nothing and completed tasks leaked into openTasks. batch.ts already
 * used the correct lowercase 'done' for its analogous filters.
 *
 * This is a DB-backed integration test. It is skipped unless RUN_DB_TESTS=1 (or
 * "true") is set in the environment, mirroring the gating convention used by
 * auth.test.ts and reviewer-inbox.test.ts.
 *
 * Mutation-testability: reverting the fix back to `not: 'DONE'` makes the assertion
 * that a done-status task is absent from openTasks fail, because the done task would
 * then be included in the response.
 *
 * The 'redis' package is mocked because GET /:roomId always calls
 * ensureRedisConnected() for the online-presence check when the room has any
 * participant (which it always does here). Against an unreachable Redis, the
 * route's connect() attempt fails and is caught, but the subsequent
 * redis.smIsMember() call queues on the still-disconnected client's default
 * offline command queue and never settles — a pre-existing latent hang in
 * rooms.ts unrelated to this task's fix, out of scope to change here. Mocking
 * 'redis' isolates this test from that dependency instead of requiring a real
 * Redis in every environment that runs this suite (this repo's CI does not
 * run a redis service for RUN_DB_TESTS).
 */
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    smIsMember: jest.fn().mockResolvedValue([]),
    // rooms.ts registers an 'error' listener on its client (see
    // rooms-redis-offline.test.ts) so an unhandled post-connect error can't
    // crash the process; the mock needs an `.on` stub for that call to
    // succeed at import time.
    on: jest.fn(),
  })),
}));

import request from 'supertest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

// Unique, stable username scoped to this suite to avoid collisions with
// other DB-integration suites running against the same test database.
const OWNER_USERNAME = 'rooms-opentasks-test-owner';

describeOrSkip('GET /api/rooms/:roomId?include=project — openTasks DONE filter', () => {
  let ownerToken: string;
  let roomId: string;
  let doneTaskId: string;
  let todoTaskId: string;

  beforeAll(async () => {
    // Clean up any leftovers from a previous run.
    const staleUser = await prisma.user.findUnique({
      where: { username: OWNER_USERNAME },
      select: { id: true },
    });
    if (staleUser) {
      await prisma.agentAuditLog.deleteMany({ where: { agentId: staleUser.id } });
    }
    await prisma.user.deleteMany({ where: { username: OWNER_USERNAME } });

    // Register the project owner.
    const ownerReg = await request(app)
      .post('/api/auth/register')
      .send({
        username: OWNER_USERNAME,
        email: `${OWNER_USERNAME}@test.example.com`,
        password: 'Password123',
        displayName: 'Rooms OpenTasks Test Owner',
        userType: 'HUMAN',
      });
    expect(ownerReg.status).toBe(201);
    ownerToken = ownerReg.body.token;
    const ownerId: string = ownerReg.body.user.id;

    // Create a project — this also creates the linked room (roomId in the response).
    const projectRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Rooms OpenTasks Test Project' });
    expect(projectRes.status).toBe(201);
    const projectId: string = projectRes.body.id;
    roomId = projectRes.body.roomId;

    // A DONE task: must be excluded from openTasks.
    const doneTaskRes = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Completed task', assignedTo: ownerId, status: 'done' });
    expect(doneTaskRes.status).toBe(201);
    doneTaskId = doneTaskRes.body.id;

    // An open (default status "todo") task: must be included in openTasks.
    const todoTaskRes = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Open task', assignedTo: ownerId });
    expect(todoTaskRes.status).toBe(201);
    todoTaskId = todoTaskRes.body.id;
  });

  afterAll(async () => {
    const staleUser = await prisma.user.findUnique({
      where: { username: OWNER_USERNAME },
      select: { id: true },
    });
    if (staleUser) {
      await prisma.agentAuditLog.deleteMany({ where: { agentId: staleUser.id } });
    }
    await prisma.user.deleteMany({ where: { username: OWNER_USERNAME } });
    await prisma.$disconnect();
  });

  it('returns 200 with project.openTasks excluding the DONE task and including the open task', async () => {
    const res = await request(app)
      .get(`/api/rooms/${roomId}?include=project`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.project).toBeDefined();

    const openTaskIds: string[] = res.body.project.openTasks.map(
      (t: { id: string }) => t.id,
    );

    // Under the old `not: 'DONE'` (uppercase) filter this would fail: the
    // done task's lowercase status never matched, so it stayed in the result.
    expect(openTaskIds).not.toContain(doneTaskId);
    expect(openTaskIds).toContain(todoTaskId);
  });
});
