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
 * (e.g. an attachment filename audited under the reading agent's id);
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
 *    now pinned by the invite_codes test below (see its own header comment):
 *    task eb405d43 closes the six remaining RESTRICT foreign keys named in
 *    Invariant 6's residual, so the real, unmocked RESTRICT-foreign-key
 *    failure this file used to force on `invite_codes.createdById` to prove
 *    array-level rollback no longer exists as a naturally-occurring
 *    condition (that closure is the point of eb405d43); the invite_codes
 *    test below instead proves the enlarged array's statements (scrub AND
 *    the new per-relation deletes/SetNulls) still commit together on
 *    success, and the mocked 409/500 test above still pins the catch
 *    block's classification for any future relation added without a rule.
 *    The dedicated lock test below remains a real, unmocked proof that the
 *    array runs as one live transaction against Postgres.
 *  - converting the route's `$transaction([...])` call from the batch
 *    array form to an interactive `$transaction(async (tx) => {...})`
 *    callback is pinned by the happy-path test's pass-through
 *    `jest.spyOn(prisma, '$transaction')` assertion that the call's first
 *    argument is an array.
 *  - removing ` FOR UPDATE` from the route's row-locking `$queryRaw` is
 *    pinned by the dedicated lock test below, which forces a real,
 *    uncommitted concurrent insert to hold a conflicting lock and proves
 *    `DELETE /me` blocks on it instead of racing past it.
 */
import { Writable } from 'stream';
import crypto from 'crypto';
import winston from 'winston';
import express from 'express';
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

