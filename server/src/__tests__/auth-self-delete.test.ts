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
 * Fix (see docs/okf/prisma-data-model-invariants.md Invariant 6, decision:
 * anonymise): AgentAuditLog.agentId is now nullable with
 * `onDelete: SetNull` (migration
 * 20260923045824_agent_audit_log_agentid_nullable_setnull), so the row
 * survives, anonymised, instead of blocking the delete. The route's catch
 * block also now distinguishes a known Prisma constraint failure (409) from
 * an unexpected error (500), instead of collapsing both into the same
 * generic message. In the same `prisma.$transaction` as the user delete,
 * the route also scrubs `agent_audit_log.details`: JSON `null` on every row
 * this user wrote (their own user-typed text, e.g. a task title, can
 * otherwise be the only surviving copy once its source row is
 * cascade-deleted with them), and the `assignedTo` key removed from any
 * OTHER user's row that names this user's id there.
 *
 * This is a DB-backed integration test, gated on RUN_DB_TESTS like
 * auth.test.ts and reviewer-inbox.test.ts.
 *
 * Mutation-testability:
 *  - reverting AgentAuditLog.agentId to non-null / onDelete default now
 *    trips the route's own P2003 classification (the migration is a
 *    RESTRICT-vs-SetNull FK, not a swallowed unknown error), so the first
 *    test's `expect(delRes.status).toBe(200)` fails with `409`, not `500`,
 *    and `userAfter` stays non-null.
 *  - reverting the route to its pre-fix bare `prisma.user.delete()` (no
 *    catch classification at all) instead makes that same assertion fail
 *    with the old opaque `500`.
 *  - removing the catch arm's `Prisma.PrismaClientKnownRequestError` /
 *    `P2003` classification collapses the second test's 409 case to 500,
 *    failing `expect(constraintRes.status).toBe(409)`.
 *  - removing the `details: Prisma.JsonNull` scrub, or the `assignedTo`
 *    jsonb-removal `$executeRaw`, is pinned by the third test below (see
 *    its own header comment).
 */
