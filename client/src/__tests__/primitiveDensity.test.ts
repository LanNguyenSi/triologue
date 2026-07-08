/**
 * Density guards for the shared UI primitives.
 *
 * Group A of the enterprise-density overhaul shrank the primitive scale. The
 * a11y guards (primitives.a11y.test.tsx) assert token PRESENCE (focus ring,
 * disabled utilities, ring-offset) but never the density VALUES, so reverting
 * md back to `px-5 py-2.5` or restoring `rounded-xl` would leave CI fully
 * green. These source-text assertions lock the operator-approved "balanced
 * enterprise" tokens so a future edit that undoes the density target fails CI.
 *
 * Same source-text pattern as primitives.a11y.test.tsx (ThemeProvider needs
 * localStorage + DOM that the node test env lacks).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(testDir, "..");
const read = (relativePath: string) =>
  readFileSync(path.join(srcRoot, relativePath), "utf8");

describe("primitive density scale (source-text guards)", () => {
  it("Button keeps the four approved size tokens and the rounded-md base", () => {
    const src = read("components/ui/primitives/Button.tsx");
    expect(src).toContain('xs: "px-2.5 py-1 text-xs"');
    expect(src).toContain('sm: "px-3.5 py-1.5 text-sm"');
    expect(src).toContain('md: "px-3.5 py-2 text-sm"');
    expect(src).toContain('icon: "p-1.5');
    expect(src).toContain("rounded-md font-medium");
    // The oversized pre-overhaul default must not creep back.
    expect(src).not.toContain("px-5 py-2.5");
  });

  it("Button owns its flex context, block-level only when the block prop is set", () => {
    const src = read("components/ui/primitives/Button.tsx");
    // Tailwind preflight makes `svg` display:block, so an icon child inside an
    // inline-block button pushes the label onto a second line. The primitive
    // establishes the flex context so no call site needs a wrapper span.
    expect(src).toContain('const displayClass = block ? "flex" : "inline-flex"');
    expect(src).toContain("${displayClass} items-center justify-center gap-1.5");
    // A hardcoded display would either reintroduce the wrap (inline-block) or
    // demote the only `block` consumer (LoginPage's submit CTA) to inline-level.
    expect(src).not.toMatch(/className=\{`inline-flex /);
    expect(src).not.toMatch(/className=\{`rounded-md /);
  });

  it("Input uses the compact px-3 py-2 + rounded-md control height", () => {
    const src = read("components/ui/primitives/Input.tsx");
    expect(src).toContain("rounded-md border px-3 py-2 text-sm");
    expect(src).not.toContain("px-3.5 py-2.5");
  });

  it("Select trigger and option rows use the compact density", () => {
    const src = read("components/ui/primitives/Select.tsx");
    expect(src).toContain("rounded-md border px-3 py-2 text-sm");
    expect(src).toContain("px-3 py-1.5");
    expect(src).not.toContain("px-3.5 py-2.5");
  });

  it("Card and EmptyState use the enterprise radius + tightened padding", () => {
    const card = read("components/ui/primitives/Card.tsx");
    const empty = read("components/ui/primitives/EmptyState.tsx");
    expect(card).toContain("rounded-lg border");
    expect(card).not.toContain("rounded-xl");
    expect(empty).toContain("rounded-lg border p-6");
    expect(empty).not.toContain("p-10");
  });
});
