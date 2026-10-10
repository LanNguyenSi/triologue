/**
 * DB-backed tests (RUN_DB_TESTS=1) for the self-delete decisions that change
 * what other people see: the opt-in "also delete my messages" parameter of
 * DELETE /api/auth/me, project_secrets.createdBy in other owners' projects,
 * and the agent User rows the deleting user registered. The full statement
 * of what is removed, anonymised and kept lives in
 * docs/okf/self-delete-data-retention.md.
 *
 * Every test seeds a fixture for the deleting user (A) and a control row of
 * the same shape that belongs to somebody else, deletes A through the real
 * route, and asserts both. The all-or-nothing proof for the same statements
 * lives in the rollback test of auth-self-delete.test.ts.
 *
 * Mutation-testability (each probe changes routes/auth.ts and is killed by
 * the named test):
 *  - ignoring the opt-in flag, or defaulting it to true: the default-path
 *    test (content kept) and the opt-in test (content scrubbed);
 *  - dropping the message scrub, or one of its columns (content, aiContext,
 *    researchTag, isDeleted): the opt-in test;
 *  - dropping the message_attachments delete, or the URL read before it: the
 *    attachment and file assertions of the opt-in test;
 *  - accepting a non-boolean flag: the validation test;
 *  - dropping the project_secrets.createdBy statement: the secrets test;
 *  - dropping the agent displayName or username rename: the agent test.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import request from './helpers/loopbackRequest';
import { app } from '../index';
import { PrismaClient } from '@prisma/client';
import * as mentionLimiter from '../services/mentionLimiter';
import appPrisma from '../lib/prisma';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

const PREFIX = 'sdrd';
const PASSWORD = 'Password123';
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

interface Ctx {
  a: { id: string; token: string };
  b: { id: string };
  pb: { id: string };
  pa: { id: string };
  roomIds: string[];
  projectIds: string[];
  agentUserIds: string[];
  files: string[];
}

let ctx: Ctx;
let seq = 0;

function uniq(label: string) {
  seq += 1;
  return `${PREFIX}-${label}-${Date.now().toString(36)}-${seq}-${crypto.randomBytes(3).toString('hex')}`;
}

async function setup(): Promise<Ctx> {
  const username = uniq('a');
  const reg = await request(app).post('/api/auth/register').send({
    username,
    email: `${username}@test.example.com`,
    password: PASSWORD,
    displayName: 'RD A',
    userType: 'HUMAN',
  });
  expect(reg.status).toBe(201);
  const aId = reg.body.user.id as string;
  const b = await prisma.user.create({
    data: { username: uniq('b'), displayName: 'RD b', userType: 'HUMAN' },
  });
  const pa = await prisma.project.create({ data: { name: uniq('pa'), ownerId: aId } });
  const pb = await prisma.project.create({
    data: { name: uniq('pb'), ownerId: b.id, teamMemberIds: [aId] },
  });
  return {
    a: { id: aId, token: reg.body.token as string },
    b: { id: b.id },
    pa: { id: pa.id },
    pb: { id: pb.id },
    roomIds: [],
    projectIds: [pa.id, pb.id],
    agentUserIds: [],
    files: [],
  };
}

async function teardown(c: Ctx) {
  const userIds = [c.a.id, c.b.id];
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['agent tokens', () => prisma.agentToken.deleteMany({ where: { userId: { in: c.agentUserIds } } })],
    ['agent users', () => prisma.user.deleteMany({ where: { id: { in: c.agentUserIds } } })],
    ['audit rows', () => prisma.agentAuditLog.deleteMany({ where: { projectId: { in: c.projectIds } } })],
    ['projects', () => prisma.project.deleteMany({ where: { id: { in: c.projectIds } } })],
    ['rooms', () => prisma.room.deleteMany({ where: { id: { in: c.roomIds } } })],
    ['users', () => prisma.user.deleteMany({ where: { id: { in: userIds } } })],
  ];
  for (const [label, run] of steps) {
    try {
      await run();
    } catch (err) {
      console.error(`remaining-decisions test cleanup step failed (${label}):`, err);
    }
  }
  for (const file of c.files) fs.rmSync(file, { force: true });
}

function makeUploadFile(c: Ctx, label: string) {
  const filename = `${uniq(label)}.txt`;
  const full = path.join(UPLOAD_DIR, filename);
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(full, 'fixture');
  c.files.push(full);
  return { full, url: `/uploads/${filename}` };
}

async function deleteA(c: Ctx, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .delete('/api/auth/me')
    .set('Authorization', `Bearer ${c.a.token}`)
    .send({ password: PASSWORD, ...body });
  return res;
}

// A room with two messages from A (one rich, one plain) and one control
// message from B, each with an attachment backed by a real upload file.
async function seedMessages(c: Ctx) {
  const room = await prisma.room.create({ data: { name: uniq('room') } });
  c.roomIds.push(room.id);
  const fileA = makeUploadFile(c, 'msg-a');
  const fileB = makeUploadFile(c, 'msg-b');
  const rich = await prisma.message.create({
    data: {
      roomId: room.id,
      senderId: c.a.id,
      content: 'secret words of A',
      aiContext: { note: 'context naming A' },
      researchTag: 'tag-of-a',
      attachments: {
        create: { filename: 'a.txt', url: fileA.url, type: 'DOCUMENT' },
      },
    },
  });
  const plain = await prisma.message.create({
    data: { roomId: room.id, senderId: c.a.id, content: 'plain words of A' },
  });
  const control = await prisma.message.create({
    data: {
      roomId: room.id,
      senderId: c.b.id,
      content: 'words of B',
      aiContext: { note: 'context of B' },
      researchTag: 'tag-of-b',
      attachments: {
        create: { filename: 'b.txt', url: fileB.url, type: 'DOCUMENT' },
      },
    },
  });
  return { room, rich, plain, control, fileA, fileB };
}

describeOrSkip('DELETE /api/auth/me remaining operator decisions', () => {
  let limiterSpy: jest.SpyInstance;

  beforeEach(async () => {
    limiterSpy = jest.spyOn(mentionLimiter, 'removeMentionLimitEntry').mockResolvedValue(false);
    ctx = undefined as unknown as Ctx;
    ctx = await setup();
  });

  afterEach(async () => {
    limiterSpy.mockRestore();
    jest.restoreAllMocks();
    if (ctx) await teardown(ctx);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await appPrisma.$disconnect();
  });

  it('keeps message content, aiContext, researchTag and attachments with a null sender when the opt-in is absent or false', async () => {
    const f = await seedMessages(ctx);
    const res = await deleteA(ctx);
    expect(res.status).toBe(200);

    const rich = await prisma.message.findUnique({
      where: { id: f.rich.id },
      include: { attachments: true },
    });
    expect(rich!.senderId).toBeNull();
    expect(rich!.content).toBe('secret words of A');
    expect(rich!.aiContext).toEqual({ note: 'context naming A' });
    expect(rich!.researchTag).toBe('tag-of-a');
    expect(rich!.isDeleted).toBe(false);
    expect(rich!.attachments).toHaveLength(1);
    expect(fs.existsSync(f.fileA.full)).toBe(true);
  });

  it('treats an explicit deleteMessages: false like the default', async () => {
    const f = await seedMessages(ctx);
    const res = await deleteA(ctx, { deleteMessages: false });
    expect(res.status).toBe(200);

    const plain = await prisma.message.findUnique({ where: { id: f.plain.id } });
    expect(plain!.content).toBe('plain words of A');
    expect(plain!.isDeleted).toBe(false);
  });

  it('with deleteMessages: true empties and soft-deletes the messages, removes their attachment rows and unlinks the files, leaving other users untouched', async () => {
    const f = await seedMessages(ctx);
    const res = await deleteA(ctx, { deleteMessages: true });
    expect(res.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: ctx.a.id } })).toBeNull();

    for (const id of [f.rich.id, f.plain.id]) {
      const m = await prisma.message.findUnique({ where: { id }, include: { attachments: true } });
      expect(m).not.toBeNull();
      expect(m!.senderId).toBeNull();
      expect(m!.content).toBe('[deleted]');
      expect(m!.aiContext).toBeNull();
      expect(m!.researchTag).toBeNull();
      expect(m!.isDeleted).toBe(true);
      expect(m!.attachments).toHaveLength(0);
    }
    expect(await prisma.messageAttachment.count({ where: { messageId: f.rich.id } })).toBe(0);
    expect(fs.existsSync(f.fileA.full)).toBe(false);

    // Control: B's message, attachment row and file are unchanged.
    const control = await prisma.message.findUnique({
      where: { id: f.control.id },
      include: { attachments: true },
    });
    expect(control!.senderId).toBe(ctx.b.id);
    expect(control!.content).toBe('words of B');
    expect(control!.aiContext).toEqual({ note: 'context of B' });
    expect(control!.researchTag).toBe('tag-of-b');
    expect(control!.isDeleted).toBe(false);
    expect(control!.attachments).toHaveLength(1);
    expect(fs.existsSync(f.fileB.full)).toBe(true);
  });

  it('keeps an upload file that another surviving attachment row still references after an opted-in delete', async () => {
    const f = await seedMessages(ctx);
    // B's control message points at the same upload as A's attachment.
    await prisma.messageAttachment.create({
      data: { messageId: f.control.id, filename: 'shared.txt', url: f.fileA.url, type: 'DOCUMENT' },
    });
    const res = await deleteA(ctx, { deleteMessages: true });
    expect(res.status).toBe(200);
    expect(fs.existsSync(f.fileA.full)).toBe(true);
  });

  it.each([['"true"', 'true'], ['"false"', 'false'], ['1', 1], ['null', null], ['an object', {}]])(
    'rejects a non-boolean deleteMessages (%s) with 400 and changes nothing',
    async (_label, value) => {
      const f = await seedMessages(ctx);
      const res = await deleteA(ctx, { deleteMessages: value });
      expect(res.status).toBe(400);
      expect(await prisma.user.findUnique({ where: { id: ctx.a.id } })).not.toBeNull();
      const plain = await prisma.message.findUnique({ where: { id: f.plain.id } });
      expect(plain!.senderId).toBe(ctx.a.id);
      expect(plain!.content).toBe('plain words of A');
      expect(plain!.isDeleted).toBe(false);
    },
  );

  it('nulls project_secrets.createdBy in another owner project, drops the secret in the own project with it, and leaves a control secret alone', async () => {
    const inOther = await prisma.projectSecret.create({
      data: { projectId: ctx.pb.id, name: uniq('s-other'), encryptedValue: 'enc', createdBy: ctx.a.id },
    });
    const inOwn = await prisma.projectSecret.create({
      data: { projectId: ctx.pa.id, name: uniq('s-own'), encryptedValue: 'enc', createdBy: ctx.a.id },
    });
    const control = await prisma.projectSecret.create({
      data: { projectId: ctx.pb.id, name: uniq('s-ctl'), encryptedValue: 'enc', createdBy: ctx.b.id },
    });

    const res = await deleteA(ctx);
    expect(res.status).toBe(200);

    const otherAfter = await prisma.projectSecret.findUnique({ where: { id: inOther.id } });
    expect(otherAfter).not.toBeNull();
    expect(otherAfter!.createdBy).toBeNull();
    expect(await prisma.projectSecret.findUnique({ where: { id: inOwn.id } })).toBeNull();
    const controlAfter = await prisma.projectSecret.findUnique({ where: { id: control.id } });
    expect(controlAfter!.createdBy).toBe(ctx.b.id);
  });

  it('replaces displayName and username of the agent users the deleting user registered, keeps them deactivated, and leaves another registrar agent alone', async () => {
    const mkAgent = async (label: string, createdById: string) => {
      const user = await prisma.user.create({
        data: {
          username: uniq(`agent-${label}`),
          displayName: `Alice's bot ${label}`,
          userType: 'AI_AGENT',
          isActive: true,
        },
      });
      ctx.agentUserIds.push(user.id);
      await prisma.agentToken.create({
        data: {
          token: `byoa_${crypto.randomBytes(16).toString('hex')}`,
          name: `Alice's bot ${label}`,
          mentionKey: uniq(`mk-${label}`).toLowerCase(),
          userId: user.id,
          createdById,
          status: 'active',
          isActive: true,
        },
      });
      return user;
    };
    const mine = await mkAgent('mine', ctx.a.id);
    const other = await mkAgent('other', ctx.b.id);
    // A message by the agent in a room: the sender row must still resolve.
    const room = await prisma.room.create({ data: { name: uniq('room') } });
    ctx.roomIds.push(room.id);
    const agentMsg = await prisma.message.create({
      data: { roomId: room.id, senderId: mine.id, content: 'agent says hi' },
    });

    const res = await deleteA(ctx);
    expect(res.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: mine.id } });
    expect(after).not.toBeNull();
    expect(after!.isActive).toBe(false);
    expect(after!.displayName).toBe('Deleted agent');
    expect(after!.username).toBe(`agent-${mine.id}`);
    expect(after!.userType).toBe('AI_AGENT');
    const msg = await prisma.message.findUnique({ where: { id: agentMsg.id } });
    expect(msg!.senderId).toBe(mine.id);

    const otherAfter = await prisma.user.findUnique({ where: { id: other.id } });
    expect(otherAfter!.isActive).toBe(true);
    expect(otherAfter!.displayName).toBe("Alice's bot other");
    expect(otherAfter!.username).toBe(other.username);
  });
});