// The shared `app` above was imported with jest.setup.js's
// `REGISTRATION_MODE=open` baked in at module-import time (routes/auth.ts
// resolves it once, from `process.env`, not per-request), which is why
// every other test in this file registers without an invite code at all:
// under `open`, POST /api/auth/register never even looks at `inviteCode`.
// Proving the multi-use invite deactivation below actually blocks a second
// registration therefore needs a SEPARATE app instance, built from a fresh,
// isolated load of `routes/auth.ts` with `REGISTRATION_MODE=invite` set
// just for that load (same technique as authRegistrationModes.test.ts's
// `loadApp`, but against the real, unmocked `prisma` client instead of a
// mock, since this is the DB-backed suite).
function loadInviteModeAuthApp(): express.Express {
  const previousMode = process.env.REGISTRATION_MODE;
  process.env.REGISTRATION_MODE = 'invite';
  let authRoutes: express.Router | undefined;
  jest.resetModules();
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- deferred load so REGISTRATION_MODE is read fresh for this module instance
    authRoutes = require('../routes/auth').authRoutes;
  });
  if (previousMode === undefined) {
    delete process.env.REGISTRATION_MODE;
  } else {
    process.env.REGISTRATION_MODE = previousMode;
  }
  const isolatedApp = express();
  isolatedApp.use(express.json());
  isolatedApp.use('/api/auth', authRoutes!);
  return isolatedApp;
}

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

    // Pass-through spy (no mock implementation, so the real call still
    // runs): pins that the route calls `$transaction` with a plain array
    // (the batch form), not an interactive `(tx) => {...}` callback.
    const transactionSpy = jest.spyOn(appPrisma, '$transaction');
    let delRes: request.Response;
    try {
      delRes = await request(app)
        .delete('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'Password123' });
    } finally {
      expect(transactionSpy).toHaveBeenCalled();
      expect(Array.isArray(transactionSpy.mock.calls[0][0])).toBe(true);
      transactionSpy.mockRestore();
    }

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
  // second, metadata-object argument is silently dropped from every actual
  // transport -- console and
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

  // Pins routes/projects.ts's `GET /:projectId/activity` null-safe agentId
  // handling (Invariant 6 in docs/okf/prisma-data-model-invariants.md): the
  // project owner reading activity after a team member self-deletes must
  // still get 200, with that member's row anonymised.
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

  // Task eb405d43: invite_codes.createdById was, until this
  // task, a real, unmocked RESTRICT foreign key -- a user who created ANY
  // invite code (even one nobody ever used) got a 409 from DELETE /me. This
  // test used to force exactly that 409 to prove the scrub statements roll
  // back atomically with a failing `user.delete`; now that this relation no
  // longer blocks (that closure IS this task's fix), it instead proves BOTH
  // per-relation rules together with the pre-existing audit-log scrub, all
  // committing atomically in the same `$transaction([...])` array:
  //  - an UNUSED invite code (usedById IS NULL) C created is deleted;
  //  - a USED invite code D created (redeemed by C) survives, with
  //    createdById nulled by the FK's `onDelete: SetNull` (migration
  //    20260923094230_self_delete_restrict_fks_invite_and_approval), not
  //    deleted -- it is the audit record of who registered whom.
  // C's and D's own agent_audit_log rows (this same file's pre-existing
  // scrub) are asserted unchanged/anonymised in the same request, so a
  // mutant that moves either the audit-log scrub OR the new invite_codes
  // statements out of the batch array (so they no longer commit atomically
  // with `user.delete`) cannot pass every assertion below by accident.
  //
  // Mutation-testability: reverting `usedById: null` to no filter (deleting
  // every invite C created, used or not) fails the "used invite survives"
  // assertion; reverting the schema's `onDelete: SetNull` back to the
  // default RESTRICT (or dropping the `deleteMany` for unused ones) makes
  // `delRes.status` 409 instead of 200, failing the very first assertion.
  it('deletes an unused invite code the user created, and SetNulls createdById on a used one, atomically with the pre-existing audit-log scrub (task eb405d43)', async () => {
    const usernameC = `${USERNAME_PREFIX}-inv-c`;
    const usernameD = `${USERNAME_PREFIX}-inv-d`;

    const regC = await request(app).post('/api/auth/register').send({
      username: usernameC,
      email: `${usernameC}@test.example.com`,
      password: 'Password123',
      displayName: 'Invite Test C',
      userType: 'HUMAN',
    });
    expect(regC.status).toBe(201);
    const tokenC = regC.body.token as string;
    const userC = regC.body.user.id as string;

    const regD = await request(app).post('/api/auth/register').send({
      username: usernameD,
      email: `${usernameD}@test.example.com`,
      password: 'Password123',
      displayName: 'Invite Test D',
      userType: 'HUMAN',
    });
    expect(regD.status).toBe(201);
    const tokenD = regD.body.token as string;
    const userD = regD.body.user.id as string;

    const projectRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${tokenD}`)
      .send({ name: 'Invite Test Project' });
    expect(projectRes.status).toBe(201);
    const projectId = projectRes.body.id as string;

    const teamRes = await request(app)
      .post(`/api/projects/${projectId}/team`)
      .set('Authorization', `Bearer ${tokenD}`)
      .send({ userId: userC });
    expect(teamRes.status).toBe(200);

    // D creates the task (assigned to D) then reassigns it to C -- D's own
    // row, "other user's row naming this user's id" case (pre-existing scrub).
    const taskRes = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${tokenD}`)
      .send({ title: 'Invite Test Task', assignedTo: userD });
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
      .send({ title: 'Invite Test Task (C edit)' });
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

    // C's own, still-unused invite code.
    const unusedInvite = await prisma.inviteCode.create({
      data: {
        code: `UN${Date.now().toString(36).toUpperCase()}`,
        createdById: userC,
        maxUses: 1,
      },
    });

    // D's invite code, already redeemed by C (usedById set): this is the
    // "used" sub-case, kept and SetNulled rather than deleted.
    const usedInvite = await prisma.inviteCode.create({
      data: {
        code: `US${Date.now().toString(36).toUpperCase()}`,
        createdById: userC,
        usedById: userD,
        usedAt: new Date(),
        useCount: 1,
      },
    });

    try {
      const delRes = await request(app)
        .delete('/api/auth/me')
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ password: 'Password123' });
      expect(delRes.status).toBe(200);

      const userCAfter = await prisma.user.findUnique({ where: { id: userC } });
      expect(userCAfter).toBeNull();

      const unusedAfter = await prisma.inviteCode.findUnique({ where: { id: unusedInvite.id } });
      expect(unusedAfter).toBeNull();

      const usedAfter = await prisma.inviteCode.findUnique({ where: { id: usedInvite.id } });
      expect(usedAfter).not.toBeNull();
      expect(usedAfter!.createdById).toBeNull();
      expect(usedAfter!.usedById).toBe(userD);

      // The pre-existing audit-log scrub still ran, atomically, alongside
      // the new invite_codes statements above.
      const rowCAfter = await prisma.agentAuditLog.findUnique({ where: { id: rowCBefore!.id } });
      expect(rowCAfter).not.toBeNull();
      expect(rowCAfter!.agentId).toBeNull();
      expect(rowCAfter!.details).toBeNull();

      const rowDAfter = await prisma.agentAuditLog.findUnique({ where: { id: rowDBefore!.id } });
      expect(rowDAfter).not.toBeNull();
      expect(rowDAfter!.agentId).toBe(userD);
      expect(rowDAfter!.details as unknown as Record<string, unknown>).not.toHaveProperty(
        'assignedTo',
      );
    } finally {
      await prisma.inviteCode.deleteMany({ where: { id: { in: [unusedInvite.id, usedInvite.id] } } });
    }
  });

  // Pins the route's `SELECT id FROM "users" WHERE id = ${userId} FOR
  // UPDATE` row lock, not just its presence in the source: a second,
  // independent client opens an interactive transaction that inserts an
  // agent_audit_log row referencing this user (agentId = userId) and holds
  // it open, uncommitted. Postgres's own foreign-key check takes a FOR KEY
  // SHARE lock on the referenced "users" row for the life of that open
  // transaction, which conflicts with the route's FOR UPDATE lock. With
  // that lock present, DELETE /me blocks on its very first statement,
  // before the `details` scrub runs; once the insert commits, the scrub
  // then sees the now-visible row and nulls its `details` too, so the row
  // ends up fully anonymised (agentId AND details both null). Without that
  // lock (the mutant this test targets), the scrub statement runs first,
  // before the insert is visible, so it never touches this row; only the
  // final `prisma.user.delete()` then blocks on the same underlying
  // Postgres lock (deleting the referenced row still has to wait for the
  // open FOR KEY SHARE lock), and once unblocked, the onDelete: SetNull FK
  // rule nulls the row's agentId, but nothing ever nulls its `details` --
  // so this test's `details` assertion below fails for that mutant even
  // though the delete still blocks and still returns 200.
  it("blocks DELETE /me on a real, uncommitted, still-open agent_audit_log insert for this user (FOR UPDATE), then fully anonymises that row's agentId AND details once the insert commits", async () => {
    const username = `${USERNAME_PREFIX}-lock`;

    const reg = await request(app).post('/api/auth/register').send({
      username,
      email: `${username}@test.example.com`,
      password: 'Password123',
      displayName: 'Lock Test',
      userType: 'HUMAN',
    });
    expect(reg.status).toBe(201);
    const token = reg.body.token as string;
    const userId = reg.body.user.id as string;

    const insertingClient = new PrismaClient();
    let createdRowId: string | undefined;
    let commitInsert!: () => void;
    let transactionDone!: Promise<unknown>;
    const insertHeld = new Promise<void>((resolveHeld) => {
      transactionDone = insertingClient.$transaction(
        async (tx) => {
          const row = await tx.agentAuditLog.create({
            data: {
              agentId: userId,
              action: 'race.insert',
              resourceType: 'test',
              details: { title: 'race-secret' },
            },
          });
          createdRowId = row.id;
          await new Promise<void>((resolveCommit) => {
            commitInsert = resolveCommit;
            resolveHeld();
          });
        },
        { timeout: 20000 },
      );
    });

    try {
      await insertHeld;

      // supertest/superagent only actually dispatches a request once its
      // `.then` is invoked (it otherwise defers `.end()` until awaited);
      // calling `.then` here, synchronously, fires it now instead of only
      // when the returned promise is later awaited, so it genuinely races
      // the still-open insert below instead of starting after it.
      const delPromise = request(app)
        .delete('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'Password123' })
        .then((res) => res);

      // Bounded poll (no fixed sleep) for a backend actually waiting on a
      // lock, driven by a third, independent client.
      const pollingClient = new PrismaClient();
      const deadline = Date.now() + 15000;
      let blocked = false;
      try {
        while (Date.now() < deadline) {
          const rows = await pollingClient.$queryRaw<{ count: number }[]>`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND datname = current_database()
          `;
          if (rows[0].count > 0) {
            blocked = true;
            break;
          }
          await new Promise((resolvePoll) => setTimeout(resolvePoll, 50));
        }
      } finally {
        await pollingClient.$disconnect();
      }
      if (!blocked) {
        commitInsert();
        await Promise.allSettled([delPromise, transactionDone]);
        throw new Error(
          'Timed out waiting for pg_stat_activity to show a backend blocked on a lock (wait_event_type=Lock) while the concurrent agent_audit_log insert for this user stayed open; DELETE /me never blocked on it.',
        );
      }

      commitInsert();
      const [delRes] = await Promise.all([delPromise, transactionDone]);

      expect(delRes.status).toBe(200);

      const rowAfter = await prisma.agentAuditLog.findUnique({ where: { id: createdRowId } });
      expect(rowAfter).not.toBeNull();
      expect(rowAfter!.agentId).toBeNull();
      expect(rowAfter!.details).toBeNull();
    } finally {
      await insertingClient.$disconnect();
    }
  }, 30000);

  // Round-2 fix item 3: a multi-use invite code (maxUses > 1) with
  // redemptions left survived its creator's self-delete fully live --
  // createdById nulled, but isActive still true and useCount still under
  // maxUses -- so it stayed redeemable by anyone who still had the code,
  // after the person accountable for having issued it was gone. The route
  // now deactivates any invite code with useCount > 0 (single- or
  // multi-use) in the same transaction, alongside the pre-existing
  // createdById SetNull.
  //
  // Mutation-testability: reverting the route's
  // `inviteCode.updateMany({ where: { useCount: { gt: 0 } }, data: {
  // isActive: false } })` to a no-op (or removing it from the array) leaves
  // `isActive` true, failing that assertion; the isolated invite-mode app's
  // second registration attempt would then succeed (201) instead of being
  // rejected (403).
  it('deactivates a multi-use invite code with redemptions left, so a second registration with it is rejected after the creator self-deletes', async () => {
    const usernameCreator = `${USERNAME_PREFIX}-inv-multi`;
    const regCreator = await request(app).post('/api/auth/register').send({
      username: usernameCreator,
      email: `${usernameCreator}@test.example.com`,
      password: 'Password123',
      displayName: 'Invite Multi Creator',
      userType: 'HUMAN',
    });
    expect(regCreator.status).toBe(201);
    const tokenCreator = regCreator.body.token as string;
    const userCreator = regCreator.body.user.id as string;

    const multiInvite = await prisma.inviteCode.create({
      data: {
        code: `MU${Date.now().toString(36).toUpperCase()}`,
        createdById: userCreator,
        maxUses: 5,
        useCount: 1,
        usedById: userCreator,
        usedAt: new Date(),
        isActive: true,
      },
    });

    try {
      const delRes = await request(app)
        .delete('/api/auth/me')
        .set('Authorization', `Bearer ${tokenCreator}`)
        .send({ password: 'Password123' });
      expect(delRes.status).toBe(200);

      const inviteAfter = await prisma.inviteCode.findUnique({ where: { id: multiInvite.id } });
      expect(inviteAfter).not.toBeNull();
      expect(inviteAfter!.createdById).toBeNull();
      expect(inviteAfter!.isActive).toBe(false);
      // Untouched by this fix: still records the one real redemption.
      expect(inviteAfter!.useCount).toBe(1);
      expect(inviteAfter!.maxUses).toBe(5);

      const inviteModeApp = loadInviteModeAuthApp();
      const secondRegUsername = `${USERNAME_PREFIX}-inv-multi-2nd`;
      const secondReg = await request(inviteModeApp).post('/api/auth/register').send({
        username: secondRegUsername,
        email: `${secondRegUsername}@test.example.com`,
        password: 'Password123',
        displayName: 'Second Registrant',
        userType: 'HUMAN',
        inviteCode: multiInvite.code,
      });
      expect(secondReg.status).toBe(403);
      expect(secondReg.body.error).toMatch(/invalid or already used/i);

      const secondUserAfter = await prisma.user.findUnique({
        where: { username: secondRegUsername },
      });
      expect(secondUserAfter).toBeNull();
    } finally {
      await prisma.inviteCode.deleteMany({ where: { id: multiInvite.id } });
    }
  });

  // Round-2 fix item 5: the earlier real, unmocked rollback proof (this
  // file's own header comment, and the invite_codes test above) forced a
  // naturally-occurring `invite_codes.createdById` RESTRICT failure; once
  // eb405d43 closed that relation, no naturally-occurring RESTRICT failure
  // was left to force `prisma.user.delete` to fail for real (every
  // mocked-error test above only proves the CATCH block's classification,
  // not that the underlying `$transaction([...])` array itself rolls back
  // atomically end to end). This test restores a real, unmocked forced
  // failure -- a throwaway table with its own RESTRICT foreign key to
  // `users(id)`, unrelated to any relation this route manages, dropped in
  // `finally` -- and checks that EVERY statement in the array, not just the
  // two audit-log scrub statements the older lock/scrub tests cover, is
  // still unchanged afterward.
  //
  // Mutation-testability: moving any one statement out of the
  // `$transaction([...])` array (for example running
  // `prisma.agentToken.deleteMany(...)` directly, before the array, instead
  // of as one of its elements) makes that statement commit independently of
  // the array's rollback below, failing its own "unchanged" assertion even
  // though `delRes.status` still comes back 409.
  it('rolls back every statement in the transaction array, not just the audit-log scrub, when prisma.user.delete fails on a real, unmocked constraint', async () => {
    const username = `${USERNAME_PREFIX}-rollback`;
    const reg = await request(app).post('/api/auth/register').send({
      username,
      email: `${username}@test.example.com`,
      password: 'Password123',
      displayName: 'Rollback Test',
      userType: 'HUMAN',
    });
    expect(reg.status).toBe(201);
    const token = reg.body.token as string;
    const userId = reg.body.user.id as string;

    const unusedInvite = await prisma.inviteCode.create({
      data: {
        code: `RB-UN${Date.now().toString(36).toUpperCase()}`,
        createdById: userId,
        maxUses: 1,
      },
    });
    const usedInvite = await prisma.inviteCode.create({
      data: {
        code: `RB-US${Date.now().toString(36).toUpperCase()}`,
        createdById: userId,
        usedById: userId,
        usedAt: new Date(),
        useCount: 1,
        maxUses: 5,
        isActive: true,
      },
    });
    const agentUser = await prisma.user.create({
      data: {
        username: `${USERNAME_PREFIX}-rollback-agent`,
        displayName: 'Rollback Test Agent',
        userType: 'AI_AGENT',
        isActive: true,
      },
    });
    const agentToken = await prisma.agentToken.create({
      data: {
        token: `byoa_${crypto.randomBytes(16).toString('hex')}`,
        name: 'Rollback Test Agent',
        mentionKey: `sdrb-agtok-${Date.now().toString(36)}`,
        userId: agentUser.id,
        createdById: userId,
        status: 'active',
        isActive: true,
      },
    });
    const integrationToken = await prisma.integrationToken.create({
      data: {
        provider: 'jira',
        scope: 'rollback-test',
        accessToken: 'encrypted-access-token',
        expiresAt: new Date(Date.now() + 3600_000),
        createdBy: userId,
      },
    });
    const connectorPermission = await prisma.connectorPermission.create({
      data: { connectorId: 'jira', userId, allowedActions: ['read'], grantedBy: userId },
    });
    const pendingApproval = await prisma.approvalRequest.create({
      data: { requestedBy: userId, connectorId: 'jira', actionId: 'create-issue', status: 'pending' },
    });

    // Unique per test run so a concurrently-running instance of this same
    // suite (a different worker, or a re-run against a shared database)
    // cannot collide on the table name.
    const throwawayTable = `rollback_probe_${crypto.randomBytes(6).toString('hex')}`;
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "${throwawayTable}" (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "users"("id")
      )
    `);
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${throwawayTable}" (id, "userId") VALUES ($1, $2)`,
        crypto.randomUUID(),
        userId,
      );

      const delRes = await request(app)
        .delete('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'Password123' });
      expect(delRes.status).toBe(409);
      expect(delRes.body.code).toBe('P2003');

      const userAfter = await prisma.user.findUnique({ where: { id: userId } });
      expect(userAfter).not.toBeNull();

      const unusedAfter = await prisma.inviteCode.findUnique({ where: { id: unusedInvite.id } });
      expect(unusedAfter).not.toBeNull();

      const usedAfter = await prisma.inviteCode.findUnique({ where: { id: usedInvite.id } });
      expect(usedAfter).not.toBeNull();
      expect(usedAfter!.createdById).toBe(userId);
      expect(usedAfter!.isActive).toBe(true);

      const agentTokenAfter = await prisma.agentToken.findUnique({ where: { id: agentToken.id } });
      expect(agentTokenAfter).not.toBeNull();

      const agentUserAfter = await prisma.user.findUnique({ where: { id: agentUser.id } });
      expect(agentUserAfter).not.toBeNull();
      expect(agentUserAfter!.isActive).toBe(true);

      const integrationTokenAfter = await prisma.integrationToken.findUnique({
        where: { id: integrationToken.id },
      });
      expect(integrationTokenAfter).not.toBeNull();

      const connectorPermissionAfter = await prisma.connectorPermission.findUnique({
        where: { id: connectorPermission.id },
      });
      expect(connectorPermissionAfter).not.toBeNull();

      const pendingApprovalAfter = await prisma.approvalRequest.findUnique({
        where: { id: pendingApproval.id },
      });
      expect(pendingApprovalAfter).not.toBeNull();
      expect(pendingApprovalAfter!.status).toBe('pending');

      const auditRowAfter = await prisma.agentAuditLog.findFirst({ where: { agentId: userId } });
      // No audit row was written for this user in this test; asserting the
      // scrub statements did not somehow run against unrelated rows either.
      expect(auditRowAfter).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${throwawayTable}"`);
      await prisma.approvalRequest.deleteMany({ where: { id: pendingApproval.id } });
      await prisma.connectorPermission.deleteMany({ where: { id: connectorPermission.id } });
      await prisma.integrationToken.deleteMany({ where: { id: integrationToken.id } });
      await prisma.agentToken.deleteMany({ where: { id: agentToken.id } });
      await prisma.user.deleteMany({ where: { id: agentUser.id } });
      await prisma.inviteCode.deleteMany({ where: { id: { in: [unusedInvite.id, usedInvite.id] } } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });
});
