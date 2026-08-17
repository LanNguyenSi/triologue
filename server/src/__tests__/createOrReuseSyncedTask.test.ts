/**
 * Regression test for createOrReuseSyncedTask (server/src/plugins/moduleRuntimeService.ts).
 *
 * Slice 4a of the server-lint epic fixed a latent crash: `task.create` was
 * called without the required FK column `Task.createdBy` (masked at the time
 * by a `(prisma as any)` cast), so every new-task path threw a
 * PrismaClientValidationError at runtime. The fix sets
 * `createdBy: params.assignedTo` (the function's only caller,
 * server/src/plugins/builtin/salesWorkbenchPlugin.ts, always passes
 * `assignedTo: req.user!.id`).
 *
 * This is a DB-backed integration test. It is skipped unless RUN_DB_TESTS=1
 * (or "true") is set in the environment, mirroring the gating convention used
 * by auth.test.ts and reviewer-inbox.test.ts.
 *
 * The DB-backed suites share one database (auth.test.ts does a blanket
 * `user.deleteMany()` in its beforeAll), so this suite must run with
 * --runInBand like the other DB suites, per the "Serial" comment at
 * ci.yml:120-122.
 *
 * Mutation-testability: removing `createdBy: params.assignedTo` from the
 * task.create data is caught by the TS compiler (required field in
 * TaskUncheckedCreateInput, see prisma/schema.prisma Task.createdBy) — no
 * test body ever runs against that mutant. The assertions here guard what
 * the compiler cannot see: createdBy carries the ACTING user's id (not the
 * project owner's), and a repeated syncKey creates no second Task row.
 */
import request from 'supertest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';
import { ensureModuleInstance, createModuleRun, createOrReuseSyncedTask } from '../plugins/moduleRuntimeService';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

// Unique, stable usernames scoped to this suite to avoid collisions with
// other DB-integration suites running against the same test database.
const OWNER_USERNAME = 'sync-task-test-owner';
const ASSIGNEE_USERNAME = 'sync-task-test-assignee';
const PLUGIN_ID = 'sync-task-test-plugin';
const MODULE_KEY = 'sync-task-test-module';

async function cleanupUserByUsername(username: string) {
  const staleUser = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });
  if (staleUser) {
    await prisma.agentAuditLog.deleteMany({ where: { agentId: staleUser.id } });
  }
  await prisma.user.deleteMany({ where: { username } });
}

