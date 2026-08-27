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
 * choice not to trace identifiers back to their definition). Only a `t(...)`
 * call appearing directly as the argument (optionally through a
 * parenthesised expression or one level of `cond ? a : b`) is flagged.
 */
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface I18nFreezeViolation {
  file: string;
  line: number;
  kind: "loader-dep" | "eager-translate";
  snippet: string;
}

const DEP_HOOKS = new Set(["useCallback", "useEffect"]);
const TOAST_METHODS = new Set(["success", "error", "loading"]);
const SETTER_RE = /^set[A-Z]\w*$/;

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

  const depsArg = node.arguments[node.arguments.length - 1];
  if (!depsArg || !ts.isArrayLiteralExpression(depsArg)) return;

  const hasBareT = depsArg.elements.some(
    (element) => ts.isIdentifier(element) && element.text === "t",
  );
  if (!hasBareT) return;

  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  violations.push({
    file: relFile,
    line: line + 1,
    kind: "loader-dep",
    snippet: node.getText(sourceFile).slice(0, 160),
  });
}

function isTranslateFreezeSink(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return SETTER_RE.test(callee.text);
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
  violations.push({
    file: relFile,
    line: line + 1,
    kind: "eager-translate",
    snippet: node.getText(sourceFile).slice(0, 160),
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
