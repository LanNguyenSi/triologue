/**
 * AST-based scanner enforcing the two `t` (LanguageContext's translation
 * function) freeze patterns task a34078b6 exists to close, repo-wide under
 * client/src. Follows safeNavGuardScan.ts's approach (task 67d3cf19, PR
 * #219): walk the real TypeScript AST of every .ts/.tsx file instead of
 * re-checking a frozen list of already-fixed call sites, so a NEW call site
 * anywhere else in the tree that reintroduces either pattern is caught, not
 * just the ones fixed so far.
 *
 * Klasse 1 ("loader-dep"): a bare `t` identifier in the dependency array of
 * a `useCallback` or `useEffect` call. LanguageProvider memoises `t` per
 * language (#222), so its identity legitimately changes on every real
 * language switch; putting it in a loader's deps re-fires that loader's
 * effect and refetches data for no reason (PR #223, #225, #226, and this
 * task's Slice 1-3 all fixed instances of exactly this). The fix is to read
 * `t` through a `useLatest(t)` ref inside the callback body instead
 * (client/src/hooks/useLatest.ts) and drop `t` from the deps array.
 *
 * `useMemo` is deliberately NOT covered: a `useMemo` that derives a
 * translated value purely for render (e.g. UserConnectionsPage's
 * `oauthErrorMessage`) is CORRECT to depend on `t` and re-run on every
 * language switch; it does not write a translated string into persisted
 * state and is not a data loader. Flagging it would be a false positive
 * (AC3 of task a34078b6 Slice 3 requires zero such false positives).
 *
 * Klasse 2 ("eager-translate"): `t(...)` called directly as an argument to
 * a `set<Something>(...)` state setter or to `toast.success/error/loading
 * (...)`. Both store the ALREADY-TRANSLATED string (not the key), which
 * freezes at whatever language was active the moment the call ran: a later
 * language switch never retranslates it. The fix is to store the
 * translation KEY (see PluginWorkspacePage's `RunError` union and
 * FilesPage's `RuntimeError`, or client/src/lib/i18nToast.tsx's `toastT`
 * for toasts) and translate at render/display time instead.
 *
 * Like safeNavGuardScan, this deliberately does NOT attempt data-flow
 * analysis: `setRunError(message)` where `message` was built from `t(...)`
 * a few lines earlier is not flagged (mirrors safeNavGuardScan's explicit
 * choice not to trace identifiers back to their definition). A `t(...)`
 * call is flagged when it appears directly as the argument, optionally
 * through: a parenthesised expression; one level of `cond ? a : b`; a
 * binary expression operand (e.g. `t(k) || fallback`, `cond && t(k)`); a
 * template literal span (`` `${t(k)}` ``); or an object literal property
 * initializer (`{ message: t(k) }`).
 *
 * Documented blind spots (not covered, by design, same rationale as the
 * data-flow exclusion above):
 *   - An ALIASED `t`, e.g. `const { t: translate } = useLanguage()`: the
 *     scanner only recognises the bare identifier `t`, not a renamed
 *     destructure. A loader depending on `translate` or a sink called with
 *     `translate(...)` is not flagged.
 *   - Any other data-flow through an intermediate variable, function
 *     argument, or object spread (e.g. `const msg = t(k); setX(msg)`, or
 *     `setX(...buildPayload(t(k)))`).
 *   - `toast.custom(...)`: its argument is normally a render callback, not
 *     a translated string, so it is not treated as a freeze sink.
 *
 * An inline `// i18n-freeze-guard: intentional` comment directly above a
 * `useCallback`/`useEffect`/`useLayoutEffect` call (or above the enclosing
 * `const x = ...` / expression statement) opts that hook out of the
 * loader-dep check: a legitimate non-loader effect that depends on `t` for
 * a reason other than data loading (e.g. `document.title = t(...)`) is not
 * a bug and would otherwise be a false positive.
 */
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface I18nFreezeViolation {
  file: string;
  line: number;
  kind: "loader-dep" | "eager-translate";
  /** Truncated (160 chars), NOT whitespace-normalized: for human-readable error output only. */
  snippet: string;
  /** Whitespace-collapsed, untruncated call/dep-array text: the allowlist matching key (see i18nFreezeGuardAllowlist.ts). */
  normalizedSnippet: string;
}

/**
 * Collapses all whitespace runs (including newlines/indentation) to a
 * single space and trims. Used so the allowlist can key on WHAT a call
 * site looks like rather than WHERE it sits: reformatting or an unrelated
 * line inserted above (see i18nFreezeGuardAllowlist.ts's doc comment for
 * why file:line churns) does not change a call site's normalized text.
 */
export function normalizeSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const DEP_HOOKS = new Set(["useCallback", "useEffect", "useLayoutEffect"]);
const TOAST_METHODS = new Set(["success", "error", "loading", "promise"]);
const SETTER_RE = /^set[A-Z]\w*$/;
const OPT_OUT_MARKER = "i18n-freeze-guard: intentional";

