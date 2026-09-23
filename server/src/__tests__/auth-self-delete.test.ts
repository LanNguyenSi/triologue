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
 * generic message, and writes the Prisma code and cause into the log
 * MESSAGE string (not a metadata object utils/logger.ts's formatter
 * silently drops). In the same batch `prisma.$transaction([...])` as the
 * user delete (a plain array, not an interactive `(tx) => {...}` callback,
 * to avoid that form's default 5s timeout on a heavy account's cascade),
 * the route locks this user's row (`SELECT ... FOR UPDATE`) and scrubs
 * `agent_audit_log.details`: JSON `null` on every row this user wrote
 * (their own user-typed text, e.g. a task title, can otherwise be the only
 * surviving copy once its source row is cascade-deleted with them), and
 * the `assignedTo` key removed from any OTHER user's row that names this
 * user's id there. This does NOT scrub user-authored text of this user's
 * that a DIFFERENT actor copied into that other actor's own audit row
 * (e.g. an attachment filename audited under the uploading agent's id);
 * that class is out of this task's scope, tracked as GDPR inventory task
 * 75fac3fe (see the route's own comment and Invariant 6).
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
 *  - dropping the Prisma code from the 409 arm's log message string is
 *    pinned by both the second test (spy on the call argument) and the
 *    third test (the actual formatted, written line).
 *  - removing the `details: Prisma.JsonNull` scrub, or the `assignedTo`
 *    jsonb-removal `$executeRaw`, is pinned by the scrub test below (see
 *    its own header comment).
 *  - moving either scrub statement out of the `$transaction` array (so it
 *    runs as a separate, non-atomic `prisma.*` call before the batch) is
 *    pinned by the unmocked 409-and-rollback test below, which forces a
 *    real RESTRICT foreign key failure on the final `user.delete` element
 *    and asserts the scrub did NOT survive that rollback.
 */
import { Writable } from 'stream';
import winston from 'winston';
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

    // The route's delete now runs as a batch `prisma.$transaction([...])`
    // (an array of operations, not an interactive `(tx) => {...}`
    // callback -- see the route's own comment for why), but every element
    // of that array is still built from the top-level `prisma` client
    // itself, so spying on `appPrisma.$transaction` -- the one method the
    // route actually calls directly -- reaches the same catch block
    // regardless of which array element would have failed.
    const transactionSpy = jest.spyOn(appPrisma, '$transaction');
    const logErrorSpy = jest.spyOn(logger, 'error');

    try {
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
      // Pins the log call's single message argument (utils/logger.ts's
      // printf formatter drops any second, metadata-object argument from
      // every written line -- see the next test, which pins the actual
      // formatted output) so a mutant that drops the code from that
      // message string, while leaving status/body untouched, is caught
      // here instead of surviving unnoticed.
      expect(logErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('P2003'),
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
        expect.stringContaining('unexpected database outage'),
      );
    } finally {
      transactionSpy.mockRestore();
      logErrorSpy.mockRestore();
    }

    const userStillPresent = await prisma.user.findUnique({ where: { id: userId } });
    expect(userStillPresent).not.toBeNull();
  });

  // Pins the WRITTEN log line, not just the arguments passed to
  // `logger.error`: utils/logger.ts's `winston.format.printf` destructures
  // only `{ level, message, timestamp, stack }` from each log call, so a
  // second, metadata-object argument (the shape the route used before this
  // round) is silently dropped from every actual transport -- console and
  // both file transports -- even though a `jest.spyOn(logger, 'error')`
  // assertion on the call's arguments would still see it. Attaching a
  // throwaway `winston.transports.Stream` sink (no transport-level
  // `format` override, so it renders through the same top-level
  // `logFormat` the Console/File transports use) captures the actual
  // formatted bytes winston writes, the same way a human operator reading
  // logs/error.log would see them.
  it('writes the Prisma error code into the actual formatted log line for the 409 arm, not just a dropped metadata argument', async () => {
    const username = `${USERNAME_PREFIX}-log-line`;

    const reg = await request(app).post('/api/auth/register').send({
      username,
      email: `${username}@test.example.com`,
      password: 'Password123',
      displayName: 'Self Delete Log Line',
      userType: 'HUMAN',
    });
    expect(reg.status).toBe(201);
    const token = reg.body.token as string;

    const written: string[] = [];
    const sink = new winston.transports.Stream({
      stream: new Writable({
        write(chunk: Buffer, _enc, cb) {
          written.push(chunk.toString());
          cb();
        },
      }),
      level: 'error',
    });
    logger.add(sink);

    const transactionSpy = jest.spyOn(appPrisma, '$transaction');
    try {
      transactionSpy.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError(
          'Foreign key constraint failed on the field: approval_request_requestedBy_fkey',
          {
            code: 'P2003',
            clientVersion: '5.22.0',
            meta: { field_name: 'approval_request_requestedBy_fkey' },
          },
        ),
      );
      const res = await request(app)
        .delete('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'Password123' });
      expect(res.status).toBe(409);
    } finally {
      transactionSpy.mockRestore();
      logger.remove(sink);
    }

    const writtenLine = written.join('');
    expect(writtenLine).toContain('P2003');
    expect(writtenLine).toContain('approval_request_requestedBy_fkey');
  });

  // Pins the two scrub statements the DELETE /me transaction runs before
  // `prisma.user.delete`: `details: Prisma.JsonNull` on the deleting user's
  // own rows, and the jsonb `assignedTo`-key removal on rows another,
  // still-present user wrote. A mutant that drops either statement (or
  // reverts it to a no-op) FAILS this test's corresponding assertion
  // (i.e. is killed by it, not survives it).
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

  // Pins that the scrub statements run INSIDE the same `$transaction`
  // array as `prisma.user.delete`, atomically: a real (not mocked),
  // unmocked RESTRICT foreign key -- InviteCode.createdBy declares no
  // `onDelete` in schema.prisma, unlike agent_audit_log.agentId -- makes
  // the transaction's own final `user.delete` element fail with P2003, and
  // because every element of a batch `$transaction([...])` commits or
  // rolls back together as one native DB transaction, the two scrub
  // statements that ran earlier in that same array must roll back with it.
  // A mutant that moves either scrub statement OUT of the `$transaction`
  // array into a separate, earlier `prisma.*` call (so it commits on its
  // own, before the batch that then fails) survives every other test in
  // this file (their `$transaction` calls all succeed) but is killed here:
  // the moved-out scrub would already be durably committed by the time the
  // 409 response comes back, so this test's post-409 assertions that C's
  // own row and D's row are UNCHANGED would fail.
  it('rolls back the scrub together with the delete when a real, unmocked RESTRICT foreign key (invite_codes.createdById) blocks the transaction, leaving the user, their own audit row and another row\'s assignedTo untouched', async () => {
    const usernameC = `${USERNAME_PREFIX}-409-c`;
    const usernameD = `${USERNAME_PREFIX}-409-d`;

    const regC = await request(app).post('/api/auth/register').send({
      username: usernameC,
      email: `${usernameC}@test.example.com`,
      password: 'Password123',
      displayName: '409 Rollback C',
      userType: 'HUMAN',
    });
    expect(regC.status).toBe(201);
    const tokenC = regC.body.token as string;
    const userC = regC.body.user.id as string;

    const regD = await request(app).post('/api/auth/register').send({
      username: usernameD,
      email: `${usernameD}@test.example.com`,
      password: 'Password123',
      displayName: '409 Rollback D',
      userType: 'HUMAN',
    });
    expect(regD.status).toBe(201);
    const tokenD = regD.body.token as string;
    const userD = regD.body.user.id as string;

    const projectRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokenD}`)
      .send({ name: '409 Rollback Project' });
    expect(projectRes.status).toBe(201);
    const projectId = projectRes.body.id as string;

    const teamRes = await request(app)
      .post(`/api/projects/${projectId}/team`)
      .set('Authorization', `Bearer ${tokenD}`)
      .send({ userId: userC });
    expect(teamRes.status).toBe(200);

    // D creates the task (assigned to D) then reassigns it to C -- D's own
    // row, "other user's row naming this user's id" case.
    const taskRes = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${tokenD}`)
      .send({ title: '409 Rollback Task', assignedTo: userD });
    expect(taskRes.status).toBe(201);
    const taskId = taskRes.body.id as string;

    const reassignRes = await request(app)
      .patch(`/api/projects/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenD}`)
      .send({ assignedTo: userC });
    expect(reassignRes.status).toBe(200);

    // C, now the assignee, edits the title -- C's own row, "own row" case.
    const editRes = await request(app)
      .patch(`/api/projects/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenC}`)
      .send({ title: '409 Rollback Task (C edit)' });
    expect(editRes.status).toBe(200);

    await flushPendingAuditWrites();

    const rowsBefore = await prisma.agentAuditLog.findMany({
      where: { resourceId: taskId },
      orderBy: { timestamp: 'asc' },
    });
    const rowDBefore = rowsBefore.find((r) => r.agentId === userD);
    const rowCBefore = rowsBefore.find((r) => r.agentId === userC);
    expect(rowDBefore).toBeDefined();
    expect(rowCBefore).toBeDefined();
    expect((rowDBefore!.details as unknown as Record<string, unknown>).assignedTo).toBe(userC);
    expect((rowCBefore!.details as unknown as Record<string, unknown>).title).toBe(
      '409 Rollback Task (C edit)',
    );

    const invite = await prisma.inviteCode.create({
      data: {
        code: `RB${Date.now().toString(36).toUpperCase()}`,
        createdById: userC,
        maxUses: 1,
      },
    });

    try {
      const delRes = await request(app)
        .delete('/api/auth/me')
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ password: 'Password123' });
      expect(delRes.status).toBe(409);
      expect(delRes.body.code).toBe('P2003');

      const userCStillPresent = await prisma.user.findUnique({ where: { id: userC } });
      expect(userCStillPresent).not.toBeNull();

      const rowCAfter = await prisma.agentAuditLog.findUnique({ where: { id: rowCBefore!.id } });
      expect(rowCAfter).not.toBeNull();
      expect(rowCAfter!.agentId).toBe(userC);
      expect((rowCAfter!.details as unknown as Record<string, unknown>).title).toBe(
        '409 Rollback Task (C edit)',
      );

      const rowDAfter = await prisma.agentAuditLog.findUnique({ where: { id: rowDBefore!.id } });
      expect(rowDAfter).not.toBeNull();
      expect((rowDAfter!.details as unknown as Record<string, unknown>).assignedTo).toBe(userC);
    } finally {
      await prisma.inviteCode.deleteMany({ where: { id: invite.id } });
    }
  });

  // Pins the reason DELETE /me's `$transaction` is called with a plain
  // array (batch form) rather than an interactive `(tx) => {...}` callback:
  // Prisma's interactive form applies a default (and, even when raised,
  // still finite) wall-clock timeout to the whole callback; the batch
  // array form's own generated type signature carries no `timeout` /
  // `maxWait` option at all (only `isolationLevel`), and its
  // implementation (`_transactionWithArray` in
  // @prisma/client/runtime/library.js) never reads or applies one. A
  // fast, deterministic stand-in for the reviewer's measured 1.5M-message
  // case (interactive form ~6.2s, past its default 5s cap): a 100ms
  // interactive timeout aborts a 200ms statement, the identical 200ms
  // statement run through the batch array form completes normally.
  it('demonstrates the batch $transaction([...]) form has no interactive-style timeout, unlike the callback form', async () => {
    // $executeRaw, not $queryRaw: pg_sleep()'s return type is `void`, which
    // Prisma's $queryRaw cannot deserialize into a row; $executeRaw only
    // reports an affected-row count and ignores the statement's own result
    // shape, so it is the right raw-query form for a side-effecting
    // statement like this one.
    await expect(
      prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_sleep(0.2)`;
        },
        { timeout: 100 },
      ),
    ).rejects.toThrow(/transaction|timeout|timed? out/i);

    const batchResult = await prisma.$transaction([
      prisma.$executeRaw`SELECT pg_sleep(0.2)`,
    ]);
    expect(batchResult).toHaveLength(1);
  }, 15000);
});
