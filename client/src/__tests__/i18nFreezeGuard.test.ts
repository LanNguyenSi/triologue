/**
 * Repo-wide invariant, following safeNavGuard.test.ts's pattern (task
 * 67d3cf19, PR #219): client/src must not reintroduce either `t`-freeze
 * pattern (see helpers/i18nFreezeGuardScan.ts for exactly what each
 * pattern is and why it's a bug). A NEW call site anywhere in the tree
 * that reintroduces either pattern fails this test, not just the sites
 * already fixed.
 *
 * The scanner's true-positive/true-negative behaviour is covered against
 * synthetic fixtures below (mutation-sensitive: breaking the scanner's
 * dependency-array or call-argument detection fails these), including the
 * review-round-2 additions (object literals, template literals, binary/
 * conditional operands, bare `toast(...)`, `useLayoutEffect`, `as const`
 * deps, and the opt-out comment) and the allowlist's snippet-keyed
 * matching (mutation-sensitive to it being line-independent and failing
 * closed in both directions), including the review-round-3 `count`
 * multiset fixtures (F1 below): two byte-identical call sites collapse to
 * the same file+kind+snippet key, so matching must count occurrences, not
 * just check Set membership.
 */
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  scanForI18nFreezeViolations,
  type I18nFreezeViolation,
} from "./helpers/i18nFreezeGuardScan";
import {
  I18N_FREEZE_GUARD_ALLOWLIST,
  type I18nFreezeGuardAllowlistEntry,
} from "./helpers/i18nFreezeGuardAllowlist";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(testDir, "..");

let scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  scratchDirs = [];
});

const writeFixture = (contents: string, fileName = "Fixture.tsx"): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "i18n-freeze-guard-"));
  scratchDirs.push(dir);
  writeFileSync(path.join(dir, fileName), contents, "utf8");
  return dir;
};

/** Same key shape the repo invariant tests (and the real guard) match on. */
const violationKey = (v: I18nFreezeViolation) =>
  `${v.file}:${v.kind}:${v.normalizedSnippet}`;
const allowlistKey = (e: Pick<I18nFreezeGuardAllowlistEntry, "file" | "kind" | "snippet">) =>
  `${e.file}:${e.kind}:${e.snippet}`;

type AllowlistLike = Pick<I18nFreezeGuardAllowlistEntry, "file" | "kind" | "snippet" | "count">;

/**
 * Matching is a MULTISET comparison, not set membership: the file+kind+
 * snippet key is not guaranteed unique (two byte-identical call sites in
 * the same file collapse to the same key), so a plain Set would let one of
 * two identical violations be fixed without its entry ever going stale, and
 * would let a second, new identical violation land next to an allowlisted
 * one without ever being reported (see i18nFreezeGuardAllowlist.ts's
 * module doc comment, and this file's F1 fixture tests below).
 */
function findUnexpected(
  violations: I18nFreezeViolation[],
  allowlist: AllowlistLike[],
): I18nFreezeViolation[] {
  const allowedCounts = new Map(allowlist.map((e) => [allowlistKey(e), e.count ?? 1]));
  const grouped = new Map<string, I18nFreezeViolation[]>();
  for (const v of violations) {
    const key = violationKey(v);
    const group = grouped.get(key);
    if (group) group.push(v);
    else grouped.set(key, [v]);
  }

  const unexpected: I18nFreezeViolation[] = [];
  for (const [key, group] of grouped) {
    const allowed = allowedCounts.get(key) ?? 0;
    if (group.length > allowed) unexpected.push(...group.slice(allowed));
  }
  return unexpected;
}

