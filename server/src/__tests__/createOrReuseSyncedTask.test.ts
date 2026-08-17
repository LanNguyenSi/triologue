/**
 * Regression test for createOrReuseSyncedTask (server/src/plugins/moduleRuntimeService.ts).
 *
 * Slice 4a of the server-lint epic fixed a latent crash: `task.create` was
 * called without the required FK column `Task.createdBy` (masked at the time
 * by a `(prisma as any)` cast), so every new-task path threw a
 * PrismaClientValidationError at runtime. The fix sets
 * `createdBy: params.assignedTo` (the function's only caller,
 * salesWorkbenchPlugin.ts, always passes `assignedTo: req.user!.id`).
 *
 * This is a DB-backed integration test. It is skipped unless RUN_DB_TESTS=1
 * (or "true") is set in the environment, mirroring the gating convention used
 * by auth.test.ts and reviewer-inbox.test.ts.
 *
 * Mutation-testability: removing `createdBy: params.assignedTo` from the
 * task.create data reproduces the original crash — Prisma rejects the
 * missing required column and the "new task" test throws instead of
 * asserting. See the mutation probe transcript captured in this task's
 * implementation report; the fix line was restored immediately afterwards.
 */
import request from 'supertest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';
import { ensureModuleInstance, createModuleRun, createOrReuseSyncedTask } from '../plugins/moduleRuntimeService';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

// Unique, stable username scoped to this suite to avoid collisions with
// other DB-integration suites running against the same test database.
const OWNER_USERNAME = 'sync-task-test-owner';
const PLUGIN_ID = 'sync-task-test-plugin';
const MODULE_KEY = 'sync-task-test-module';

describeOrSkip('createOrReuseSyncedTask (createdBy + reuse path)', () => {
  let ownerId: string;
  let projectId: string;
  let roomId: string;
  let moduleRunId: string;

  const services = { prisma, io: null } as const;

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

    // Register the acting user (project owner / task creator / assignee).
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

  it('creates a new task with createdBy set to the acting user on a fresh syncKey', async () => {
    const syncKey = `${PLUGIN_ID}:${MODULE_KEY}:new-task`;

    const result = await createOrReuseSyncedTask(services, {
      projectId,
      roomId,
      moduleRunId,
      syncKey,
      title: 'New synced task',
      description: 'Created by the regression test',
      assignedTo: ownerId,
    });

    // Under the pre-fix code (no `createdBy` in task.create's data) this call
    // throws a PrismaClientValidationError before ever reaching this
    // assertion, because Task.createdBy is a required, FK-backed column.
    expect(result.reused).toBe(false);
    expect(result.task.createdBy).toBe(ownerId);
    expect(result.task.assignedTo).toBe(ownerId);

    const persisted = await prisma.task.findUnique({ where: { id: result.task.id } });
    expect(persisted).not.toBeNull();
    expect(persisted?.createdBy).toBe(ownerId);

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

    const syncRows = await prisma.pluginTaskSync.findMany({
      where: { projectId, syncKey },
    });
    expect(syncRows).toHaveLength(1);

    const taskRows = await prisma.task.findMany({
      where: { projectId, title: { in: ['Reuse-path task', 'Reuse-path task (should be ignored)'] } },
    });
    expect(taskRows).toHaveLength(1);
    expect(taskRows[0].title).toBe('Reuse-path task');
  });
});
