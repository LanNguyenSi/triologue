/**
 * Repo-wide invariant, following safeNavGuard.test.ts's pattern (task
 * 67d3cf19, PR #219): client/src must not reintroduce either `t`-freeze
 * pattern task a34078b6 exists to close (see helpers/i18nFreezeGuardScan.ts
 * for exactly what each pattern is and why it's a bug). A NEW call site
 * anywhere in the tree that reintroduces either pattern fails this test,
 * not just the sites already fixed across Slices 1-3.
 *
 * The scanner's true-positive/true-negative behaviour is covered against
 * synthetic fixtures below (mutation-sensitive: breaking the scanner's
 * dependency-array or call-argument detection fails these).
 */
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanForI18nFreezeViolations } from "./helpers/i18nFreezeGuardScan";
import { I18N_FREEZE_GUARD_ALLOWLIST } from "./helpers/i18nFreezeGuardAllowlist";

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
  scratchDir = mkdtempSync(path.join(tmpdir(), "i18n-freeze-guard-"));
  const file = path.join(scratchDir, "Fixture.tsx");
  writeFileSync(file, contents, "utf8");
  return scratchDir;
};

describe("i18n-freeze guard scanner (synthetic fixtures)", () => {
  describe("Klasse 1: t in a loader's dependency array", () => {
    it("flags a bare `t` in a useCallback dependency array", () => {
      const dir = writeFixture(`
        const loadThing = useCallback(async () => {
          console.log(t("x"));
        }, [id, t]);
      `);
      const violations = scanForI18nFreezeViolations(dir);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("loader-dep");
    });

    it("flags a bare `t` in a useEffect dependency array", () => {
      const dir = writeFixture(`
        useEffect(() => {
          void loadThing();
        }, [loadThing, t]);
      `);
      const violations = scanForI18nFreezeViolations(dir);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("loader-dep");
    });

    it("does NOT flag `t` in a useMemo dependency array (render-derived value, not a loader)", () => {
      // Mirrors UserConnectionsPage's oauthErrorMessage: a useMemo that
      // translates purely for render is correct to depend on `t` and
      // re-run on every language switch. Flagging it would be a false
      // positive (AC3 of task a34078b6 Slice 3).
      const dir = writeFixture(`
        const oauthErrorMessage = useMemo(() => {
          if (!oauthError) return null;
          return t("userConnections.oauth.failed");
        }, [oauthError, t]);
      `);
      expect(scanForI18nFreezeViolations(dir)).toEqual([]);
    });

    it("does NOT flag `tRef` (the useLatest ref, a different identifier) in a useCallback deps array", () => {
      const dir = writeFixture(`
        const loadThing = useCallback(async () => {
          console.log(tRef.current("x"));
        }, [id, tRef]);
      `);
      expect(scanForI18nFreezeViolations(dir)).toEqual([]);
    });

    it("does NOT flag a useCallback/useEffect whose deps array has no `t` at all", () => {
      const dir = writeFixture(`
        const loadThing = useCallback(async () => {
          console.log("no t here");
        }, [id, projectId]);
      `);
      expect(scanForI18nFreezeViolations(dir)).toEqual([]);
    });
  });

  describe("Klasse 2: t(...) as an eager-translate call argument", () => {
    it("flags t(...) as a direct argument to a set<X> state setter", () => {
      const dir = writeFixture(`
        setRunError(t("plugins.screening.error.upload"));
      `);
      const violations = scanForI18nFreezeViolations(dir);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("eager-translate");
    });

    it("flags t(...) as a direct argument to toast.success", () => {
      const dir = writeFixture(`
        toast.success(t("plugins.screening.toast.uploaded"));
      `);
      const violations = scanForI18nFreezeViolations(dir);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("eager-translate");
    });

    it("flags t(...) as a direct argument to toast.error", () => {
      const dir = writeFixture(`
        toast.error(t("plugins.screening.error.upload"));
      `);
      expect(scanForI18nFreezeViolations(dir)).toHaveLength(1);
    });

    it("flags t(...) as a direct argument to toast.loading", () => {
      const dir = writeFixture(`
        toast.loading(t("plugins.screening.loading"));
      `);
      expect(scanForI18nFreezeViolations(dir)).toHaveLength(1);
    });

    it("flags t(...) inside a conditional expression argument", () => {
      const dir = writeFixture(`
        toast.success(linked ? t("projects.plugins.toastLinked") : t("projects.plugins.toastUnlinked"));
      `);
      expect(scanForI18nFreezeViolations(dir)).toHaveLength(1);
    });

    it("does NOT flag a setter storing a translation key object (the fixed pattern)", () => {
      const dir = writeFixture(`
        setRunError({ key: "plugins.screening.error.upload" });
      `);
      expect(scanForI18nFreezeViolations(dir)).toEqual([]);
    });

    it("does NOT flag toastT.success/error (the fixed helper, takes a raw key)", () => {
      const dir = writeFixture(`
        toastT.success("plugins.screening.toast.uploaded");
        toastT.error("plugins.screening.error.upload");
      `);
      expect(scanForI18nFreezeViolations(dir)).toEqual([]);
    });

    it("does NOT flag a setter given an identifier built from t(...) earlier (no data-flow analysis, matches safeNavGuardScan's precedent)", () => {
      const dir = writeFixture(`
        const message = err instanceof Error ? err.message : t("plugins.screening.error.upload");
        setRunError(message);
      `);
      expect(scanForI18nFreezeViolations(dir)).toEqual([]);
    });

    it("does NOT flag an unrelated function call named like a setter prefix without the capital letter", () => {
      const dir = writeFixture(`
        settle(t("x"));
      `);
      expect(scanForI18nFreezeViolations(dir)).toEqual([]);
    });
  });

  it("also walks plain .ts files (not just .tsx)", () => {
    scratchDir = mkdtempSync(path.join(tmpdir(), "i18n-freeze-guard-"));
    writeFileSync(
      path.join(scratchDir, "helper.ts"),
      `
        export const go = () => {
          setStatus(t("x"));
        };
      `,
      "utf8",
    );
    const violations = scanForI18nFreezeViolations(scratchDir);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("helper.ts");
  });
});

describe("i18n-freeze guard repo invariant", () => {
  it("client/src has zero NEW violations beyond the tracked allowlist", () => {
    // Instrument-must-be-able-to-fail: prove the scan is non-vacuous first.
    const violations = scanForI18nFreezeViolations(srcRoot);
    expect(violations.length).toBeGreaterThan(0);

    const allowed = new Set(
      I18N_FREEZE_GUARD_ALLOWLIST.map((entry) => `${entry.file}:${entry.line}:${entry.kind}`),
    );
    const unexpected = violations.filter(
      (violation) => !allowed.has(`${violation.file}:${violation.line}:${violation.kind}`),
    );
    expect(unexpected).toEqual([]);
  });

  it("every allowlist entry still corresponds to a real, currently-reported violation", () => {
    // Keeps the allowlist honest: a stale entry (line moved, call site
    // fixed without removing its entry, typo'd file/line) would otherwise
    // silently stop doing anything. This is not part of AC3's own
    // acceptance test, but keeps the allowlist from rotting.
    const violations = scanForI18nFreezeViolations(srcRoot);
    const reported = new Set(
      violations.map((violation) => `${violation.file}:${violation.line}:${violation.kind}`),
    );
    const staleEntries = I18N_FREEZE_GUARD_ALLOWLIST.filter(
      (entry) => !reported.has(`${entry.file}:${entry.line}:${entry.kind}`),
    );
    expect(staleEntries).toEqual([]);
  });
});
