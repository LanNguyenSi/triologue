/**
 * DB-backed test for the attachment filename backfill
 * (src/scripts/backfillAttachmentFilenames.ts). Skipped unless RUN_DB_TESTS=1
 * (or "true"), the same gating convention as reviewer-inbox.test.ts.
 *
 * Seeds one row with raw CR/LF in `filename` per attachment model
 * (messageAttachment, taskAttachment, projectAttachment) plus one clean
 * control row, then checks:
 *   1. `--dry-run` reports the affected count and writes nothing.
 *   2. The applied run rewrites exactly the dirty rows and leaves the clean
 *      row untouched.
 *   3. A second applied run finds and writes nothing (idempotence).
 *
 * Mutation intent:
 *   - Make the strip a no-op: the post-run rows still contain CR/LF and
 *     case 2 fails.
 *   - Make dry-run write anyway: case 1's "rows unchanged" assertions fail.
 *   - Break idempotence (select every row, or re-select clean rows): case 3's
 *     zero counts fail, and case 1's exact counts fail too.
 */
import { PrismaClient } from '@prisma/client';
import {
  backfillAttachmentFilenames,
  formatBackfillResult,
  hasControlChars,
} from '../scripts/backfillAttachmentFilenames';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

const USERNAME = 'attachment-filename-backfill-test-user';

const DIRTY_MESSAGE_NAME = 'notes\r\nX-Injected: 1.txt';
const DIRTY_TASK_NAME = 'spec\n\tdraft.md';
// DEL and ESC: Postgres rejects NUL (0x00) in text columns outright, so a
// stored filename can carry any control character except NUL.
const DIRTY_PROJECT_NAME = 'plan\x7f\x1bfinal.pdf';
const CLEAN_NAME = 'already clean "quoted".txt';

describe('hasControlChars', () => {
  it('matches CR, LF, TAB, NUL and DEL but not printable text or a double quote', () => {
    expect(hasControlChars('a\rb')).toBe(true);
    expect(hasControlChars('a\nb')).toBe(true);
    expect(hasControlChars('a\tb')).toBe(true);
    expect(hasControlChars('a\x00b')).toBe(true);
    expect(hasControlChars('a\x7fb')).toBe(true);
    expect(hasControlChars(CLEAN_NAME)).toBe(false);
  });
});