function containsBareTranslationCall(expr: ts.Expression): boolean {
  const inner = ts.isParenthesizedExpression(expr) ? expr.expression : expr;

  if (ts.isCallExpression(inner)) {
    const callee = inner.expression;
    if (ts.isIdentifier(callee) && callee.text === "t") return true;
    return false;
  }

  if (ts.isConditionalExpression(inner)) {
    return (
      containsBareTranslationCall(inner.whenTrue) ||
      containsBareTranslationCall(inner.whenFalse)
    );
  }

  if (ts.isBinaryExpression(inner)) {
    return (
      containsBareTranslationCall(inner.left) ||
      containsBareTranslationCall(inner.right)
    );
  }

  if (ts.isTemplateExpression(inner)) {
    return inner.templateSpans.some((span) =>
      containsBareTranslationCall(span.expression),
    );
  }

  if (ts.isObjectLiteralExpression(inner)) {
    return inner.properties.some(
      (prop) =>
        ts.isPropertyAssignment(prop) &&
        containsBareTranslationCall(prop.initializer),
    );
  }

  return false;
}

/**
 * True when `node` (or the statement it lives in) is directly preceded by
 * an `// i18n-freeze-guard: intentional` comment. See the module doc
 * comment above for what this opts out of and why.
 */
function hasIntentionalOptOut(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const text = sourceFile.text;
  const positions = new Set<number>([node.getFullStart()]);

  let statementCandidate: ts.Node | undefined = node;
  while (statementCandidate && !ts.isStatement(statementCandidate)) {
    statementCandidate = statementCandidate.parent;
  }
  if (statementCandidate) positions.add(statementCandidate.getFullStart());

  for (const pos of positions) {
    const ranges = ts.getLeadingCommentRanges(text, pos) ?? [];
    for (const range of ranges) {
      if (text.slice(range.pos, range.end).includes(OPT_OUT_MARKER)) return true;
    }
  }
  return false;
}

function checkDepHookCall(
  node: ts.CallExpression,
  relFile: string,
  sourceFile: ts.SourceFile,
  violations: I18nFreezeViolation[],
): void {
  const callee = node.expression;
  if (!ts.isIdentifier(callee) || !DEP_HOOKS.has(callee.text)) return;

  let depsArg = node.arguments[node.arguments.length - 1];
  if (depsArg && ts.isAsExpression(depsArg)) {
    // `[id, t] as const`: unwrap the `as const` to see the array literal.
    depsArg = depsArg.expression;
  }
  if (!depsArg || !ts.isArrayLiteralExpression(depsArg)) return;

  const hasBareT = depsArg.elements.some(
    (element) => ts.isIdentifier(element) && element.text === "t",
  );
  if (!hasBareT) return;

  if (hasIntentionalOptOut(node, sourceFile)) return;

  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const fullText = node.getText(sourceFile);
  violations.push({
    file: relFile,
    line: line + 1,
    kind: "loader-dep",
    snippet: fullText.slice(0, 160),
    normalizedSnippet: normalizeSnippet(fullText),
  });
}

function isTranslateFreezeSink(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) {
    // A bare `toast(...)` call (react-hot-toast's default export) is a
    // freeze sink exactly like `toast.success/error/loading/promise(...)`.
    return SETTER_RE.test(callee.text) || callee.text === "toast";
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const object = callee.expression;
    return (
      ts.isIdentifier(object) &&
      object.text === "toast" &&
      TOAST_METHODS.has(callee.name.text)
    );
  }
  return false;
}

function checkFreezeSinkCall(
  node: ts.CallExpression,
  relFile: string,
  sourceFile: ts.SourceFile,
  violations: I18nFreezeViolation[],
): void {
  if (!isTranslateFreezeSink(node.expression)) return;

  const hasUnsafeArg = node.arguments.some((arg) => containsBareTranslationCall(arg));
  if (!hasUnsafeArg) return;

  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const fullText = node.getText(sourceFile);
  violations.push({
    file: relFile,
    line: line + 1,
    kind: "eager-translate",
    snippet: fullText.slice(0, 160),
    normalizedSnippet: normalizeSnippet(fullText),
  });
}

function scanSourceFile(
  sourceFile: ts.SourceFile,
  relFile: string,
  violations: I18nFreezeViolation[],
): void {
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      checkDepHookCall(node, relFile, sourceFile, violations);
      checkFreezeSinkCall(node, relFile, sourceFile, violations);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function collectTsAndTsxFiles(rootDir: string, excludeDirNames: Set<string>): string[] {
  const results: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (excludeDirNames.has(entry)) continue;
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".tsx") || (entry.endsWith(".ts") && !entry.endsWith(".d.ts"))) {
        results.push(full);
      }
    }
  };
  walk(rootDir);
  return results;
}

/**
 * Scans every .ts/.tsx file under `rootDir` (recursively, skipping
 * node_modules/__tests__/dist by default) for the two `t`-freeze patterns
 * described above. Returns one entry per violation found.
 */
export function scanForI18nFreezeViolations(
  rootDir: string,
  options: { excludeDirNames?: string[] } = {},
): I18nFreezeViolation[] {
  const excludeDirNames = new Set(
    options.excludeDirNames ?? ["node_modules", "__tests__", "dist"],
  );
  const files = collectTsAndTsxFiles(rootDir, excludeDirNames);
  const violations: I18nFreezeViolation[] = [];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const relFile = path.relative(rootDir, file);
    scanSourceFile(sourceFile, relFile, violations);
  }

  return violations;
}
