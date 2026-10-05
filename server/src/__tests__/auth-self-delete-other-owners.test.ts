/**
 * DB-backed tests (RUN_DB_TESTS=1) for what DELETE /api/auth/me does to rows
 * that sit inside projects owned by OTHER people, and for the upload files of
 * the rows that go with the deleting user's OWN projects. The full statement
 * of what is removed, anonymised and kept lives in
 * docs/okf/self-delete-data-retention.md.
 *
 * Fixture layout: A is the deleting user, B owns the project PB that A is a
 * member of, C owns a second project PC (control), and A owns PA. For each of
 * the six creator-style relations (tasks.createdBy,
 * plugin_module_instances.createdBy, plugin_module_runs.startedBy,
 * project_plugin_links.linkedBy, project_attachments.uploadedBy,
 * agent_memory_entries.createdBy) A has one row in PB (must survive with the
 * column nulled) and one row in PA (must be gone with the project), and a
 * control row of the same shape created by C in PB is asserted unchanged.
 *
 * Mutation-testability (each probe removes or weakens one thing in
 * routes/auth.ts and is killed by the named test):
 *  - dropping the assignedTo reassignment, or its audit-row insert, or the
 *    `ownerId <> userId` project filter: the reassignment tests below;
 *  - dropping the own memory-entry deleteMany: the project-less memory entry
 *    test;
 *  - skipping the still-referenced check, or the URL pattern / basename
 *    guards of the file unlink: the file tests below;
 *  - reverting one of the six foreign keys to ON DELETE CASCADE (schema and
 *    migration): that relation's survival test.
 * The all-or-nothing proof for the new statements lives in the rollback test
 * of auth-self-delete.test.ts.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import * as mentionLimiter from '../services/mentionLimiter';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

const PREFIX = 'sdoo';
const PASSWORD = 'Password123';
// Same directory the upload routes and the route under test resolve.
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
// A directory one level above the uploads directory, used to prove that a
// `../` URL never reaches outside it.
const OUTSIDE_DIR = path.resolve(UPLOAD_DIR, '..');

interface Ctx {
  a: { id: string; token: string };
  b: { id: string; token: string };
  c: { id: string };
  pa: { id: string };
  pb: { id: string };
  pc: { id: string };
  roomIds: string[];
  projectIds: string[];
  files: string[];
  dirs: string[];
}

let ctx: Ctx;
let seq = 0;

function uniq(label: string) {
  seq += 1;
  return `${PREFIX}-${label}-${Date.now().toString(36)}-${seq}-${crypto.randomBytes(3).toString('hex')}`;
}

async function makeUser(label: string) {
  return prisma.user.create({
    data: { username: uniq(label), displayName: `OO ${label}`, userType: 'HUMAN' },
  });
}

async function makeRoom(c: Ctx) {
  const room = await prisma.room.create({ data: { name: uniq('room') } });
  c.roomIds.push(room.id);
  return room;
}

async function makeProject(c: Ctx, ownerId: string, teamMemberIds: string[] = []) {
  const row = await prisma.project.create({
    data: { name: uniq('proj'), ownerId, teamMemberIds },
  });
  c.projectIds.push(row.id);
  return row;
}

async function setup(): Promise<Ctx> {
  const username = uniq('a');
  const reg = await request(app).post('/api/auth/register').send({
    username,
    email: `${username}@test.example.com`,
    password: PASSWORD,
    displayName: 'OO A',
    userType: 'HUMAN',
  });
  expect(reg.status).toBe(201);
  const aId = reg.body.user.id as string;
  const bUsername = uniq('b');
  const regB = await request(app).post('/api/auth/register').send({
    username: bUsername,
    email: `${bUsername}@test.example.com`,
    password: PASSWORD,
    displayName: 'OO b',
    userType: 'HUMAN',
  });
  expect(regB.status).toBe(201);
  const b = { id: regB.body.user.id as string, token: regB.body.token as string };
  const c = await makeUser('c');
  const base: Ctx = {
    a: { id: aId, token: reg.body.token as string },
    b,
    c: { id: c.id },
    pa: { id: '' },
    pb: { id: '' },
    pc: { id: '' },
    roomIds: [],
    projectIds: [],
    files: [],
    dirs: [],
  };
  base.pa = await makeProject(base, aId);
  base.pb = await makeProject(base, b.id, [aId, c.id]);
  base.pc = await makeProject(base, c.id, [aId]);
  return base;
}

async function teardown(c: Ctx) {
  const userIds = [c.a.id, c.b.id, c.c.id];
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['audit rows', () => prisma.agentAuditLog.deleteMany({ where: { projectId: { in: c.projectIds } } })],
    ['memory entries', () => prisma.agentMemoryEntry.deleteMany({ where: { createdBy: { in: userIds } } })],
    ['projects', () => prisma.project.deleteMany({ where: { id: { in: c.projectIds } } })],
    ['rooms', () => prisma.room.deleteMany({ where: { id: { in: c.roomIds } } })],
    ['users', () => prisma.user.deleteMany({ where: { id: { in: userIds } } })],
  ];
  for (const [label, run] of steps) {
    try {
      await run();
    } catch (err) {
      console.error(`other-owners test cleanup step failed (${label}):`, err);
    }
  }
  for (const file of c.files) fs.rmSync(file, { force: true });
  for (const dir of c.dirs) fs.rmSync(dir, { recursive: true, force: true });
}

async function deleteA(c: Ctx) {
  const res = await request(app)
    .delete('/api/auth/me')
    .set('Authorization', `Bearer ${c.a.token}`)
    .send({ password: PASSWORD });
  expect(res.status).toBe(200);
  expect(await prisma.user.findUnique({ where: { id: c.a.id } })).toBeNull();
}

function makeUploadFile(c: Ctx, label: string) {
  const filename = `${uniq(label)}.txt`;
  const full = path.join(UPLOAD_DIR, filename);
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(full, 'fixture');
  c.files.push(full);
  return { filename, full, url: `/uploads/${filename}` };
}

describeOrSkip('DELETE /api/auth/me and other owners projects', () => {
  let limiterSpy: jest.SpyInstance;

  beforeEach(async () => {
    // The real data/mention-limits.json is not part of these tests.
    limiterSpy = jest.spyOn(mentionLimiter, 'removeMentionLimitEntry').mockResolvedValue(false);
    ctx = await setup();
  });

  afterEach(async () => {
    limiterSpy.mockRestore();
    jest.restoreAllMocks();
    await teardown(ctx);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps tasks A created in B\'s project (creator nulled), deletes tasks in A\'s own project, leaves C\'s tasks alone', async () => {
    const inB = await prisma.task.create({
      data: { projectId: ctx.pb.id, createdBy: ctx.a.id, assignedTo: ctx.b.id, title: 'A task in B' },
    });
    const inA = await prisma.task.create({
      data: { projectId: ctx.pa.id, createdBy: ctx.a.id, assignedTo: ctx.a.id, title: 'A task in A' },
    });
    // B's task inside A's own project: goes with the project.
    const bInA = await prisma.task.create({
      data: { projectId: ctx.pa.id, createdBy: ctx.b.id, assignedTo: ctx.b.id, title: 'B task in A' },
    });
    const control = await prisma.task.create({
      data: { projectId: ctx.pb.id, createdBy: ctx.c.id, assignedTo: ctx.b.id, title: 'C task in B' },
    });

    await deleteA(ctx);

    const survived = await prisma.task.findUnique({ where: { id: inB.id } });
    expect(survived).not.toBeNull();
    expect(survived!.createdBy).toBeNull();
    expect(survived!.title).toBe('A task in B');
    expect(survived!.assignedTo).toBe(ctx.b.id);
    expect(await prisma.task.findUnique({ where: { id: inA.id } })).toBeNull();
    expect(await prisma.task.findUnique({ where: { id: bInA.id } })).toBeNull();
    expect(await prisma.task.findUnique({ where: { id: control.id } })).toEqual(control);
  });

  it('keeps plugin module instances A created in B\'s project and the runs hanging off them, deletes those in A\'s project', async () => {
    const roomB = await makeRoom(ctx);
    const roomA = await makeRoom(ctx);
    const instInB = await prisma.pluginModuleInstance.create({
      data: { pluginId: 'p1', moduleKey: 'm', projectId: ctx.pb.id, roomId: roomB.id, createdBy: ctx.a.id },
    });
    const instInA = await prisma.pluginModuleInstance.create({
      data: { pluginId: 'p1', moduleKey: 'm', projectId: ctx.pa.id, roomId: roomA.id, createdBy: ctx.a.id },
    });
    const controlInst = await prisma.pluginModuleInstance.create({
      data: { pluginId: 'p2', moduleKey: 'm', projectId: ctx.pb.id, roomId: roomB.id, createdBy: ctx.c.id },
    });
    // A run started by C on A's instance in B's project: must survive with
    // the instance (the instance is no longer cascade-deleted with A).
    const runByCOnInstInB = await prisma.pluginModuleRun.create({
      data: { moduleInstanceId: instInB.id, pluginId: 'p1', moduleKey: 'm', projectId: ctx.pb.id, roomId: roomB.id, startedBy: ctx.c.id },
    });

    await deleteA(ctx);

    const survived = await prisma.pluginModuleInstance.findUnique({ where: { id: instInB.id } });
    expect(survived).not.toBeNull();
    expect(survived!.createdBy).toBeNull();
    expect(await prisma.pluginModuleRun.findUnique({ where: { id: runByCOnInstInB.id } })).toEqual(runByCOnInstInB);
    expect(await prisma.pluginModuleInstance.findUnique({ where: { id: instInA.id } })).toBeNull();
    expect(await prisma.pluginModuleInstance.findUnique({ where: { id: controlInst.id } })).toEqual(controlInst);
  });

  it('keeps plugin module runs A started in B\'s project (startedBy nulled), deletes those in A\'s project', async () => {
    const roomB = await makeRoom(ctx);
    const roomA = await makeRoom(ctx);
    const instInB = await prisma.pluginModuleInstance.create({
      data: { pluginId: 'p1', moduleKey: 'm', projectId: ctx.pb.id, roomId: roomB.id, createdBy: ctx.b.id },
    });
    const instInA = await prisma.pluginModuleInstance.create({
      data: { pluginId: 'p1', moduleKey: 'm', projectId: ctx.pa.id, roomId: roomA.id, createdBy: ctx.b.id },
    });
    const runInB = await prisma.pluginModuleRun.create({
      data: { moduleInstanceId: instInB.id, pluginId: 'p1', moduleKey: 'm', projectId: ctx.pb.id, roomId: roomB.id, startedBy: ctx.a.id },
    });
    const runInA = await prisma.pluginModuleRun.create({
      data: { moduleInstanceId: instInA.id, pluginId: 'p1', moduleKey: 'm', projectId: ctx.pa.id, roomId: roomA.id, startedBy: ctx.a.id },
    });
    const controlRun = await prisma.pluginModuleRun.create({
      data: { moduleInstanceId: instInB.id, pluginId: 'p1', moduleKey: 'm', projectId: ctx.pb.id, roomId: roomB.id, startedBy: ctx.c.id },
    });

    await deleteA(ctx);

    const survived = await prisma.pluginModuleRun.findUnique({ where: { id: runInB.id } });
    expect(survived).not.toBeNull();
    expect(survived!.startedBy).toBeNull();
    expect(await prisma.pluginModuleRun.findUnique({ where: { id: runInA.id } })).toBeNull();
    expect(await prisma.pluginModuleRun.findUnique({ where: { id: controlRun.id } })).toEqual(controlRun);
  });

  it('keeps project plugin links A made in B\'s project (linkedBy nulled), deletes those in A\'s project', async () => {
    const linkInB = await prisma.projectPluginLink.create({
      data: { projectId: ctx.pb.id, pluginId: 'link-a', linkedBy: ctx.a.id },
    });
    const linkInA = await prisma.projectPluginLink.create({
      data: { projectId: ctx.pa.id, pluginId: 'link-a', linkedBy: ctx.a.id },
    });
    const control = await prisma.projectPluginLink.create({
      data: { projectId: ctx.pb.id, pluginId: 'link-c', linkedBy: ctx.c.id },
    });

    await deleteA(ctx);

    const survived = await prisma.projectPluginLink.findUnique({ where: { id: linkInB.id } });
    expect(survived).not.toBeNull();
    expect(survived!.linkedBy).toBeNull();
    expect(await prisma.projectPluginLink.findUnique({ where: { id: linkInA.id } })).toBeNull();
    expect(await prisma.projectPluginLink.findUnique({ where: { id: control.id } })).toEqual(control);
  });

  it('keeps project attachments A uploaded into B\'s project (uploadedBy nulled), deletes those in A\'s project', async () => {
    const attInB = await prisma.projectAttachment.create({
      data: { projectId: ctx.pb.id, filename: 'b.txt', url: '/uploads/none-b', type: 'DOCUMENT', uploadedBy: ctx.a.id },
    });
    const attInA = await prisma.projectAttachment.create({
      data: { projectId: ctx.pa.id, filename: 'a.txt', url: '/uploads/none-a', type: 'DOCUMENT', uploadedBy: ctx.a.id },
    });
    const control = await prisma.projectAttachment.create({
      data: { projectId: ctx.pb.id, filename: 'c.txt', url: '/uploads/none-c', type: 'DOCUMENT', uploadedBy: ctx.c.id },
    });

    await deleteA(ctx);

    const survived = await prisma.projectAttachment.findUnique({ where: { id: attInB.id } });
    expect(survived).not.toBeNull();
    expect(survived!.uploadedBy).toBeNull();
    expect(survived!.filename).toBe('b.txt');
    expect(await prisma.projectAttachment.findUnique({ where: { id: attInA.id } })).toBeNull();
    expect(await prisma.projectAttachment.findUnique({ where: { id: control.id } })).toEqual(control);
  });

  it('keeps agent memory entries A created in B\'s project (createdBy nulled), deletes A\'s own: in A\'s project and without any project', async () => {
    const base = { pluginId: 'p', memoryType: 'NOTE', scope: 'PROJECT' };
    const inB = await prisma.agentMemoryEntry.create({
      data: { ...base, projectId: ctx.pb.id, createdBy: ctx.a.id, title: 'A in B' },
    });
    const inA = await prisma.agentMemoryEntry.create({
      data: { ...base, projectId: ctx.pa.id, createdBy: ctx.a.id, title: 'A in A' },
    });
    const noProject = await prisma.agentMemoryEntry.create({
      data: { ...base, scope: 'GLOBAL', projectId: null, createdBy: ctx.a.id, title: 'A no project' },
    });
    // C's entry in A's own project goes with the project; B's entry without
    // a project is not A's data and must stay.
    const cInA = await prisma.agentMemoryEntry.create({
      data: { ...base, projectId: ctx.pa.id, createdBy: ctx.c.id, title: 'C in A' },
    });
    const controlNoProject = await prisma.agentMemoryEntry.create({
      data: { ...base, scope: 'GLOBAL', projectId: null, createdBy: ctx.b.id, title: 'B no project' },
    });
    const controlInB = await prisma.agentMemoryEntry.create({
      data: { ...base, projectId: ctx.pb.id, createdBy: ctx.c.id, title: 'C in B' },
    });

    await deleteA(ctx);

    const survived = await prisma.agentMemoryEntry.findUnique({ where: { id: inB.id } });
    expect(survived).not.toBeNull();
    expect(survived!.createdBy).toBeNull();
    expect(survived!.title).toBe('A in B');
    expect(await prisma.agentMemoryEntry.findUnique({ where: { id: inA.id } })).toBeNull();
    expect(await prisma.agentMemoryEntry.findUnique({ where: { id: noProject.id } })).toBeNull();
    expect(await prisma.agentMemoryEntry.findUnique({ where: { id: cInA.id } })).toBeNull();
    expect(await prisma.agentMemoryEntry.findUnique({ where: { id: controlNoProject.id } })).toEqual(controlNoProject);
    expect(await prisma.agentMemoryEntry.findUnique({ where: { id: controlInB.id } })).toEqual(controlInB);
  });

  it('serves a memory entry whose creator deleted their account with createdBy null, and the project owner can still edit it', async () => {
    const entry = await prisma.agentMemoryEntry.create({
      data: { pluginId: 'p', memoryType: 'NOTE', scope: 'PROJECT', projectId: ctx.pb.id, createdBy: ctx.a.id, title: 'orphaned' },
    });

    await deleteA(ctx);

    const detail = await request(app)
      .get(`/api/memory/${entry.id}`)
      .set('Authorization', `Bearer ${ctx.b.token}`);
    expect(detail.status).toBe(200);
    const body = detail.body.entry ?? detail.body;
    expect(body.title).toBe('orphaned');
    expect(body.createdBy).toBeNull();
    expect(body.editable).toBe(true);

    const list = await request(app)
      .get(`/api/memory?projectId=${ctx.pb.id}`)
      .set('Authorization', `Bearer ${ctx.b.token}`);
    expect(list.status).toBe(200);
    const item = (list.body.items as Array<{ id: string; createdBy: unknown }>).find((i) => i.id === entry.id);
    expect(item).toBeDefined();
    expect(item!.createdBy).toBeNull();
  });

  it('reassigns tasks assigned to A in other owners\' projects to the project owner with exactly one audit row each, and leaves everything else alone', async () => {
    const inB1 = await prisma.task.create({
      data: { projectId: ctx.pb.id, createdBy: ctx.a.id, assignedTo: ctx.a.id, title: 'assigned A in B 1' },
    });
    // Created by someone else, assigned to A in C's project: goes to C.
    const inC = await prisma.task.create({
      data: { projectId: ctx.pc.id, createdBy: ctx.b.id, assignedTo: ctx.a.id, title: 'assigned A in C' },
    });
    // Assigned to A inside A's own project: deleted with the project, never
    // reassigned and never audited.
    const inA = await prisma.task.create({
      data: { projectId: ctx.pa.id, createdBy: ctx.b.id, assignedTo: ctx.a.id, title: 'assigned A in A' },
    });
    // Not A's: unchanged, no audit row.
    const controlB = await prisma.task.create({
      data: { projectId: ctx.pb.id, createdBy: ctx.c.id, assignedTo: ctx.b.id, title: 'assigned B in B' },
    });
    const controlC = await prisma.task.create({
      data: { projectId: ctx.pb.id, createdBy: ctx.b.id, assignedTo: ctx.c.id, title: 'assigned C in B' },
    });

    await deleteA(ctx);

    const afterB1 = await prisma.task.findUnique({ where: { id: inB1.id } });
    expect(afterB1!.assignedTo).toBe(ctx.b.id);
    expect(afterB1!.createdBy).toBeNull();
    expect(afterB1!.updatedAt.getTime()).toBeGreaterThanOrEqual(inB1.updatedAt.getTime());
    const afterC = await prisma.task.findUnique({ where: { id: inC.id } });
    expect(afterC!.assignedTo).toBe(ctx.c.id);
    expect(afterC!.createdBy).toBe(ctx.b.id);
    expect(await prisma.task.findUnique({ where: { id: inA.id } })).toBeNull();
    expect(await prisma.task.findUnique({ where: { id: controlB.id } })).toEqual(controlB);
    expect(await prisma.task.findUnique({ where: { id: controlC.id } })).toEqual(controlC);

    const rows = await prisma.agentAuditLog.findMany({
      where: { projectId: { in: [ctx.pa.id, ctx.pb.id, ctx.pc.id] } },
      orderBy: { resourceId: 'asc' },
    });
    const reassignRows = rows.filter((r) => r.action === 'task.assignee_reassigned');
    expect(reassignRows).toHaveLength(2);
    const byTask = new Map(reassignRows.map((r) => [r.resourceId, r]));
    const rowB1 = byTask.get(inB1.id)!;
    expect(rowB1.agentId).toBeNull();
    expect(rowB1.resourceType).toBe('task');
    expect(rowB1.projectId).toBe(ctx.pb.id);
    expect(rowB1.details).toEqual({ reason: 'assignee_account_deleted', assignedTo: ctx.b.id });
    expect(rowB1.success).toBe(true);
    const rowC = byTask.get(inC.id)!;
    expect(rowC.agentId).toBeNull();
    expect(rowC.projectId).toBe(ctx.pc.id);
    expect(rowC.details).toEqual({ reason: 'assignee_account_deleted', assignedTo: ctx.c.id });
    // Nothing written for the own-project task or the controls, and the
    // deleted user's id appears in none of the rows.
    expect(rows.filter((r) => r.resourceId === inA.id)).toHaveLength(0);
    expect(rows.filter((r) => r.resourceId === controlB.id || r.resourceId === controlC.id)).toHaveLength(0);
    expect(JSON.stringify(rows)).not.toContain(ctx.a.id);
  });

  it('unlinks the upload files of attachments deleted with A\'s own projects, keeps files still referenced by a surviving row, and never touches a ../ URL', async () => {
    const own = makeUploadFile(ctx, 'own');
    const ownTask = makeUploadFile(ctx, 'owntask');
    const sharedWithB = makeUploadFile(ctx, 'sharedb');
    const sharedWithTask = makeUploadFile(ctx, 'sharedtask');
    const sharedWithMessage = makeUploadFile(ctx, 'sharedmsg');
    const uploadedIntoB = makeUploadFile(ctx, 'intob');

    // A file one directory above uploads/ that a traversal URL points at.
    const outsideName = `${uniq('outside')}.txt`;
    const outside = path.join(OUTSIDE_DIR, outsideName);
    fs.writeFileSync(outside, 'must stay');
    ctx.files.push(outside);
    // A nested file: the single-segment pattern must reject its URL.
    const nestedDir = path.join(UPLOAD_DIR, uniq('nested'));
    fs.mkdirSync(nestedDir);
    ctx.dirs.push(nestedDir);
    const nestedFile = path.join(nestedDir, 'inner.txt');
    fs.writeFileSync(nestedFile, 'must stay');

    const task = await prisma.task.create({
      data: { projectId: ctx.pa.id, createdBy: ctx.b.id, assignedTo: ctx.b.id, title: 'own project task' },
    });
    const mk = (url: string, projectId = ctx.pa.id) =>
      prisma.projectAttachment.create({
        data: { projectId, filename: 'f', url, type: 'DOCUMENT', uploadedBy: ctx.a.id },
      });
    await mk(own.url);
    await prisma.taskAttachment.create({
      data: { taskId: task.id, filename: 'f', url: ownTask.url, type: 'DOCUMENT', uploadedBy: ctx.b.id },
    });
    // Same file also referenced by a row that survives (in B's project, in a
    // task of B's project, and by a chat message attachment).
    await mk(sharedWithB.url);
    await mk(sharedWithB.url, ctx.pb.id);
    await mk(sharedWithTask.url);
    const taskInB = await prisma.task.create({
      data: { projectId: ctx.pb.id, createdBy: ctx.b.id, assignedTo: ctx.b.id, title: 'B task' },
    });
    await prisma.taskAttachment.create({
      data: { taskId: taskInB.id, filename: 'f', url: sharedWithTask.url, type: 'DOCUMENT', uploadedBy: ctx.b.id },
    });
    await mk(sharedWithMessage.url);
    const room = await makeRoom(ctx);
    const message = await prisma.message.create({ data: { content: 'x', roomId: room.id, senderId: ctx.b.id } });
    await prisma.messageAttachment.create({
      data: { messageId: message.id, filename: 'f', url: sharedWithMessage.url, type: 'DOCUMENT' },
    });
    // An attachment A uploaded into B's project: the row stays, so does the file.
    await mk(uploadedIntoB.url, ctx.pb.id);
    // Traversal and shape guards.
    await mk(`/uploads/../${outsideName}`);
    await mk(`/uploads/${path.basename(nestedDir)}/inner.txt`);
    await mk('/uploads/..');
    await mk(`/uploads/${outsideName}`);

    await deleteA(ctx);

    expect(fs.existsSync(own.full)).toBe(false);
    expect(fs.existsSync(ownTask.full)).toBe(false);
    expect(fs.existsSync(sharedWithB.full)).toBe(true);
    expect(fs.existsSync(sharedWithTask.full)).toBe(true);
    expect(fs.existsSync(sharedWithMessage.full)).toBe(true);
    expect(fs.existsSync(uploadedIntoB.full)).toBe(true);
    expect(fs.existsSync(outside)).toBe(true);
    expect(fs.existsSync(nestedFile)).toBe(true);
    expect(fs.existsSync(UPLOAD_DIR)).toBe(true);
  });

  it('never fails the request when a file cannot be unlinked, and still removes the other files', async () => {
    const warn = jest.spyOn(logger, 'warn');
    // A directory under a name an attachment points at: unlink fails with
    // EISDIR/EPERM. A missing file is silently skipped.
    const dirName = uniq('dirasfile');
    const dirPath = path.join(UPLOAD_DIR, dirName);
    fs.mkdirSync(dirPath, { recursive: true });
    ctx.dirs.push(dirPath);
    const real = makeUploadFile(ctx, 'real');
    const mk = (url: string) =>
      prisma.projectAttachment.create({
        data: { projectId: ctx.pa.id, filename: 'f', url, type: 'DOCUMENT', uploadedBy: ctx.a.id },
      });
    await mk(`/uploads/${dirName}`);
    await mk('/uploads/never-existed.txt');
    await mk(real.url);

    await deleteA(ctx);

    expect(fs.existsSync(real.full)).toBe(false);
    expect(fs.existsSync(dirPath)).toBe(true);
    expect(
      warn.mock.calls.some(([msg]) => String(msg).includes('upload file could not be removed')),
    ).toBe(true);
  });
});
