/**
 * Regression test for triologue task 6bc2a14c: DELETE /api/auth/me returned
 * an opaque 500 ("Failed to delete account.") and left the user row in
 * place for any user who had ever caused an agent_audit_log row to be
 * written (e.g. via PATCH /api/projects/tasks/:id, which fires an
 * unconditional, un-awaited `logAuditEvent` on every successful call --
 * see services/auditService.ts and routes/projects.ts's updateTask).
 * AgentAuditLog.agentId had no `onDelete` rule (defaulting to a blocking
 * constraint), so `prisma.user.delete()` failed with Prisma P2003 and the
 * route's bare `catch {}` swallowed the cause.
 *
 * Fix (decision D-001, see docs/okf/prisma-data-model-invariants.md
 * Invariant 6): AgentAuditLog.agentId is now nullable with
 * `onDelete: SetNull` (migration
 * 20260923045824_agent_audit_log_agentid_nullable_setnull), so the row
 * survives, anonymised, instead of blocking the delete. The route's catch
 * block also now distinguishes a known Prisma constraint failure (409) from
 * an unexpected error (500), instead of collapsing both into the same
 * generic message.
 *
 * This is a DB-backed integration test, gated on RUN_DB_TESTS like
 * auth.test.ts and reviewer-inbox.test.ts.
 *
 * Mutation-testability:
 *  - reverting AgentAuditLog.agentId to non-null / onDelete default (or
 *    reverting the route to its old `prisma.user.delete` without the new
 *    catch classification) makes the first test's `expect(delRes.status)
 *    .toBe(200)` fail with 500, and `userAfter` would still be non-null.
 *  - removing the catch arm's `Prisma.PrismaClientKnownRequestError` /
 *    `P2003` classification collapses the second test's 409 case to 500,
 *    failing `expect(constraintRes.status).toBe(409)`.
 */
import request from 'supertest';
import { app } from '../index';
import { PrismaClient, Prisma } from '@prisma/client';
import appPrisma from '../lib/prisma';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

const USERNAME_PREFIX = 'self-delete-test';

// PATCH /api/projects/tasks/:id ends with a fire-and-forget
// `logAuditEvent` (see reviewer-inbox.test.ts for the full mechanism and
// why an un-awaited write can otherwise still be in flight when a later
// assertion or teardown runs). Wrapping the app's own Prisma client the
// same way lets this file await the audit write before asserting on it or
// deleting the user it references.
type AgentAuditLogCreate = typeof appPrisma.agentAuditLog.create;
type AgentAuditLogCreateArgs = Parameters<AgentAuditLogCreate>[0];
type AgentAuditLogCreateResult = ReturnType<AgentAuditLogCreate>;
const originalAgentAuditLogCreate = appPrisma.agentAuditLog.create.bind(
  appPrisma.agentAuditLog,
) as AgentAuditLogCreate;
const pendingAuditWrites: Promise<unknown>[] = [];

async function flushPendingAuditWrites() {
  while (pendingAuditWrites.length > 0) {
    await Promise.allSettled(pendingAuditWrites.splice(0));
  }
}

async function cleanupUsers() {
  await flushPendingAuditWrites();
  const staleUsers = await prisma.user.findMany({
    where: { username: { startsWith: USERNAME_PREFIX } },
    select: { id: true },
  });
  if (staleUsers.length > 0) {
    await prisma.agentAuditLog.deleteMany({
      where: { agentId: { in: staleUsers.map((u) => u.id) } },
    });
  }
  await prisma.user.deleteMany({
    where: { username: { startsWith: USERNAME_PREFIX } },
  });
}

