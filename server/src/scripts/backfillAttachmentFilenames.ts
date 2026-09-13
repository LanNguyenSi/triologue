/**
 * One-off backfill: strip ASCII control characters (code points 0-31 and
 * 127) from every stored attachment display filename.
 *
 * Why a backfill and not a read-side strip: `stripControlChars` has guarded
 * every write sink since the multer 2.3.0 follow-up, so the only rows that
 * can still carry raw CR/LF are the ones persisted between that bump and the
 * sanitiser landing. Cleaning those rows in place makes every read site
 * (markdown export link labels, inbox `message`, agent audit details, the
 * result-router summary line, JSON API responses) correct without touching
 * any of them, and leaves no per-site strip that a future read site could
 * forget to add.
 *
 * Covers every attachment model whose `filename` column is user-supplied:
 * `messageAttachment`, `taskAttachment` and `projectAttachment`.
 *
 * Idempotent: a row is only selected when its filename still contains a
 * control character, so a second run selects nothing and writes nothing.
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

// Same character class as stripControlChars, used only to select rows.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

export function hasControlChars(name: string): boolean {
  return CONTROL_CHARS.test(name);
}

// The three delegates share the `findMany({ select: { id, filename } })` and
// `update({ where: { id }, data: { filename } })` shape this script needs.
interface AttachmentDelegate {
  findMany(args: {
    select: { id: true; filename: true };
  }): Promise<Array<{ id: string; filename: string }>>;
  update(args: { where: { id: string }; data: { filename: string } }): Promise<unknown>;
}

export async function backfillAttachmentFilenames(
  prisma: PrismaClient,
  options: { dryRun: boolean },
): Promise<BackfillResult> {
  const models = {} as Record<AttachmentFilenameModel, BackfillModelResult>;

  for (const model of ATTACHMENT_FILENAME_MODELS) {
    const delegate = prisma[model] as unknown as AttachmentDelegate;
    // Attachment tables are small enough to scan in one query; the
    // selection is done in JS so it uses exactly the sanitiser's character
    // class rather than a second, database-side definition of it.
    const rows = await delegate.findMany({ select: { id: true, filename: true } });
    const dirty = rows.filter((row) => hasControlChars(row.filename));

    let updated = 0;
    if (!options.dryRun) {
      for (const row of dirty) {
        await delegate.update({
          where: { id: row.id },
          data: { filename: stripControlChars(row.filename) },
        });
        updated += 1;
      }
    }

    models[model] = { affected: dirty.length, updated };
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const known = new Set(["--dry-run"]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    console.error(`unknown argument(s): ${unknown.join(" ")}\nusage: backfillAttachmentFilenames [--dry-run]`);
    process.exit(2);
  }
  const dryRun = args.includes("--dry-run");

  const prisma = new PrismaClient();
  try {
    const result = await backfillAttachmentFilenames(prisma, { dryRun });
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