function findStale(
  violations: I18nFreezeViolation[],
  allowlist: AllowlistLike[],
): AllowlistLike[] {
  const observedCounts = new Map<string, number>();
  for (const v of violations) {
    const key = violationKey(v);
    observedCounts.set(key, (observedCounts.get(key) ?? 0) + 1);
  }
  return allowlist.filter((e) => (observedCounts.get(allowlistKey(e)) ?? 0) < (e.count ?? 1));
}

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

    it("flags a bare `t` in a useLayoutEffect dependency array", () => {
      const dir = writeFixture(`
        useLayoutEffect(() => {
          document.title = computeTitle();
        }, [computeTitle, t]);
      `);
      const violations = scanForI18nFreezeViolations(dir);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("loader-dep");
    });

    it("flags a bare `t` inside an `as const` dependency array", () => {
      const dir = writeFixture(`
        const loadThing = useCallback(async () => {
          console.log(t("x"));
        }, [id, t] as const);
      `);
      const violations = scanForI18nFreezeViolations(dir);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("loader-dep");
    });

    it("does NOT flag `t` in a useMemo dependency array (render-derived value, not a loader)", () => {
      // Mirrors UserConnectionsPage's oauthErrorMessage: a useMemo that
      // translates purely for render is correct to depend on `t` and
      // re-run on every language switch. Flagging it would be a false
      // positive.
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

    it("does NOT flag a bare `t` dep when opted out via `// i18n-freeze-guard: intentional`", () => {
      // A legitimate non-loader effect (e.g. one that sets document.title
      // from a translated string) is correct to depend on `t`, unlike a
      // data loader. The opt-out comment is the documented escape hatch
      // for exactly this case (see the scanner's module doc comment).
      const dir = writeFixture(`
        // i18n-freeze-guard: intentional
        useEffect(() => {
          document.title = t("page.title");
        }, [t]);
      `);
      expect(scanForI18nFreezeViolations(dir)).toEqual([]);
    });

    it("F7: a module doc comment merely MENTIONING the marker does not opt out the file's first statement", () => {
      // hasIntentionalOptOut used to check EVERY leading comment range at a
      // position, not just the closest one. For the FIRST statement in a
      // file, that includes the module doc comment at the very top: if it
      // happens to reference the marker text while documenting the
      // opt-out mechanism itself (as this fixture's header does), the
      // first statement was silently exempted even though no one wrote
      // the marker directly above it.
      const dir = writeFixture(`
        /**
         * This file documents the i18n-freeze-guard: intentional marker,
         * the escape hatch for a legitimate non-loader effect.
         */
        useEffect(() => {
          document.title = t("page.title");
        }, [t]);
      `);
      const violations = scanForI18nFreezeViolations(dir);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("loader-dep");
    });

    it("does NOT flag `translate` (an aliased `t`, a documented blind spot)", () => {
      const dir = writeFixture(`
        const { t: translate } = useLanguage();
        const loadThing = useCallback(async () => {
          console.log(translate("x"));
        }, [id, translate]);
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

    it("flags t(...) as a direct argument to toast.promise's options object", () => {
      const dir = writeFixture(`
        toast.promise(runUpload(), {
          loading: t("plugins.screening.uploading"),
          success: "done",
          error: "failed",
        });
      `);
      const violations = scanForI18nFreezeViolations(dir);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("eager-translate");
    });

    it("flags a bare toast(t(...)) call", () => {
      const dir = writeFixture(`
        toast(t("plugins.screening.info"));
      `);
      const violations = scanForI18nFreezeViolations(dir);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("eager-translate");
    });

    it("flags t(...) inside a conditional expression argument", () => {
      const dir = writeFixture(`
        toast.success(linked ? t("projects.plugins.toastLinked") : t("projects.plugins.toastUnlinked"));
      `);
      expect(scanForI18nFreezeViolations(dir)).toHaveLength(1);
    });

    it("flags t(...) as an object literal property initializer", () => {
      const dir = writeFixture(`
        setRunError({ message: t("plugins.screening.error.upload") });
      `);
      const violations = scanForI18nFreezeViolations(dir);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("eager-translate");
    });

    it("flags t(...) inside a template literal argument", () => {
      const dir = writeFixture(
        "setRunError(`Upload failed: ${t(\"plugins.screening.error.upload\")}`);",
      );
      const violations = scanForI18nFreezeViolations(dir);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("eager-translate");
    });

    it("flags t(...) as the fallback operand of a `||` binary expression", () => {
      const dir = writeFixture(`
        toast.error(data.error || t("plugins.screening.error.upload"));
      `);
      const violations = scanForI18nFreezeViolations(dir);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("eager-translate");
    });

    it("flags t(...) as an operand of a `&&` binary expression", () => {
      const dir = writeFixture(`
        toast.error(shouldWarn && t("plugins.screening.error.upload"));
      `);
      const violations = scanForI18nFreezeViolations(dir);
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("eager-translate");
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

    it("does NOT flag toast.custom(...) (its argument is a render callback, not a translated string)", () => {
      const dir = writeFixture(`
        toast.custom(() => renderToast(t("plugins.screening.info")));
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
    const dir = writeFixture(
      `
        export const go = () => {
          setStatus(t("x"));
        };
      `,
      "helper.ts",
    );
    const violations = scanForI18nFreezeViolations(dir);
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("helper.ts");
  });
});

describe("allowlist matching (file + kind + normalized snippet, not line)", () => {
  it("M3: a blank line inserted above the call site does not change its key (stays matched)", () => {
    const before = writeFixture(`
        setRunError(t("plugins.screening.error.upload"));
      `);
    const beforeViolation = scanForI18nFreezeViolations(before)[0];

    const after = writeFixture(`

        setRunError(t("plugins.screening.error.upload"));
      `);
    const afterViolation = scanForI18nFreezeViolations(after)[0];

    expect(afterViolation.line).not.toBe(beforeViolation.line);
    expect(afterViolation.normalizedSnippet).toBe(beforeViolation.normalizedSnippet);

    const allowlist = [
      { file: beforeViolation.file, kind: beforeViolation.kind, snippet: beforeViolation.normalizedSnippet },
    ];
    // Matching against the SAME allowlist entry after the shift: still
    // matched (not unexpected), and the entry is still not stale.
    expect(findUnexpected([afterViolation], allowlist)).toEqual([]);
    expect(findStale([afterViolation], allowlist)).toEqual([]);
  });

  it("M4: a genuinely new violation in an otherwise-allowlisted file is still reported", () => {
    const dir = writeFixture(`
        setRunError(t("plugins.screening.error.upload"));
        setOtherError(t("plugins.screening.error.other"));
      `);
    const violations = scanForI18nFreezeViolations(dir);
    expect(violations).toHaveLength(2);

    const allowlist = [
      { file: violations[0].file, kind: violations[0].kind, snippet: violations[0].normalizedSnippet },
    ];
    const unexpected = findUnexpected(violations, allowlist);
    expect(unexpected).toHaveLength(1);
    expect(unexpected[0].normalizedSnippet).toBe(violations[1].normalizedSnippet);
  });

  it("M5: an allowlisted site that was fixed, without removing its entry, is reported stale", () => {
    const dir = writeFixture(`
        setRunError({ key: "plugins.screening.error.upload" });
      `);
    // The call site above is now the FIXED (key-object) form, so a fresh
    // scan reports no violations at all.
    const violations = scanForI18nFreezeViolations(dir);
    expect(violations).toEqual([]);

    const allowlist = [
      {
        file: "Fixture.tsx",
        kind: "eager-translate" as const,
        snippet: 'setRunError(t("plugins.screening.error.upload"));',
      },
    ];
    expect(findStale(violations, allowlist)).toEqual(allowlist);
  });

  it("F1: two byte-identical violations under one `count: 2` entry; fixing one is reported stale, not silently green", () => {
    const dir = writeFixture(`
        setRunError(t("plugins.screening.error.upload"));
        setRunError(t("plugins.screening.error.upload"));
      `);
    const violations = scanForI18nFreezeViolations(dir);
    expect(violations).toHaveLength(2);

    const allowlist = [
      {
        file: violations[0].file,
        kind: violations[0].kind,
        snippet: violations[0].normalizedSnippet,
        count: 2,
      },
    ];
    // Both still present: neither unexpected nor stale.
    expect(findUnexpected(violations, allowlist)).toEqual([]);
    expect(findStale(violations, allowlist)).toEqual([]);

    // One of the two identical sites gets fixed; only one now remains.
    const fixedDir = writeFixture(`
        setRunError(t("plugins.screening.error.upload"));
      `);
    const afterFix = scanForI18nFreezeViolations(fixedDir);
    expect(afterFix).toHaveLength(1);
    expect(findStale(afterFix, allowlist)).toEqual(allowlist);
  });

  it("F1: a second, new identical violation next to a `count: 1` entry is reported unexpected, not silently green", () => {
    const dir = writeFixture(`
        setRunError(t("plugins.screening.error.upload"));
      `);
    const violations = scanForI18nFreezeViolations(dir);
    expect(violations).toHaveLength(1);

    const allowlist = [
      {
        file: violations[0].file,
        kind: violations[0].kind,
        snippet: violations[0].normalizedSnippet,
        count: 1,
      },
    ];
    expect(findUnexpected(violations, allowlist)).toEqual([]);

    // A second, NEW call site with the exact same normalized text is added.
    const dirWithNew = writeFixture(`
        setRunError(t("plugins.screening.error.upload"));
        setRunError(t("plugins.screening.error.upload"));
      `);
    const afterAdd = scanForI18nFreezeViolations(dirWithNew);
    expect(afterAdd).toHaveLength(2);
    const unexpected = findUnexpected(afterAdd, allowlist);
    expect(unexpected).toHaveLength(1);
  });
});

describe("i18n-freeze guard repo invariant", () => {
  it("client/src has zero NEW violations beyond the tracked allowlist", () => {
    // Instrument-must-be-able-to-fail: prove the scan is non-vacuous first.
    const violations = scanForI18nFreezeViolations(srcRoot);
    expect(violations.length).toBeGreaterThan(0);

    const unexpected = findUnexpected(violations, I18N_FREEZE_GUARD_ALLOWLIST);
    expect(unexpected).toEqual([]);
  });

  it("every allowlist entry still corresponds to a real, currently-reported violation", () => {
    // Keeps the allowlist honest: a stale entry (call site fixed without
    // removing its entry, typo'd file/snippet) would otherwise silently
    // stop doing anything.
    const violations = scanForI18nFreezeViolations(srcRoot);
    const staleEntries = findStale(violations, I18N_FREEZE_GUARD_ALLOWLIST);
    expect(staleEntries).toEqual([]);
  });
});