describeOrSkip('backfillAttachmentFilenames (DB-backed)', () => {
  let userId: string;
  let roomId: string;
  let messageId: string;
  let projectId: string;
  let taskId: string;
  let dirtyMessageAttachmentId: string;
  let cleanMessageAttachmentId: string;
  let dirtyTaskAttachmentId: string;
  let dirtyProjectAttachmentId: string;

  async function cleanup() {
    const stale = await prisma.user.findMany({
      where: { username: USERNAME },
      select: { id: true },
    });
    for (const user of stale) {
      const projects = await prisma.project.findMany({
        where: { ownerId: user.id },
        select: { id: true },
      });
      const projectIds = projects.map((p) => p.id);
      await prisma.taskAttachment.deleteMany({ where: { task: { projectId: { in: projectIds } } } });
      await prisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.projectAttachment.deleteMany({ where: { projectId: { in: projectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      await prisma.messageAttachment.deleteMany({ where: { message: { senderId: user.id } } });
      await prisma.message.deleteMany({ where: { senderId: user.id } });
      await prisma.room.deleteMany({ where: { name: `${USERNAME}-room` } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }

  beforeAll(async () => {
    await cleanup();

    const user = await prisma.user.create({
      data: {
        username: USERNAME,
        displayName: 'Attachment filename backfill test user',
        userType: 'HUMAN',
        passwordHash: 'not-a-real-hash',
      },
    });
    userId = user.id;

    const room = await prisma.room.create({
      data: { name: `${USERNAME}-room`, roomType: 'TRIOLOGUE', isPrivate: true },
    });
    roomId = room.id;

    const message = await prisma.message.create({
      data: { content: 'backfill test message', senderId: userId, roomId },
    });
    messageId = message.id;

    const dirtyMessageAttachment = await prisma.messageAttachment.create({
      data: {
        messageId,
        filename: DIRTY_MESSAGE_NAME,
        url: '/uploads/backfill-test-message-dirty.txt',
        mimeType: 'text/plain',
        type: 'DOCUMENT',
      },
    });
    dirtyMessageAttachmentId = dirtyMessageAttachment.id;

    const cleanMessageAttachment = await prisma.messageAttachment.create({
      data: {
        messageId,
        filename: CLEAN_NAME,
        url: '/uploads/backfill-test-message-clean.txt',
        mimeType: 'text/plain',
        type: 'DOCUMENT',
      },
    });
    cleanMessageAttachmentId = cleanMessageAttachment.id;

    const project = await prisma.project.create({
      data: { name: 'Attachment filename backfill test project', ownerId: userId },
    });
    projectId = project.id;

    const dirtyProjectAttachment = await prisma.projectAttachment.create({
      data: {
        projectId,
        filename: DIRTY_PROJECT_NAME,
        url: '/uploads/backfill-test-project-dirty.pdf',
        mimeType: 'application/pdf',
        type: 'DOCUMENT',
        uploadedBy: userId,
      },
    });
    dirtyProjectAttachmentId = dirtyProjectAttachment.id;

    const task = await prisma.task.create({
      data: {
        projectId,
        createdBy: userId,
        assignedTo: userId,
        title: 'Attachment filename backfill test task',
      },
    });
    taskId = task.id;

    const dirtyTaskAttachment = await prisma.taskAttachment.create({
      data: {
        taskId,
        filename: DIRTY_TASK_NAME,
        url: '/uploads/backfill-test-task-dirty.md',
        mimeType: 'text/markdown',
        type: 'DOCUMENT',
        uploadedBy: userId,
      },
    });
    dirtyTaskAttachmentId = dirtyTaskAttachment.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  async function readFilenames() {
    const [dirtyMessage, cleanMessage, dirtyTask, dirtyProject] = await Promise.all([
      prisma.messageAttachment.findUniqueOrThrow({ where: { id: dirtyMessageAttachmentId } }),
      prisma.messageAttachment.findUniqueOrThrow({ where: { id: cleanMessageAttachmentId } }),
      prisma.taskAttachment.findUniqueOrThrow({ where: { id: dirtyTaskAttachmentId } }),
      prisma.projectAttachment.findUniqueOrThrow({ where: { id: dirtyProjectAttachmentId } }),
    ]);
    return {
      dirtyMessage: dirtyMessage.filename,
      cleanMessage: cleanMessage.filename,
      dirtyTask: dirtyTask.filename,
      dirtyProject: dirtyProject.filename,
    };
  }

  it('dry-run reports one affected row per model and writes nothing', async () => {
    const result = await backfillAttachmentFilenames(prisma, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.models.messageAttachment).toEqual({ affected: 1, updated: 0 });
    expect(result.models.taskAttachment).toEqual({ affected: 1, updated: 0 });
    expect(result.models.projectAttachment).toEqual({ affected: 1, updated: 0 });
    expect(result.affected).toBe(3);
    expect(result.updated).toBe(0);

    const printed = formatBackfillResult(result);
    expect(printed).toContain('dry-run, nothing written');
    expect(printed).toContain('total: affected=3 updated=0');

    // The seeded rows must still carry their control characters.
    const names = await readFilenames();
    expect(names.dirtyMessage).toBe(DIRTY_MESSAGE_NAME);
    expect(names.dirtyTask).toBe(DIRTY_TASK_NAME);
    expect(names.dirtyProject).toBe(DIRTY_PROJECT_NAME);
    expect(names.cleanMessage).toBe(CLEAN_NAME);
  });

  it('applied run strips control characters from the seeded rows and leaves the clean row alone', async () => {
    const result = await backfillAttachmentFilenames(prisma, { dryRun: false });

    expect(result.dryRun).toBe(false);
    expect(result.models.messageAttachment).toEqual({ affected: 1, updated: 1 });
    expect(result.models.taskAttachment).toEqual({ affected: 1, updated: 1 });
    expect(result.models.projectAttachment).toEqual({ affected: 1, updated: 1 });
    expect(result.affected).toBe(3);
    expect(result.updated).toBe(3);

    const names = await readFilenames();
    expect(names.dirtyMessage).toBe('notesX-Injected: 1.txt');
    expect(names.dirtyTask).toBe('specdraft.md');
    expect(names.dirtyProject).toBe('planfinal.pdf');
    expect(names.cleanMessage).toBe(CLEAN_NAME);
    for (const name of Object.values(names)) {
      expect(hasControlChars(name)).toBe(false);
    }
  });

  it('is idempotent: a second applied run finds and writes nothing', async () => {
    const before = await readFilenames();

    const result = await backfillAttachmentFilenames(prisma, { dryRun: false });

    expect(result.affected).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.models.messageAttachment).toEqual({ affected: 0, updated: 0 });
    expect(result.models.taskAttachment).toEqual({ affected: 0, updated: 0 });
    expect(result.models.projectAttachment).toEqual({ affected: 0, updated: 0 });
    expect(await readFilenames()).toEqual(before);
  });
});