describeOrSkip('DELETE /api/auth/me with agent_audit_log rows', () => {
  let auditCreateSpy: jest.SpyInstance;

  beforeAll(async () => {
    auditCreateSpy = jest
      .spyOn(appPrisma.agentAuditLog, 'create')
      .mockImplementation(((args: AgentAuditLogCreateArgs): AgentAuditLogCreateResult => {
        const write = originalAgentAuditLogCreate(args);
        pendingAuditWrites.push(write.catch(() => undefined));
        return write;
      }) as unknown as AgentAuditLogCreate);
    await cleanupUsers();
  });

  afterAll(async () => {
    try {
      await cleanupUsers();
    } finally {
      auditCreateSpy.mockRestore();
      await prisma.$disconnect();
    }
  });

  it('returns 200 and removes the user after a PATCH wrote an agent_audit_log row, leaving that row anonymised', async () => {
    const username = `${USERNAME_PREFIX}-happy`;

    const reg = await request(app).post('/api/auth/register').send({
      username,
      email: `${username}@test.example.com`,
      password: 'Password123',
      displayName: 'Self Delete Test',
      userType: 'HUMAN',
    });
    expect(reg.status).toBe(201);
    const token = reg.body.token as string;
    const userId = reg.body.user.id as string;

    const projectRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Self Delete Test Project' });
    expect(projectRes.status).toBe(201);
    const projectId = projectRes.body.id as string;

    const taskRes = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Self Delete Test Task' });
    expect(taskRes.status).toBe(201);
    const taskId = taskRes.body.id as string;

    // PATCH once (any field edit unconditionally fires logAuditEvent at the
    // end of updateTask) -- this is the write that produces the blocking
    // agent_audit_log row at base.
    const patchRes = await request(app)
      .patch(`/api/projects/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Self Delete Test Task Updated' });
    expect(patchRes.status).toBe(200);

    await flushPendingAuditWrites();

    const auditRowBefore = await prisma.agentAuditLog.findFirst({
      where: { resourceId: taskId },
    });
    expect(auditRowBefore).not.toBeNull();
    expect(auditRowBefore!.agentId).toBe(userId);

    const delRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'Password123' });

    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual({ message: 'Account deleted successfully.' });

    const userAfter = await prisma.user.findUnique({ where: { id: userId } });
    expect(userAfter).toBeNull();

    const auditRowAfter = await prisma.agentAuditLog.findFirst({
      where: { resourceId: taskId },
    });
    expect(auditRowAfter).not.toBeNull();
    expect(auditRowAfter!.agentId).toBeNull();
    expect(auditRowAfter!.action).toBe('task.update');
  });

  it('distinguishes a known constraint failure (409) from an unexpected error (500) instead of collapsing both into one message', async () => {
    const username = `${USERNAME_PREFIX}-catch-arm`;

    const reg = await request(app).post('/api/auth/register').send({
      username,
      email: `${username}@test.example.com`,
      password: 'Password123',
      displayName: 'Self Delete Catch Arm',
      userType: 'HUMAN',
    });
    expect(reg.status).toBe(201);
    const token = reg.body.token as string;
    const userId = reg.body.user.id as string;

    const userDeleteSpy = jest.spyOn(appPrisma.user, 'delete');

    // Known constraint failure: Prisma P2003 (foreign key constraint
    // violation), the exact error class the route used to swallow.
    userDeleteSpy.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed on the field: some_other_fkey',
        { code: 'P2003', clientVersion: '5.22.0', meta: { field_name: 'some_other_fkey' } },
      ),
    );
    const constraintRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'Password123' });
    expect(constraintRes.status).toBe(409);
    expect(constraintRes.body.code).toBe('P2003');
    expect(constraintRes.body.error).not.toBe('Failed to delete account.');

    // Unexpected error: anything that is not a known Prisma request error
    // still falls back to the original 500/generic-message behaviour.
    userDeleteSpy.mockRejectedValueOnce(new Error('unexpected database outage'));
    const unexpectedRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'Password123' });
    expect(unexpectedRes.status).toBe(500);
    expect(unexpectedRes.body).toEqual({ error: 'Failed to delete account.' });

    userDeleteSpy.mockRestore();

    const userStillPresent = await prisma.user.findUnique({ where: { id: userId } });
    expect(userStillPresent).not.toBeNull();
  });
});
