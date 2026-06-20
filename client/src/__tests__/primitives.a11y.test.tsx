/**
 * A11y guards for Button, LoadingSpinner, and EmptyState.
 *
 * LoadingSpinner has no ThemeContext dependency, so it is rendered directly
 * with renderToStaticMarkup and the assertions are mutation-sensitive (removing
 * role="status" or aria-label from the component would fail these tests).
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
import { renderToStaticMarkup } from "react-dom/server";
import { LoadingSpinner } from "../components/ui/LoadingSpinner";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(testDir, "..");

const read = (relativePath: string) =>
  readFileSync(path.join(srcRoot, relativePath), "utf8");

// ---------------------------------------------------------------------------
// LoadingSpinner — rendered test (mutation-sensitive)
// ---------------------------------------------------------------------------
describe("LoadingSpinner a11y", () => {
  it("carries role=status so screen readers announce loading", () => {
    const html = renderToStaticMarkup(<LoadingSpinner />);
    // Removing role="status" from the component causes this to fail.
    expect(html).toContain('role="status"');
  });

  it("carries an accessible label so screen readers announce what is loading", () => {
    const html = renderToStaticMarkup(<LoadingSpinner />);
    // Removing aria-label="Loading" from the component causes this to fail.
    expect(html).toContain('aria-label="Loading"');
  });

  it("still renders the visual spinner element", () => {
    const html = renderToStaticMarkup(<LoadingSpinner />);
    expect(html).toContain("animate-spin");
    expect(html).toContain("border-t-blue-600");
  });
});

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
