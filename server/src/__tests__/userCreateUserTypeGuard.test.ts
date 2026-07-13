/**
 * Guard test for agent-tasks 6b1a1772: User.userType defaults to HUMAN
 * (prisma/schema.prisma), and requireHuman (middleware/auth.ts) keys
 * authorization off it. The only current agent-provisioning path
 * (routes/agents.ts, BYOA) sets userType explicitly, so the schema default
 * never fires today. The risk is a *future* `user.create` call site (a seed
 * script, an admin tool, an import, a second provisioning flow) that omits
 * userType and silently inherits the HUMAN default, granting an agent-backed
 * row human-only privileges instead of failing loudly.
 *
 * Decision (see PR body for full rationale): keep the schema default and add
 * this guard test rather than dropping the default (which would need a
 * migration coordinated with the live opentriologue.ai deployment) or
 * inverting it (which would just move the silent-grant risk onto a
 * differently-privileged value). This is the cheap, no-migration option: it
 * statically scans every `<client>.user.create(...)`, `.user.createMany(...)`
 * and `.user.upsert(...)` call site under server/src and fails if any of them
 * omits an explicit `userType:` key in the call arguments, so a future
 * omission is caught at test time instead of silently defaulting at insert
 * time.
 *
 * Scope: server/src only, non-test files. `__tests__/**` and `*.test.ts`
 * files are excluded because tests intentionally exercise mocked prisma
 * clients where a call may omit fields on purpose.
 *
 * Known limitation: this is a text scan, not a full TS/AST analysis. It
 * matches `.user.create(` / `.user.createMany(` / `.user.upsert(` on any
 * receiver (prisma, tx, ...) and requires a
 * literal `userType:` key somewhere in the balanced-paren call argument. It
 * would NOT catch userType supplied only via a computed key
 * (`["userType"]: ...`) or via an opaque helper that builds the `data`
 * object elsewhere and spreads it in: neither pattern is used anywhere in
 * this codebase today. If one is introduced, tighten this scan alongside it.
 *
 * Mutation-testability: temporarily remove the `userType:` line from any one
 * of the known call sites below (e.g. integrations/teams/teamsMapping.ts) and
 * this test goes red; restoring the line makes it green again.
 */
import fs from 'fs';
import path from 'path';

const SRC_ROOT = path.join(__dirname, '..');

interface CallSite {
  file: string;
  line: number;
  snippet: string;
}

function listSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.test.ts')
    ) {
      files.push(full);
    }
  }
  return files;
}

// Extracts the balanced-paren substring starting at `openIndex` (which must
// point at the '(' of a call expression), tolerating parens/braces inside
// string and template literals.
function extractBalancedParens(source: string, openIndex: number): string {
  let depth = 0;
  let inString: '"' | "'" | '`' | null = null;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    const prev = source[i - 1];
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return source.slice(openIndex, i + 1);
      }
    }
  }
  throw new Error(
    `Unbalanced parens scanning .user.create( call starting at index ${openIndex}`,
  );
}

function findUserCreateCallSites(): CallSite[] {
  const callSites: CallSite[] = [];
  const callPattern = /\.user\.(?:create|createMany|upsert)\s*\(/g;

  for (const file of listSourceFiles(SRC_ROOT)) {
    const source = fs.readFileSync(file, 'utf8');
    let match: RegExpExecArray | null;
    callPattern.lastIndex = 0;
    while ((match = callPattern.exec(source)) !== null) {
      const openIndex = match.index + match[0].length - 1;
      const callText = extractBalancedParens(source, openIndex);
      const line = source.slice(0, match.index).split('\n').length;
      callSites.push({
        file: path.relative(SRC_ROOT, file),
        line,
        snippet: callText,
      });
    }
  }
  return callSites;
}

describe('prisma.user.create call sites must set userType explicitly', () => {
  it('finds the known call sites under server/src (scan sanity check)', () => {
    const callSites = findUserCreateCallSites();
    // If this drops to 0, the scan itself is broken (wrong root, renamed
    // pattern, etc.) rather than the codebase having no user.create sites:
    // fail loudly instead of vacuously passing the guard below. The floor is
    // deliberately 1, not the current site count, so legitimately removing a
    // call site does not fail this sanity check.
    expect(callSites.length).toBeGreaterThanOrEqual(1);
  });

  it('every call site passes userType explicitly in the data object', () => {
    const callSites = findUserCreateCallSites();
    const violations = callSites.filter(
      (site) => !/\buserType\s*:/.test(site.snippet),
    );

    if (violations.length > 0) {
      const details = violations
        .map((v) => `  ${v.file}:${v.line}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} user.create() call site(s) under server/src that ` +
          `do not set userType explicitly. Because User.userType defaults to HUMAN ` +
          `(prisma/schema.prisma), an omission silently grants human-only privileges ` +
          `(see requireHuman in middleware/auth.ts). Set userType explicitly at:\n${details}`,
      );
    }

    expect(violations).toEqual([]);
  });
});
