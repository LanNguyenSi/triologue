/**
 * One-off backfill: strip ASCII control characters (code points 0-31 and
 * 127) from every stored attachment display filename.
 *
 * Why a backfill and not a read-side strip: `stripControlChars` has guarded
 * every write sink since the multer 2.3.0 follow-up, so the only rows that
 * can still carry raw CR/LF are the ones persisted between that bump and the
 * sanitiser landing. Cleaning those rows in place makes every read site of
 * the attachment row (markdown export link labels, JSON API responses) and
 * every FUTURE derived copy correct without touching any of them, and leaves
 * no per-site strip that a future read site could forget to add. Copies
 * persisted during that window (inbox `message`, the result-router system
 * message content, agent audit details) keep their text; audit rows are
 * evidence and are not rewritten. See the CHANGELOG for the decision on the
 * two non-audit copies (`inbox_items.message`, `messages.content`).
 *
 * Covers every attachment model whose `filename` column is user-supplied:
 * `messageAttachment`, `taskAttachment` and `projectAttachment`.
 *
 * Idempotent: a row is only selected when its filename still contains a
 * control character, so a second run selects nothing and writes nothing.
 *
 * Scans each model in `BATCH_SIZE`-row pages ordered by `id` (Prisma cursor
 * pagination: `take`, `cursor: { id }`, `skip: 1`) instead of one unbounded
 * `findMany`, so a table with far more rows than fit in memory is still
 * scanned in full. The dirty-row selection itself stays in JS, using
 * exactly the sanitiser's character class rather than a second,
 * database-side definition of it.
 *
 * Every affected row is printed as it is scanned, so the run is an
 * auditable artifact: `--dry-run` prints `model id value=<json>` (the
 * offending value, JSON-escaped); an applied run prints
 * `model id before=<json> after=<json>`. A security-motivated backfill no
 * longer destroys the only record that a given row ever carried an
 * injection attempt.
 *
 * Usage (from `server/`, `DATABASE_URL` set):
 *   npx ts-node src/scripts/backfillAttachmentFilenames.ts --dry-run
 *   npx ts-node src/scripts/backfillAttachmentFilenames.ts
 *
 * `--dry-run` prints the per-model affected counts and writes nothing.
 */
import { PrismaClient } from "@prisma/client";
import { stripControlChars } from "../utils/sanitizeFilename";

export const ATTACHMENT_FILENAME_MODELS = [
  "messageAttachment",
  "taskAttachment",
  "projectAttachment",
] as const;

export type AttachmentFilenameModel = (typeof ATTACHMENT_FILENAME_MODELS)[number];

/** Default page size for the cursor scan; overridable via `options.batchSize` (tests use a small value to exercise multiple pages cheaply). */
export const BATCH_SIZE = 500;

export interface BackfillModelResult {
  /** Rows whose filename still contained a control character when scanned. */
  affected: number;
  /** Rows actually rewritten (always 0 in dry-run mode). */
  updated: number;
}

export interface BackfillResult {
  dryRun: boolean;
  models: Record<AttachmentFilenameModel, BackfillModelResult>;
  affected: number;
  updated: number;
}

export interface BackfillOptions {
  dryRun: boolean;
  /** Rows per cursor page. Defaults to `BATCH_SIZE`. */
  batchSize?: number;
  /** Sink for the per-row audit lines. Defaults to `console.log`. */
  log?: (line: string) => void;
}

// Same character class as stripControlChars, used only to select rows.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

export function hasControlChars(name: string): boolean {
  return CONTROL_CHARS.test(name);
}

// The three delegates share the `findMany`/`update` shape this script needs.
interface AttachmentDelegate {
  findMany(args: {
    select: { id: true; filename: true };
    take: number;
    orderBy: { id: "asc" };
    cursor?: { id: string };
    skip?: number;
  }): Promise<Array<{ id: string; filename: string }>>;
  update(args: { where: { id: string }; data: { filename: string } }): Promise<unknown>;
}

export async function backfillAttachmentFilenames(
  prisma: PrismaClient,
  options: BackfillOptions,
): Promise<BackfillResult> {
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const log = options.log ?? ((line: string) => console.log(line));
  const models = {} as Record<AttachmentFilenameModel, BackfillModelResult>;

  for (const model of ATTACHMENT_FILENAME_MODELS) {
    const delegate = prisma[model] as unknown as AttachmentDelegate;

    let affected = 0;
    let updated = 0;
    let cursorId: string | undefined;

    for (;;) {
      const page = await delegate.findMany({
        select: { id: true, filename: true },
        take: batchSize,
        orderBy: { id: "asc" },
        ...(cursorId !== undefined ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (page.length === 0) break;

      for (const row of page) {
        if (!hasControlChars(row.filename)) continue;
        affected += 1;

        if (options.dryRun) {
          log(`${model} ${row.id} value=${JSON.stringify(row.filename)}`);
        } else {
          const after = stripControlChars(row.filename);
          await delegate.update({ where: { id: row.id }, data: { filename: after } });
          updated += 1;
          log(`${model} ${row.id} before=${JSON.stringify(row.filename)} after=${JSON.stringify(after)}`);
        }
      }

      cursorId = page[page.length - 1].id;
      if (page.length < batchSize) break;
    }

    models[model] = { affected, updated };
  }

  const affected = ATTACHMENT_FILENAME_MODELS.reduce((sum, m) => sum + models[m].affected, 0);
  const updated = ATTACHMENT_FILENAME_MODELS.reduce((sum, m) => sum + models[m].updated, 0);
  return { dryRun: options.dryRun, models, affected, updated };
}

export function formatBackfillResult(result: BackfillResult): string {
  const lines = [
    `attachment filename backfill (${result.dryRun ? "dry-run, nothing written" : "applied"})`,
  ];
  for (const model of ATTACHMENT_FILENAME_MODELS) {
    const { affected, updated } = result.models[model];
    lines.push(`  ${model}: affected=${affected} updated=${updated}`);
  }
  lines.push(`  total: affected=${result.affected} updated=${result.updated}`);
  return lines.join("\n");
}

export interface ParsedArgs {
  dryRun: boolean;
}

/** Thrown by `parseArgs` on an unrecognised argv; `main` maps it to exit 2. */
export class UsageError extends Error {}

// Exact match only: `--dry-run=true` is not the accepted flag and is
// rejected, not silently coerced to `--dry-run`.
const KNOWN_ARGS = new Set(["--dry-run"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const unknown = argv.filter((arg) => !KNOWN_ARGS.has(arg));
  if (unknown.length > 0) {
    throw new UsageError(`unknown argument(s): ${unknown.join(" ")}`);
  }
  return { dryRun: argv.includes("--dry-run") };
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\nusage: backfillAttachmentFilenames [--dry-run]`);
      process.exit(2);
    }
    throw error;
  }

  const prisma = new PrismaClient();
  try {
    const result = await backfillAttachmentFilenames(prisma, { dryRun: parsed.dryRun });
    console.log(formatBackfillResult(result));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