import request from 'supertest';
import { app } from '../index';
import { PrismaClient, Prisma } from '@prisma/client';
import appPrisma from '../lib/prisma';
import { logger } from '../utils/logger';

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

    // The route's delete now runs inside `prisma.$transaction(async (tx) =>
    // {...})`; `tx` is a distinct, transaction-scoped client object, not
    // `appPrisma.user` itself, so spying on `appPrisma.user.delete` would
    // never see the call made through `tx.user.delete`. Spying on
    // `appPrisma.$transaction` -- the one method the route actually calls
    // directly -- reaches the same catch block regardless of which
    // statement inside the transaction would have failed.
    const transactionSpy = jest.spyOn(appPrisma, '$transaction');
    const logErrorSpy = jest.spyOn(logger, 'error');

    // Known constraint failure: Prisma P2003 (foreign key constraint
    // violation), the exact error class the route used to swallow.
    transactionSpy.mockRejectedValueOnce(
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
    // Pins the log call's `code` field so a mutant that drops it from the
    // 409 logger meta (while leaving status/body untouched) is caught here
    // instead of surviving unnoticed.
    expect(logErrorSpy).toHaveBeenCalledWith(
      'Account deletion blocked by a foreign key constraint',
      expect.objectContaining({ code: 'P2003' }),
    );

    // Unexpected error: anything that is not a known Prisma request error
    // still falls back to the original 500/generic-message behaviour.
    logErrorSpy.mockClear();
    transactionSpy.mockRejectedValueOnce(new Error('unexpected database outage'));
    const unexpectedRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'Password123' });
    expect(unexpectedRes.status).toBe(500);
    expect(unexpectedRes.body).toEqual({ error: 'Failed to delete account.' });
    expect(logErrorSpy).toHaveBeenCalledWith(
      'Failed to delete account',
      expect.objectContaining({ error: 'unexpected database outage' }),
    );

    transactionSpy.mockRestore();
    logErrorSpy.mockRestore();

    const userStillPresent = await prisma.user.findUnique({ where: { id: userId } });
    expect(userStillPresent).not.toBeNull();
  });

  // Pins the two scrub statements the DELETE /me transaction runs before
  // `tx.user.delete`: `details: Prisma.JsonNull` on the deleting user's own
  // rows, and the jsonb `assignedTo`-key removal on rows another,
  // still-present user wrote. A mutant that drops either statement (or
  // reverts it to a no-op) survives this test's corresponding assertion.
  it("scrubs the deleting user's own audit rows to details=null and removes their id from another user's assignedTo, without touching that other row's agentId", async () => {
    const usernameA = `${USERNAME_PREFIX}-scrub-a`;
    const usernameB = `${USERNAME_PREFIX}-scrub-b`;

    const regA = await request(app).post('/api/auth/register').send({
      username: usernameA,
      email: `${usernameA}@test.example.com`,
      password: 'Password123',
      displayName: 'Scrub Test A',
      userType: 'HUMAN',
    });
    expect(regA.status).toBe(201);
    const tokenA = regA.body.token as string;
    const userA = regA.body.user.id as string;

    const regB = await request(app).post('/api/auth/register').send({
      username: usernameB,
      email: `${usernameB}@test.example.com`,
      password: 'Password123',
      displayName: 'Scrub Test B',
      userType: 'HUMAN',
    });
    expect(regB.status).toBe(201);
    const tokenB = regB.body.token as string;
    const userB = regB.body.user.id as string;

    const projectRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Scrub Test Project' });
    expect(projectRes.status).toBe(201);
    const projectId = projectRes.body.id as string;

    const teamRes = await request(app)
      .post(`/api/projects/${projectId}/team`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ userId: userB });
    expect(teamRes.status).toBe(200);

    // A creates the task assigned to B, so B is the current assignee and
    // may reassign it.
    const taskRes = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Scrub Test Task', assignedTo: userB });
    expect(taskRes.status).toBe(201);
    const taskId = taskRes.body.id as string;

    // Row written by B: agentId=B, details.assignedTo=A's id (B, the
    // current assignee, reassigns the task to A). This is the "other
    // user's row naming this user's id" case scrub (b) must reach.
    const reassignRes = await request(app)
      .patch(`/api/projects/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ assignedTo: userA });
    expect(reassignRes.status).toBe(200);

    // Row written by A: agentId=A, details.title and details.assignedTo
    // both reference A. This is the "user's own row" case scrub (a) must
    // reach (A is now the owner AND the current assignee, so either gate
    // in updateTask lets this PATCH through).
    const ownEditRes = await request(app)
      .patch(`/api/projects/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Scrub Test Task (A edit)', assignedTo: userA });
    expect(ownEditRes.status).toBe(200);

    await flushPendingAuditWrites();

    const rowsBefore = await prisma.agentAuditLog.findMany({
      where: { resourceId: taskId },
      orderBy: { timestamp: 'asc' },
    });
    expect(rowsBefore).toHaveLength(2);
    const rowBBefore = rowsBefore.find((r) => r.agentId === userB);
    const rowABefore = rowsBefore.find((r) => r.agentId === userA);
    expect(rowBBefore).toBeDefined();
    expect(rowABefore).toBeDefined();
    expect((rowBBefore!.details as unknown as Record<string, unknown>).assignedTo).toBe(userA);
    expect((rowABefore!.details as unknown as Record<string, unknown>).assignedTo).toBe(userA);

    const delRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ password: 'Password123' });
    expect(delRes.status).toBe(200);

    const rowAAfter = await prisma.agentAuditLog.findUnique({ where: { id: rowABefore!.id } });
    expect(rowAAfter).not.toBeNull();
    expect(rowAAfter!.agentId).toBeNull();
    expect(rowAAfter!.details).toBeNull();

    const rowBAfter = await prisma.agentAuditLog.findUnique({ where: { id: rowBBefore!.id } });
    expect(rowBAfter).not.toBeNull();
    // B is a different, still-present user: agentId is untouched.
    expect(rowBAfter!.agentId).toBe(userB);
    expect(rowBAfter!.details).not.toBeNull();
    expect(rowBAfter!.details as unknown as Record<string, unknown>).not.toHaveProperty('assignedTo');
  });

  // Pins the LOW review finding that routes/projects.ts's
  // `GET /:projectId/activity` null-safe agentId handling (Invariant 6 in
  // docs/okf/prisma-data-model-invariants.md) was previously unexercised by
  // any test: the project owner reading activity after a team member
  // self-deletes must still get 200, with that member's row anonymised.
  it("returns 200 from GET /:projectId/activity with an anonymised row (agentId null, no agentName) after the acting member self-deletes", async () => {
    // Username pattern caps at 30 chars (utils/validation.ts patterns.username);
    // USERNAME_PREFIX (17 chars) leaves little room, hence the short suffixes.
    const usernameOwner = `${USERNAME_PREFIX}-actv-own`;
    const usernameMember = `${USERNAME_PREFIX}-actv-mem`;

    const regOwner = await request(app).post('/api/auth/register').send({
      username: usernameOwner,
      email: `${usernameOwner}@test.example.com`,
      password: 'Password123',
      displayName: 'Activity Test Owner',
      userType: 'HUMAN',
    });
    expect(regOwner.status).toBe(201);
    const tokenOwner = regOwner.body.token as string;

    const regMember = await request(app).post('/api/auth/register').send({
      username: usernameMember,
      email: `${usernameMember}@test.example.com`,
      password: 'Password123',
      displayName: 'Activity Test Member',
      userType: 'HUMAN',
    });
    expect(regMember.status).toBe(201);
    const tokenMember = regMember.body.token as string;

    const projectRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ name: 'Activity Test Project' });
    expect(projectRes.status).toBe(201);
    const projectId = projectRes.body.id as string;
    const memberId = regMember.body.user.id as string;

    const teamRes = await request(app)
      .post(`/api/projects/${projectId}/team`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ userId: memberId });
    expect(teamRes.status).toBe(200);

    // Owner creates the task assigned to the member, so the member (the
    // current assignee) may edit its title.
    const taskRes = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${tokenOwner}`)
      .send({ title: 'Activity Test Task', assignedTo: memberId });
    expect(taskRes.status).toBe(201);
    const taskId = taskRes.body.id as string;

    const patchRes = await request(app)
      .patch(`/api/projects/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenMember}`)
      .send({ title: 'Activity Test Task (member edit)' });
    expect(patchRes.status).toBe(200);

    await flushPendingAuditWrites();

    const delRes = await request(app)
      .delete('/api/auth/me')
      .set('Authorization', `Bearer ${tokenMember}`)
      .send({ password: 'Password123' });
    expect(delRes.status).toBe(200);

    const activityRes = await request(app)
      .get(`/api/projects/${projectId}/activity`)
      .set('Authorization', `Bearer ${tokenOwner}`);
    expect(activityRes.status).toBe(200);

    const item = activityRes.body.items.find(
      (entry: { resourceId: string | null }) => entry.resourceId === taskId,
    );
    expect(item).toBeDefined();
    expect(item.agentId).toBeNull();
    expect(item.agentName).toBeUndefined();
    expect(item.agentUsername).toBeUndefined();
  });
});
