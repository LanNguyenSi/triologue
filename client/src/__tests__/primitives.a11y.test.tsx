/**
 * A11y guards for Button and EmptyState.
 *
 * LoadingSpinner now depends on ThemeContext (useTheme), so its rendered a11y
 * tests moved to LoadingSpinner.test.tsx, which runs under the jsdom
 * environment with useTheme mocked (same pattern as EditTaskModal.test.tsx).
 *
 * Button and EmptyState call useTheme(), which throws outside a ThemeProvider.
 * ThemeProvider reads localStorage synchronously in its useState initializer,
 * which is unavailable in the node test environment (no jsdom). Wrapping in
 * ThemeProvider would also invoke document.documentElement.classList in its
 * useEffect, another node-missing API. For these two components the tests fall
 * back to source-text assertions (the same pattern as uiConsistency.test.ts):
 * the component source files are read and asserted to contain the exact utility
 * strings. Removing or renaming the classes from the source would fail the
 * tests.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(testDir, "..");

const read = (relativePath: string) =>
  readFileSync(path.join(srcRoot, relativePath), "utf8");

// ---------------------------------------------------------------------------
// Button — source-text assertions (ThemeProvider needs localStorage + DOM)
// ---------------------------------------------------------------------------
describe("Button a11y (source-text fallback)", () => {
  const src = read("components/ui/primitives/Button.tsx");

  it("has a focus-visible ring in the base className", () => {
    // focus-visible: prefix ensures the ring only appears on keyboard focus,
    // not on mouse click. Removing any of these classes from Button.tsx fails.
    expect(src).toContain("focus-visible:ring-2");
    expect(src).toContain("focus-visible:ring-blue-500/40");
    expect(src).toContain("focus-visible:ring-offset-1");
    // outline-none must accompany the ring; dropping it would leave a default
    // browser outline AND the ring, or (worse) regress the indicator.
    expect(src).toContain("outline-none");
  });

  it("uses disabled: utilities instead of a JS ternary for disabled state", () => {
    // These Tailwind utilities replace the former runtime ternary, ensuring
    // the disabled styling applies via the HTML disabled attribute alone.
    // Removing either utility from Button.tsx fails this test.
    expect(src).toContain("disabled:opacity-50");
    expect(src).toContain("disabled:cursor-not-allowed");
  });

  it("no longer uses a JS ternary to apply disabled styling", () => {
    // The old pattern was: disabled ? "opacity-50 cursor-not-allowed" : ""
    // It must be gone; Tailwind disabled: variants cover it now.
    expect(src).not.toContain('"opacity-50 cursor-not-allowed"');
  });
});

// ---------------------------------------------------------------------------
// EmptyState — source-text assertions (ThemeProvider needs localStorage + DOM)
// ---------------------------------------------------------------------------
describe("EmptyState a11y (source-text fallback)", () => {
  const src = read("components/ui/primitives/EmptyState.tsx");

  it("marks the icon wrapper as aria-hidden so the decorative icon is skipped", () => {
    // Removing aria-hidden from the icon wrapper div fails this test.
    expect(src).toContain('aria-hidden="true"');
  });

  it("does not carry vestigial text-4xl on the icon wrapper", () => {
    // All callers pass heroicons with explicit w-8 h-8 sizing; text-4xl was
    // unused. Assert the bare token so any re-introduction (in any class order)
    // fails, not only the exact former string.
    expect(src).not.toContain("text-4xl");
  });
});

// ---------------------------------------------------------------------------
// Primitives — theme-aware focus ring-offset (source-text assertions)
// Guards the T1 fix: a bare ring-offset-1 paints a 1px white halo on the dark
// theme. Each primitive must pair ring-offset-1 with BOTH theme offset colors
// (ring-offset-gray-900 for dark, ring-offset-white for light). Reverting the
// offset-color additions removes these tokens and fails CI — so the behavior
// this task introduces is mutation-guarded for all three files (Input/Select
// otherwise have no a11y assertions).
// ---------------------------------------------------------------------------
describe("primitive focus ring-offset is theme-aware (source-text fallback)", () => {
  for (const file of [
    "components/ui/primitives/Button.tsx",
    "components/ui/primitives/Input.tsx",
    "components/ui/primitives/Select.tsx",
  ]) {
    it(`${file} pairs ring-offset-1 with both theme offset colors`, () => {
      const src = read(file);
      expect(src).toContain("ring-offset-1");
      expect(src).toContain("ring-offset-gray-900");
      expect(src).toContain("ring-offset-white");
    });
  }
});
