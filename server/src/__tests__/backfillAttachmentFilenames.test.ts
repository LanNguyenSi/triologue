/**
 * Tests for the attachment filename backfill
 * (src/scripts/backfillAttachmentFilenames.ts).
 *
 * `hasControlChars` and `parseArgs` are pure and run unconditionally.
 * Everything else is DB-backed and skipped unless RUN_DB_TESTS=1 (or
 * "true"), the same gating convention as reviewer-inbox.test.ts.
 *
 * DB-backed coverage:
 *   1. `--dry-run` reports the affected count, writes nothing, and prints
 *      one `value=` line per affected row.
 *   2. The applied run rewrites exactly the dirty rows, leaves the clean
 *      row untouched, and prints one `before=`/`after=` line per row.
 *   3. A second applied run finds and writes nothing (idempotence).
 *   4. Cursor pagination: a table with more than one batch has every dirty
 *      row reported exactly once, no duplicates and none missing.
 *   5. A decision-measurement check for the CHANGELOG: how many
 *      inbox_items.message / messages.content rows shaped like the
 *      write paths that copy an attachment filename carry a control
 *      character. The fixtures are built through the real writers
 *      (`createInboxItems`, `buildReviewReadySummary`), not hand-written
 *      literals, so this test tracks those files instead of a copy of
 *      them that can drift; `buildReviewReadySummary`'s own describe
 *      block pins the unconditional-newline premise directly.
 *
 * Mutation intent:
 *   - Make the strip a no-op: the post-run rows still contain CR/LF and
 *     case 2 fails.
 *   - Make dry-run write anyway: case 1's "rows unchanged" assertions fail.
 *   - Break idempotence (select every row, or re-select clean rows): case 3's
 *     zero counts fail, and case 1's exact counts fail too.
 *   - Remove the per-row log line: cases 1, 2 and 4's log-line assertions
 *     fail.
 *   - Break the cursor advance (drop `skip: 1`, or stop after the first
 *     page): case 4 fails, either via duplicate/inflated log lines (missing
 *     `skip: 1`, caught because dry-run never self-heals a re-scanned row)
 *     or via a short affected count (stopping early).
 *   - Advance the cursor from the last DIRTY row of a page instead of the
 *     page's own last row: case 4's interleaved fixture (dirty, dirty,
 *     clean, dirty, dirty at batchSize 3) makes page 1 end on a clean row,
 *     so this never revisits an already-logged dirty row (none follows
 *     "the last dirty row" within the same page by definition) but does
 *     re-fetch the trailing clean row, caught by the findMany call-count
 *     assertion rather than by a duplicate log line.
 *   - Remove or weaken the `batchSize <= 0` guard: the dedicated guard
 *     tests fail (no `RangeError` thrown).
 */
import { PrismaClient } from '@prisma/client';
import {
  backfillAttachmentFilenames,
  formatBackfillResult,
  hasControlChars,
  parseArgs,
  UsageError,
  BATCH_SIZE,
} from '../scripts/backfillAttachmentFilenames';
import { createInboxItems } from '../services/inboxService';
import { buildReviewReadySummary } from '../services/resultRouterService';

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

describe('parseArgs', () => {
  it('accepts no flags (dryRun: false)', () => {
    expect(parseArgs([])).toEqual({ dryRun: false });
  });

  it('accepts --dry-run (dryRun: true)', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true });
  });

  it('rejects an unknown flag with a UsageError', () => {
    expect(() => parseArgs(['--force'])).toThrow(UsageError);
    try {
      parseArgs(['--force']);
      throw new Error('expected parseArgs to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(UsageError);
      expect((error as Error).message).toContain('--force');
    }
  });

  it('rejects --dry-run=true: exact match only, not a prefix match', () => {
    expect(() => parseArgs(['--dry-run=true'])).toThrow(UsageError);
  });
});

