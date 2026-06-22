/**
 * Regression test: exactly one task.reviewer.assigned inbox notification
 * must be created when a reviewer is assigned via PATCH /api/projects/tasks/:id.
 *
 * This is a DB-backed integration test. It is skipped unless RUN_DB_TESTS=1
 * (or "true") is set in the environment — the same gating convention used by
 * auth.test.ts and agent-tasks-mcp-live.test.ts.
 *
 * Mutation-testability: re-introducing the duplicate safeInbox block that was
 * removed in the bug fix would make the `toHaveLength(1)` assertion fail
 * because the DB would contain two rows matching the WHERE filter
 * (taskId + recipientId + type).
 */
import request from 'supertest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

// Unique, stable usernames scoped to this test suite to avoid collisions
// with auth.test.ts or other suites running against the same test database.
const OWNER_USERNAME = 'rev-inbox-test-owner';
const REVIEWER_USERNAME = 'rev-inbox-test-reviewer';

describeOrSkip('Reviewer inbox notification deduplication', () => {
  let ownerToken: string;
  let reviewerId: string;
  let projectId: string;
  let taskId: string;

  beforeAll(async () => {
    // Remove any leftover users from a previous run (cascades to their projects,
    // tasks, and inbox items via onDelete: Cascade on the DB relations).
    const staleUsers = await prisma.user.findMany({
      where: { username: { in: [OWNER_USERNAME, REVIEWER_USERNAME] } },
      select: { id: true },
    });
    if (staleUsers.length > 0) {
      // AgentAuditLog has no onDelete cascade, so clear it before the user delete.
      await prisma.agentAuditLog.deleteMany({
        where: { agentId: { in: staleUsers.map((u) => u.id) } },
      });
    }
    await prisma.user.deleteMany({
      where: { username: { in: [OWNER_USERNAME, REVIEWER_USERNAME] } },
    });

    // Register the project owner.
    const ownerReg = await request(app)
      .post('/api/auth/register')
      .send({
        username: OWNER_USERNAME,
        email: `${OWNER_USERNAME}@test.example.com`,
        password: 'Password123',
        displayName: 'Rev Inbox Test Owner',
        userType: 'HUMAN',
      });
    expect(ownerReg.status).toBe(201);
    ownerToken = ownerReg.body.token;

    // Register the reviewer.
    const reviewerReg = await request(app)
      .post('/api/auth/register')
      .send({
        username: REVIEWER_USERNAME,
        email: `${REVIEWER_USERNAME}@test.example.com`,
        password: 'Password123',
        displayName: 'Rev Inbox Test Reviewer',
        userType: 'HUMAN',
      });
    expect(reviewerReg.status).toBe(201);
    reviewerId = reviewerReg.body.user.id;

    // Create a project (owner is automatically in the team).
    const projectRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Reviewer Inbox Test Project' });
    expect(projectRes.status).toBe(201);
    projectId = projectRes.body.id;

    // Add reviewer to the project team so they are an allowed reviewer.
    const teamRes = await request(app)
      .post(`/api/projects/${projectId}/team`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: reviewerId });
    expect(teamRes.status).toBe(200);

    // Create a task assigned to the owner.
    const taskRes = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Reviewer Inbox Test Task' });
    expect(taskRes.status).toBe(201);
    taskId = taskRes.body.id;
  });

  afterAll(async () => {
    // Clean up test users (cascades to projects, tasks, and inbox items).
    const staleUsers = await prisma.user.findMany({
      where: { username: { in: [OWNER_USERNAME, REVIEWER_USERNAME] } },
      select: { id: true },
    });
    if (staleUsers.length > 0) {
      // AgentAuditLog has no onDelete cascade, so clear it before the user delete.
      await prisma.agentAuditLog.deleteMany({
        where: { agentId: { in: staleUsers.map((u) => u.id) } },
      });
    }
    await prisma.user.deleteMany({
      where: { username: { in: [OWNER_USERNAME, REVIEWER_USERNAME] } },
    });
    await prisma.$disconnect();
  });

  it('creates exactly one task.reviewer.assigned inbox notification when reviewer is assigned', async () => {
    // Assign the reviewer via the PATCH endpoint.
    const patchRes = await request(app)
      .patch(`/api/projects/tasks/${taskId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reviewedBy: reviewerId });
    expect(patchRes.status).toBe(200);

    // Query the DB for inbox items scoped to this task + reviewer + notification type.
    // If the duplicate safeInbox call were re-introduced, two rows would be written
    // and this assertion would fail with "expected Array with 2 items to have length 1".
    const inboxItems = await prisma.inboxItem.findMany({
      where: {
        taskId,
        recipientId: reviewerId,
        type: 'task.reviewer.assigned',
      },
    });

    expect(inboxItems).toHaveLength(1);
  });
});
