/**
 * Repo-wide a11y invariant: no NEW icon-only <button>/<Button> without an
 * accessible name may land in client/src.
 *
 * This supersedes a frozen call-site list (like the one in
 * uiConsistency.test.ts's "app-wide icon-only buttons..." case) for future
 * additions: that guard only re-checks the specific call sites #211 already
 * fixed, so a brand-new nameless icon-only button anywhere else in the tree
 * would pass silently. This test walks the real AST of every .tsx file under
 * client/src (see helpers/iconOnlyButtonScan.ts) and fails on any match.
 *
 * The scanner's true-positive/true-negative behavior is itself covered below
 * against synthetic fixtures (mutation-sensitive: breaking the scanner's
 * detection or its "has a name" allowlist fails these). The scanner was also
 * verified against a real, temporarily-reintroduced nameless icon button in
 * this repo as a manual negative control (see task evidence) — that step
 * cannot live in the automated suite since it requires mutating and
 * restoring real source at run time, but the synthetic fixtures below give
 * the same guarantee on every CI run.
 */
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectTsxFiles, scanForNamelessIconButtons } from "./helpers/iconOnlyButtonScan";

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
  scratchDir = mkdtempSync(path.join(tmpdir(), "icon-only-guard-"));
  const file = path.join(scratchDir, "Fixture.tsx");
  writeFileSync(file, contents, "utf8");
  return scratchDir;
};

describe("icon-only button scanner (synthetic fixtures)", () => {
  it("flags a <button> whose only child is an icon component and has no name", () => {
    const dir = writeFixture(`
      import React from "react";
      import { XMarkIcon } from "@heroicons/react/24/outline";
      export const Bad: React.FC = () => (
        <button onClick={() => {}}>
          <XMarkIcon className="w-4 h-4" />
        </button>
      );
    `);
    const violations = scanForNamelessIconButtons(dir);
    expect(violations).toHaveLength(1);
    expect(violations[0].tag).toBe("button");
  });

  it("flags the primitive <Button> component the same way", () => {
    const dir = writeFixture(`
      import React from "react";
      import { TrashIcon } from "@heroicons/react/24/outline";
      import { Button } from "../components/ui/primitives";
      export const Bad: React.FC = () => (
        <Button onClick={() => {}}>
          <TrashIcon className="w-4 h-4" />
        </Button>
      );
    `);
    expect(scanForNamelessIconButtons(dir)).toHaveLength(1);
  });

  it("does not flag an icon-only button that has aria-label", () => {
    const dir = writeFixture(`
      import React from "react";
      import { XMarkIcon } from "@heroicons/react/24/outline";
      export const Good: React.FC = () => (
        <button onClick={() => {}} aria-label="Close">
          <XMarkIcon className="w-4 h-4" />
        </button>
      );
    `);
    expect(scanForNamelessIconButtons(dir)).toEqual([]);
  });

  it("does not flag an icon-only button that has title (out of scope per task spec)", () => {
    const dir = writeFixture(`
      import React from "react";
      import { XMarkIcon } from "@heroicons/react/24/outline";
      export const Good: React.FC = () => (
        <button onClick={() => {}} title="Close">
          <XMarkIcon className="w-4 h-4" />
        </button>
      );
    `);
    expect(scanForNamelessIconButtons(dir)).toEqual([]);
  });

  it("does not flag a button with real text content", () => {
    const dir = writeFixture(`
      import React from "react";
      export const Good: React.FC = () => (
        <button onClick={() => {}}>Save</button>
      );
    `);
    expect(scanForNamelessIconButtons(dir)).toEqual([]);
  });

  it("does not flag a button mixing an icon with real text", () => {
    const dir = writeFixture(`
      import React from "react";
      import { XMarkIcon } from "@heroicons/react/24/outline";
      export const Good: React.FC = () => (
        <button onClick={() => {}}>
          <XMarkIcon className="w-4 h-4" /> Save
        </button>
      );
    `);
    expect(scanForNamelessIconButtons(dir)).toEqual([]);
  });
});

describe("icon-only button repo invariant", () => {
  it("client/src has zero nameless icon-only <button>/<Button> elements", () => {
    // Instrument-must-be-able-to-fail: prove the scan is non-vacuous first.
    // If srcRoot ever resolves wrong, an empty violations list would pass
    // silently; a broken path fails here instead.
    const scanned = collectTsxFiles(
      srcRoot,
      new Set(["node_modules", "__tests__", "dist"]),
    );
    expect(scanned.length).toBeGreaterThan(10);

    const violations = scanForNamelessIconButtons(srcRoot);
    expect(violations).toEqual([]);
  });
});