describe('buildReviewReadySummary (CHANGELOG decision premise)', () => {
  it('always embeds a newline before "Bearbeitet von:", independent of the attachment filename or any other field', () => {
    const bare = buildReviewReadySummary({ taskTitle: 'T', assigneeName: '@a' });
    const withReviewer = buildReviewReadySummary({
      taskTitle: 'T',
      assigneeName: '@a',
      reviewerName: '@r',
    });
    const withCleanAttachment = buildReviewReadySummary({
      taskTitle: 'T',
      assigneeName: '@a',
      attachmentLines: `${CLEAN_NAME} (1 B)`,
    });
    const withDirtyAttachment = buildReviewReadySummary({
      taskTitle: 'T',
      assigneeName: '@a',
      attachmentLines: `${DIRTY_TASK_NAME} (1 B)`,
    });

    // This is the premise the CHANGELOG decision to leave
    // `messages.content` uncleaned rests on: the structural newline before
    // "Bearbeitet von:" is unconditional, so the control-character
    // predicate that isolates a dirty filename copy elsewhere always
    // matches this line too, clean or dirty. If the template ever loses
    // this newline, this assertion fails first.
    for (const content of [bare, withReviewer, withCleanAttachment, withDirtyAttachment]) {
      expect(content).toContain('\nBearbeitet von:');
      expect(hasControlChars(content)).toBe(true);
    }
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
  let dirtyInboxItemId: string;
  let cleanInboxItemId: string;
  let dirtySystemMessageId: string;
  let cleanSystemMessageId: string;

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
      // inboxItem rows cascade on the recipient's user delete below; deleted
      // explicitly first so the message they may reference is free to go too.
      await prisma.inboxItem.deleteMany({ where: { recipientId: user.id } });
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

    // --- Decision-measurement fixtures ---------------------------------
    // Driven through the real write paths, not hand-written literals, so
    // this fixture tracks those files instead of a copy that can drift:
    // `createInboxItems` (inboxService.ts) is the same function
    // projects.ts:1801/:1997 call for the project/task attachment-removed
    // notices, and `buildReviewReadySummary` (resultRouterService.ts) is
    // the exact template `handleInReview` builds its `messages.content`
    // from. Both copy the attachment's filename at write time, so a dirty
    // filename persisted before the sanitiser landing produces a dirty
    // copy here too, one this script's attachment-row backfill does not
    // reach.
    const [dirtyInboxItem] = await createInboxItems({
      recipientIds: [userId],
      actorId: userId,
      type: 'project.attachment.removed',
      title: 'Project attachment removed',
      message: DIRTY_PROJECT_NAME,
    });
    dirtyInboxItemId = dirtyInboxItem.id;

    const [cleanInboxItem] = await createInboxItems({
      recipientIds: [userId],
      actorId: userId,
      type: 'project.attachment.removed',
      title: 'Project attachment removed',
      message: CLEAN_NAME,
    });
    cleanInboxItemId = cleanInboxItem.id;

    const dirtySystemMessage = await prisma.message.create({
      data: {
        content: buildReviewReadySummary({
          taskTitle: 'Attachment filename backfill test task',
          assigneeName: `@${USERNAME}`,
          attachmentLines: `${DIRTY_TASK_NAME} (12 B)`,
        }),
        senderId: userId,
        roomId,
        messageType: 'SYSTEM',
      },
    });
    dirtySystemMessageId = dirtySystemMessage.id;

    const cleanSystemMessage = await prisma.message.create({
      data: {
        content: buildReviewReadySummary({
          taskTitle: 'Attachment filename backfill test task',
          assigneeName: `@${USERNAME}`,
          attachmentLines: `${CLEAN_NAME} (12 B)`,
        }),
        senderId: userId,
        roomId,
        messageType: 'SYSTEM',
      },
    });
    cleanSystemMessageId = cleanSystemMessage.id;
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

  it('dry-run reports one affected row per model, writes nothing, and prints one value= line per row', async () => {
    const lines: string[] = [];
    const result = await backfillAttachmentFilenames(prisma, { dryRun: true, log: (line) => lines.push(line) });

    expect(result.dryRun).toBe(true);
    expect(result.models.messageAttachment).toEqual({ affected: 1, updated: 0 });
    expect(result.models.taskAttachment).toEqual({ affected: 1, updated: 0 });
    expect(result.models.projectAttachment).toEqual({ affected: 1, updated: 0 });
    expect(result.affected).toBe(3);
    expect(result.updated).toBe(0);

    const printed = formatBackfillResult(result);
    expect(printed).toContain('dry-run, nothing written');
    expect(printed).toContain('total: affected=3 updated=0');

    // One auditable line per affected row, with the offending value escaped.
    expect(lines).toEqual([
      `messageAttachment ${dirtyMessageAttachmentId} value=${JSON.stringify(DIRTY_MESSAGE_NAME)}`,
      `taskAttachment ${dirtyTaskAttachmentId} value=${JSON.stringify(DIRTY_TASK_NAME)}`,
      `projectAttachment ${dirtyProjectAttachmentId} value=${JSON.stringify(DIRTY_PROJECT_NAME)}`,
    ]);

    // The seeded rows must still carry their control characters.
    const names = await readFilenames();
    expect(names.dirtyMessage).toBe(DIRTY_MESSAGE_NAME);
    expect(names.dirtyTask).toBe(DIRTY_TASK_NAME);
    expect(names.dirtyProject).toBe(DIRTY_PROJECT_NAME);
    expect(names.cleanMessage).toBe(CLEAN_NAME);
  });

  it('applied run strips control characters from the seeded rows, leaves the clean row alone, and prints one before=/after= line per row', async () => {
    const lines: string[] = [];
    const result = await backfillAttachmentFilenames(prisma, { dryRun: false, log: (line) => lines.push(line) });

    expect(result.dryRun).toBe(false);
    expect(result.models.messageAttachment).toEqual({ affected: 1, updated: 1 });
    expect(result.models.taskAttachment).toEqual({ affected: 1, updated: 1 });
    expect(result.models.projectAttachment).toEqual({ affected: 1, updated: 1 });
    expect(result.affected).toBe(3);
    expect(result.updated).toBe(3);

    expect(lines).toEqual([
      `messageAttachment ${dirtyMessageAttachmentId} before=${JSON.stringify(DIRTY_MESSAGE_NAME)} after=${JSON.stringify('notesX-Injected: 1.txt')}`,
      `taskAttachment ${dirtyTaskAttachmentId} before=${JSON.stringify(DIRTY_TASK_NAME)} after=${JSON.stringify('specdraft.md')}`,
      `projectAttachment ${dirtyProjectAttachmentId} before=${JSON.stringify(DIRTY_PROJECT_NAME)} after=${JSON.stringify('planfinal.pdf')}`,
    ]);

    const names = await readFilenames();
    expect(names.dirtyMessage).toBe('notesX-Injected: 1.txt');
    expect(names.dirtyTask).toBe('specdraft.md');
    expect(names.dirtyProject).toBe('planfinal.pdf');
    expect(names.cleanMessage).toBe(CLEAN_NAME);
    for (const name of Object.values(names)) {
      expect(hasControlChars(name)).toBe(false);
    }
  });

  it('is idempotent: a second applied run finds and writes nothing, and prints no lines', async () => {
    const before = await readFilenames();
    const lines: string[] = [];

    const result = await backfillAttachmentFilenames(prisma, { dryRun: false, log: (line) => lines.push(line) });

    expect(result.affected).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.models.messageAttachment).toEqual({ affected: 0, updated: 0 });
    expect(result.models.taskAttachment).toEqual({ affected: 0, updated: 0 });
    expect(result.models.projectAttachment).toEqual({ affected: 0, updated: 0 });
    expect(await readFilenames()).toEqual(before);
    expect(lines).toEqual([]);
  });

  it('measures control-character copies in inbox_items.message and messages.content seeded like the write paths that copy an attachment filename', async () => {
    const inboxRows = await prisma.inboxItem.findMany({
      where: { id: { in: [dirtyInboxItemId, cleanInboxItemId] } },
      select: { id: true, message: true },
    });
    const messageRows = await prisma.message.findMany({
      where: { id: { in: [dirtySystemMessageId, cleanSystemMessageId] } },
      select: { id: true, content: true },
    });

    const dirtyInboxCount = inboxRows.filter((r) => r.message !== null && hasControlChars(r.message)).length;
    const dirtyMessageCount = messageRows.filter((r) => hasControlChars(r.content)).length;

    // Measured on this seeded test database: of the 2 inbox_items.message
    // copies shaped like the project/task attachment-removed notice
    // (single-line, so the filename's control-character class isolates
    // exactly the one dirty copy), 1 matches. Of the 2 messages.content
    // copies shaped like the review-ready summary line, BOTH match: that
    // line always embeds a structural "\n" between "... ist bereit fuer
    // Review." and "Bearbeitet von: ..." regardless of the attachment name,
    // so the same control-character predicate used for filenames is not
    // selective on this table, clean or dirty. Recorded in the CHANGELOG
    // alongside the decision to leave both uncleaned.
    expect(dirtyInboxCount).toBe(1);
    expect(dirtyMessageCount).toBe(2);
  });
});

describeOrSkip('backfillAttachmentFilenames cursor pagination (DB-backed)', () => {
  const PAGINATION_USERNAME = 'attachment-filename-backfill-pagination-user';
  const PAGE_BATCH_SIZE = 3;
  // Interleaved (not all-dirty-then-clean): with batchSize 3 this seeds
  // page 1 as dirty, dirty, clean (ending on a CLEAN row) and page 2 as
  // dirty, dirty. A fixture that puts the lone clean row last would make
  // "the last dirty row of a page" and "the last row of a page" coincide
  // on every page, hiding a cursor bug that advances from the former
  // instead of the latter; this arrangement tells them apart on page 1.
  const ROW_KINDS = ['dirty', 'dirty', 'clean', 'dirty', 'dirty'] as const;
  const DIRTY_COUNT = ROW_KINDS.filter((k) => k === 'dirty').length;
  const TOTAL_COUNT = ROW_KINDS.length;
  // Correct pagination: page 1 fetches 3 rows (full page, continue), page
  // 2 fetches the remaining 2 (short page, stop) = 2 findMany calls. A
  // cursor pinned to the last DIRTY row of a page instead of the page's
  // last row rewinds past page 1's trailing clean row, re-fetching it (and
  // extending the scan by one more, ultimately empty, page), which this
  // test catches even though the rewind never revisits a dirty row (there
  // is none after "the last dirty row" by definition) and so never
  // duplicates a log line.
  const EXPECTED_FIND_MANY_CALLS = Math.ceil(TOTAL_COUNT / PAGE_BATCH_SIZE);

  let userId: string;
  let roomId: string;
  let messageId: string;
  let dirtyIds: string[] = [];
  let cleanIds: string[] = [];

  async function cleanup() {
    const stale = await prisma.user.findMany({
      where: { username: PAGINATION_USERNAME },
      select: { id: true },
    });
    for (const user of stale) {
      await prisma.messageAttachment.deleteMany({ where: { message: { senderId: user.id } } });
      await prisma.message.deleteMany({ where: { senderId: user.id } });
      await prisma.room.deleteMany({ where: { name: `${PAGINATION_USERNAME}-room` } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }

  beforeAll(async () => {
    await cleanup();

    const user = await prisma.user.create({
      data: {
        username: PAGINATION_USERNAME,
        displayName: 'Attachment filename backfill pagination test user',
        userType: 'HUMAN',
        passwordHash: 'not-a-real-hash',
      },
    });
    userId = user.id;

    const room = await prisma.room.create({
      data: { name: `${PAGINATION_USERNAME}-room`, roomType: 'TRIOLOGUE', isPrivate: true },
    });
    roomId = room.id;

    const message = await prisma.message.create({
      data: { content: 'backfill pagination test message', senderId: userId, roomId },
    });
    messageId = message.id;

    dirtyIds = [];
    cleanIds = [];
    for (let i = 0; i < ROW_KINDS.length; i += 1) {
      const kind = ROW_KINDS[i];
      const attachment = await prisma.messageAttachment.create({
        data: {
          messageId,
          filename: kind === 'dirty' ? `dirty-${i}\r\n.txt` : `clean-${i}.txt`,
          url: `/uploads/backfill-pagination-${kind}-${i}.txt`,
          mimeType: 'text/plain',
          type: 'DOCUMENT',
        },
      });
      if (kind === 'dirty') {
        dirtyIds.push(attachment.id);
      } else {
        cleanIds.push(attachment.id);
      }
    }
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  // Wraps `prisma` so `messageAttachment.findMany` calls are counted
  // without touching any other delegate or Prisma internals: every other
  // property (including the other two attachment models) resolves through
  // the prototype chain to the real, unwrapped `prisma`.
  function withFindManyCallCounter(): { prisma: PrismaClient; callCount: () => number } {
    let calls = 0;
    const wrapped = Object.create(prisma) as PrismaClient;
    Object.defineProperty(wrapped, 'messageAttachment', {
      value: {
        findMany: (args: unknown) => {
          calls += 1;
          return prisma.messageAttachment.findMany(args as never);
        },
        update: (args: unknown) => prisma.messageAttachment.update(args as never),
      },
    });
    return { prisma: wrapped, callCount: () => calls };
  }

  it('reports every dirty row across more than one page exactly once, none missing and none duplicated', async () => {
    // Dry-run, not applied: this is the discriminating case. In apply mode,
    // an accidentally re-scanned row is already clean on its second visit
    // and silently skipped (self-healing an overlap bug), masking a missing
    // `skip: 1`. Dry-run never mutates data, so a re-scanned dirty row is
    // still dirty and logs again, surfacing the duplicate.
    const lines: string[] = [];
    const { prisma: countingPrisma, callCount } = withFindManyCallCounter();
    const result = await backfillAttachmentFilenames(countingPrisma, {
      dryRun: true,
      batchSize: PAGE_BATCH_SIZE,
      log: (line) => lines.push(line),
    });

    expect(result.models.messageAttachment.affected).toBe(DIRTY_COUNT);
    expect(result.models.messageAttachment.updated).toBe(0);

    const attachmentLines = lines.filter((l) => l.startsWith('messageAttachment '));
    const loggedIds = attachmentLines.map((l) => l.split(' ')[1]);
    expect(loggedIds).toHaveLength(DIRTY_COUNT);
    expect(new Set(loggedIds).size).toBe(DIRTY_COUNT);
    expect(new Set(loggedIds)).toEqual(new Set(dirtyIds));
    for (const cleanId of cleanIds) {
      expect(loggedIds).not.toContain(cleanId);
    }

    // A cursor that rewinds to the last dirty row of a page (instead of
    // the page's own last row) never revisits an already-logged dirty row
    // (there is none after "the last dirty row" within that same page by
    // definition), so it cannot be caught by the log-line assertions
    // above alone; it shows up here instead, as extra findMany round
    // trips re-fetching the trailing clean row(s) it should have skipped.
    expect(callCount()).toBe(EXPECTED_FIND_MANY_CALLS);

    // Untouched: dry-run.
    const rows = await prisma.messageAttachment.findMany({
      where: { id: { in: [...dirtyIds, ...cleanIds] } },
      select: { id: true, filename: true },
    });
    for (const row of rows) {
      if (dirtyIds.includes(row.id)) {
        expect(hasControlChars(row.filename)).toBe(true);
      } else {
        expect(hasControlChars(row.filename)).toBe(false);
      }
    }
  });

  it('applying across more than one page rewrites every dirty row exactly once', async () => {
    const lines: string[] = [];
    const result = await backfillAttachmentFilenames(prisma, {
      dryRun: false,
      batchSize: PAGE_BATCH_SIZE,
      log: (line) => lines.push(line),
    });

    expect(result.models.messageAttachment.affected).toBe(DIRTY_COUNT);
    expect(result.models.messageAttachment.updated).toBe(DIRTY_COUNT);

    // Exactly one before=/after= line per dirty row: a rewinding cursor
    // that re-updates an already-cleaned row would either duplicate a
    // line here or, since the row is already clean on its second visit,
    // silently drop out of `affected` a second time (caught above).
    const attachmentLines = lines.filter((l) => l.startsWith('messageAttachment '));
    const loggedIds = attachmentLines.map((l) => l.split(' ')[1]);
    expect(loggedIds).toHaveLength(DIRTY_COUNT);
    expect(new Set(loggedIds)).toEqual(new Set(dirtyIds));

    const rows = await prisma.messageAttachment.findMany({
      where: { id: { in: dirtyIds } },
      select: { filename: true },
    });
    for (const row of rows) {
      expect(hasControlChars(row.filename)).toBe(false);
    }
  });
});

describe('BATCH_SIZE', () => {
  it('is a positive default page size', () => {
    expect(BATCH_SIZE).toBeGreaterThan(0);
  });
});

describe('backfillAttachmentFilenames batchSize guard', () => {
  // No DB access: a non-positive batchSize is rejected before any query
  // (`take: 0` would otherwise silently scan zero rows per page forever),
  // so a stub `PrismaClient` that is never touched is enough here.
  const untouchedPrisma = {} as PrismaClient;

  it('rejects a zero batchSize with a RangeError instead of scanning nothing', async () => {
    await expect(
      backfillAttachmentFilenames(untouchedPrisma, { dryRun: true, batchSize: 0 }),
    ).rejects.toThrow(RangeError);
  });

  it('rejects a negative batchSize with a RangeError', async () => {
    await expect(
      backfillAttachmentFilenames(untouchedPrisma, { dryRun: true, batchSize: -5 }),
    ).rejects.toThrow(RangeError);
  });
});