describeOrSkip('createOrReuseSyncedTask (createdBy + reuse path)', () => {
  let ownerId: string;
  let assigneeId: string;
  let projectId: string;
  let roomId: string;
  let moduleRunId: string;

  const services = { prisma, io: null } as const;

  beforeAll(async () => {
    // Clean up any leftovers from a previous run.
    await cleanupUserByUsername(OWNER_USERNAME);
    await cleanupUserByUsername(ASSIGNEE_USERNAME);

    // Register the acting user (project owner / run starter). Kept distinct
    // from the assignee below so the createdBy assertions can tell "acting
    // user" apart from "project owner" instead of conflating the two.
    const ownerReg = await request(app)
      .post('/api/auth/register')
      .send({
        username: OWNER_USERNAME,
        email: `${OWNER_USERNAME}@test.example.com`,
        password: 'Password123',
        displayName: 'Sync Task Test Owner',
        userType: 'HUMAN',
      });
    expect(ownerReg.status).toBe(201);
    const ownerToken: string = ownerReg.body.token;
    ownerId = ownerReg.body.user.id;

    // Register a second user used as the task assignee/acting user in the
    // new-task test, so createdBy has a value distinct from ownerId.
    const assigneeReg = await request(app)
      .post('/api/auth/register')
      .send({
        username: ASSIGNEE_USERNAME,
        email: `${ASSIGNEE_USERNAME}@test.example.com`,
        password: 'Password123',
        displayName: 'Sync Task Test Assignee',
        userType: 'HUMAN',
      });
    expect(assigneeReg.status).toBe(201);
    assigneeId = assigneeReg.body.user.id;

    // Create a project — this also creates the linked room (roomId in the response).
    const projectRes = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Sync Task Test Project' });
    expect(projectRes.status).toBe(201);
    projectId = projectRes.body.id;
    roomId = projectRes.body.roomId;

    // Fixtures createOrReuseSyncedTask's caller (salesWorkbenchPlugin.ts)
    // always has in place: a PluginModuleInstance and a PluginModuleRun,
    // built via the same exported helpers the real call site uses.
    const instance = await ensureModuleInstance(services, {
      pluginId: PLUGIN_ID,
      moduleKey: MODULE_KEY,
      projectId,
      roomId,
      startedBy: ownerId,
    });
    const run = await createModuleRun(services, instance.id, {
      pluginId: PLUGIN_ID,
      moduleKey: MODULE_KEY,
      projectId,
      roomId,
      startedBy: ownerId,
    });
    moduleRunId = run.id;
  });

  afterAll(async () => {
    await cleanupUserByUsername(OWNER_USERNAME);
    await cleanupUserByUsername(ASSIGNEE_USERNAME);
    await prisma.$disconnect();
  });

  it('creates a new task with createdBy set to the acting user (not the project owner) on a fresh syncKey', async () => {
    const syncKey = `${PLUGIN_ID}:${MODULE_KEY}:new-task`;

    const result = await createOrReuseSyncedTask(services, {
      projectId,
      roomId,
      moduleRunId,
      syncKey,
      title: 'New synced task',
      description: 'Created by the regression test',
      assignedTo: assigneeId,
    });

    // Under the pre-fix code (no `createdBy` in task.create's data) this call
    // throws a PrismaClientValidationError before ever reaching this
    // assertion, because Task.createdBy is a required, FK-backed column.
    expect(result.reused).toBe(false);
    expect(result.task.createdBy).toBe(assigneeId);
    expect(result.task.createdBy).not.toBe(ownerId);
    expect(result.task.assignedTo).toBe(assigneeId);

    const persisted = await prisma.task.findUnique({ where: { id: result.task.id } });
    expect(persisted).not.toBeNull();
    expect(persisted?.createdBy).toBe(assigneeId);

    const sync = await prisma.pluginTaskSync.findUnique({
      where: { projectId_syncKey: { projectId, syncKey } },
    });
    expect(sync?.taskId).toBe(result.task.id);
  });

  it('reuses the existing task for the same projectId+syncKey without creating a second one', async () => {
    const syncKey = `${PLUGIN_ID}:${MODULE_KEY}:reuse-task`;

    const first = await createOrReuseSyncedTask(services, {
      projectId,
      roomId,
      moduleRunId,
      syncKey,
      title: 'Reuse-path task',
      description: 'First call',
      assignedTo: ownerId,
    });
    expect(first.reused).toBe(false);

    // Structural assertion: no second Task row is created on reuse. The
    // title-filtered query below is kept as a secondary check, but this
    // count is what actually proves nothing new was inserted.
    const countBeforeSecondCall = await prisma.task.count({ where: { projectId } });

    const second = await createOrReuseSyncedTask(services, {
      projectId,
      roomId,
      moduleRunId,
      syncKey,
      title: 'Reuse-path task (should be ignored)',
      description: 'Second call, same syncKey',
      assignedTo: ownerId,
    });

    expect(second.reused).toBe(true);
    expect(second.task.id).toBe(first.task.id);

    const countAfterSecondCall = await prisma.task.count({ where: { projectId } });
    expect(countAfterSecondCall).toBe(countBeforeSecondCall);

    const syncRows = await prisma.pluginTaskSync.findMany({
      where: { projectId, syncKey },
    });
    expect(syncRows).toHaveLength(1);

    const taskRows = await prisma.task.findMany({
      where: { projectId, title: { in: ['Reuse-path task', 'Reuse-path task (should be ignored)'] } },
    });
    expect(taskRows).toHaveLength(1);
    expect(taskRows[0].title).toBe('Reuse-path task');

    // usedMemoryIds merge branch (moduleRuntimeService.ts:271-283): a reuse
    // call carrying new memory ids updates the existing row in place — it
    // still must not create a second Task row.
    const third = await createOrReuseSyncedTask(services, {
      projectId,
      roomId,
      moduleRunId,
      syncKey,
      title: 'Reuse-path task (memory ids only)',
      assignedTo: ownerId,
      usedMemoryIds: ['mem-a'],
    });
    expect(third.reused).toBe(true);
    expect(third.task.id).toBe(first.task.id);
    expect(third.task.usedMemoryIds).toEqual(['mem-a']);

    // A second memory-id call merges with what's already stored and
    // de-duplicates: 'mem-a' repeats, only 'mem-b' is new.
    const fourth = await createOrReuseSyncedTask(services, {
      projectId,
      roomId,
      moduleRunId,
      syncKey,
      title: 'Reuse-path task (memory ids merged)',
      assignedTo: ownerId,
      usedMemoryIds: ['mem-b', 'mem-a'],
    });
    expect(fourth.reused).toBe(true);
    expect(fourth.task.id).toBe(first.task.id);
    expect(fourth.task.usedMemoryIds).toEqual(['mem-a', 'mem-b']);

    const countAfterMemoryIdCalls = await prisma.task.count({ where: { projectId } });
    expect(countAfterMemoryIdCalls).toBe(countBeforeSecondCall);
  });
});
