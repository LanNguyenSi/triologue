/**
 * Contrast guards for the light-scheme Button variants (source-text pattern,
 * same as primitives.a11y.test.tsx: Button calls useTheme(), so rendered
 * assertions would need ThemeProvider with localStorage + DOM).
 *
 * The success light variant was bg-green-600 hover:bg-green-500 text-white
 * (3.30:1 on green-600, worse on hover) and the danger light variant hovered
 * on bg-red-500 (3.76:1 with white). Both break WCAG AA for normal-size
 * button text. The success light pair is now bg-green-700 hover:bg-green-800
 * (5.02:1 / 7.13:1) and the danger hover is bg-red-700 (6.47:1) while the
 * danger base stays bg-red-600 (4.83:1). Dark keeps its own /80 tints.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(testDir, "..");

const read = (relativePath: string) =>
  readFileSync(path.join(srcRoot, relativePath), "utf8");

describe("Button light variant contrast (source-text guards)", () => {
  const src = read("components/ui/primitives/Button.tsx");

  it("success light uses bg-green-700 with a bg-green-800 hover", () => {
    expect(src).toContain(
      '"bg-green-700 hover:bg-green-800 text-white shadow-subtle"',
    );
    // The failing pre-fix pair must not creep back.
    expect(src).not.toContain("bg-green-600 hover:bg-green-500 text-white");
  });

  it("danger light keeps bg-red-600 and hovers on bg-red-700, never bg-red-500", () => {
    expect(src).toContain(
      '"bg-red-600 hover:bg-red-700 text-white shadow-subtle"',
    );
    expect(src).not.toContain("bg-red-500");
  });

  it("success dark keeps its own green-700/80 tint pair", () => {
    expect(src).toContain(
      '"bg-green-700/80 hover:bg-green-600 text-green-100"',
    );
  });
});
