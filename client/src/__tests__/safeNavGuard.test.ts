/**
 * Repo-wide invariant: every `<Link to={...}>` and `navigate(...)` call site
 * under client/src must carry a provably safe navigation target (see
 * helpers/safeNavGuardScan.ts for exactly what counts as safe). This
 * supersedes call-site-by-call-site test coverage of the 6 sites fixed
 * alongside `safeNavTarget` (task 67d3cf19, following up on PR #202's
 * review): a NEW call site anywhere else in the tree that forwards an
 * unguarded value would otherwise pass silently.
 *
 * The scanner's true-positive/true-negative behavior is covered against
 * synthetic fixtures below (mutation-sensitive: breaking the scanner's
 * literal/template-prefix/conditional/wrapper detection fails these).
 */
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectTsxFiles } from "./helpers/iconOnlyButtonScan";
import { scanForUnguardedNavTargets } from "./helpers/safeNavGuardScan";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(testDir, "..");

let scratchDir: string | null = null;

afterEach(() => {
  if (scratchDir) {
    rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = null;
  }
});

const writeFixture = (contents: string): string => {
  scratchDir = mkdtempSync(path.join(tmpdir(), "safe-nav-guard-"));
  const file = path.join(scratchDir, "Fixture.tsx");
  writeFileSync(file, contents, "utf8");
  return scratchDir;
};

describe("safe-nav guard scanner (synthetic fixtures)", () => {
  it("flags a Link whose to is a bare, unwrapped identifier", () => {
    const dir = writeFixture(`
      import { Link } from "react-router-dom";
      export const Bad = ({ item }: { item: { to: string } }) => (
        <Link to={item.to}>go</Link>
      );
    `);
    const violations = scanForUnguardedNavTargets(dir);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("Link");
  });

  it("flags navigate() called with a bare, unwrapped identifier", () => {
    const dir = writeFixture(`
      export const go = (link: string) => {
        navigate(link);
      };
    `);
    const violations = scanForUnguardedNavTargets(dir);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("navigate");
  });

  it("flags a template literal whose head does not start with a literal path prefix", () => {
    const dir = writeFixture(`
      import { Link } from "react-router-dom";
      export const Bad = ({ suffix }: { suffix: string }) => (
        <Link to={\`\${suffix}/inbox\`}>go</Link>
      );
    `);
    expect(scanForUnguardedNavTargets(dir)).toHaveLength(1);
  });

  it("does not flag a Link wrapped in safeNavTarget", () => {
    const dir = writeFixture(`
      import { Link } from "react-router-dom";
      import { safeNavTarget } from "../lib/safeNavTarget";
      export const Good = ({ item }: { item: { to: string } }) => (
        <Link to={safeNavTarget(item.to)}>go</Link>
      );
    `);
    expect(scanForUnguardedNavTargets(dir)).toEqual([]);
  });

  it("does not flag navigate() wrapped in safeNavTarget", () => {
    const dir = writeFixture(`
      import { safeNavTarget } from "../lib/safeNavTarget";
      export const go = (link: string) => {
        navigate(safeNavTarget(link));
      };
    `);
    expect(scanForUnguardedNavTargets(dir)).toEqual([]);
  });

  it("does not flag a string literal or no-substitution template literal", () => {
    const dir = writeFixture(`
      import { Link } from "react-router-dom";
      export const Good = () => (
        <>
          <Link to="/inbox">a</Link>
          <Link to={\`/inbox\`}>b</Link>
        </>
      );
    `);
    expect(scanForUnguardedNavTargets(dir)).toEqual([]);
  });

  it("does not flag a template literal with a literal, path-absolute head", () => {
    const dir = writeFixture(`
      import { Link } from "react-router-dom";
      export const Good = ({ room }: { room: { id: string } }) => (
        <Link to={\`/room/\${room.id}\`}>go</Link>
      );
    `);
    expect(scanForUnguardedNavTargets(dir)).toEqual([]);
  });

  it("does not flag a conditional expression whose branches are both safe", () => {
    const dir = writeFixture(`
      export const go = (id: string | undefined) => {
        navigate(id ? \`/memory/\${id}\` : "/memory");
      };
    `);
    expect(scanForUnguardedNavTargets(dir)).toEqual([]);
  });

  it("flags a conditional expression when one branch is unsafe", () => {
    const dir = writeFixture(`
      export const go = (id: string | undefined, raw: string) => {
        navigate(id ? \`/memory/\${id}\` : raw);
      };
    `);
    expect(scanForUnguardedNavTargets(dir)).toHaveLength(1);
  });

  it("does not flag navigate(-1) history-delta calls", () => {
    const dir = writeFixture(`
      export const back = () => {
        navigate(-1);
      };
    `);
    expect(scanForUnguardedNavTargets(dir)).toEqual([]);
  });
});

describe("safe-nav guard repo invariant", () => {
  it("client/src has zero unguarded Link/navigate call sites", () => {
    // Instrument-must-be-able-to-fail: prove the scan is non-vacuous first.
    const scanned = collectTsxFiles(
      srcRoot,
      new Set(["node_modules", "__tests__", "dist"]),
    );
    expect(scanned.length).toBeGreaterThan(10);

    const violations = scanForUnguardedNavTargets(srcRoot);
    expect(violations).toEqual([]);
  });
});
