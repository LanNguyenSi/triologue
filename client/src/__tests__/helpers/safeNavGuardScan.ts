/**
 * AST-based scanner enforcing that every `<Link to={...}>` and every
 * `navigate(...)` call site in client/src passes a non-literal navigation
 * target through `safeNavTarget` before it reaches the router.
 *
 * Context (review finding on PR #202, task 67d3cf19): the `safeNavTarget`
 * helper (client/src/lib/safeNavTarget.ts) is well tested in isolation, but
 * nothing enforced that call sites actually used it. Each of the 6 call
 * sites that guard a plugin- or server-supplied navigation target could be
 * reverted to the raw, unguarded value and the suite would stay green. This
 * scanner closes that gap the same way iconOnlyButtonScan.ts closes the
 * a11y one: walk the real AST of every .tsx file and flag any call site that
 * is not provably safe, instead of re-checking a frozen list of already-fixed
 * files (which a brand-new unguarded call site anywhere else would slip
 * past).
 *
 * A `to`/`navigate` argument is considered safe, and NOT required to go
 * through `safeNavTarget`, only when it is one of:
 *   - a string literal or no-substitution template literal (`"/inbox"`,
 *     `` `/inbox` ``): fully author-controlled, nothing to guard.
 *   - a template literal whose literal head already starts with exactly one
 *     `/` followed by at least one literal character that is not itself `/`
 *     or `\` (e.g. `` `/room/${room.id}` ``). The head must contain a real
 *     literal character after the slash, not just end there: a head of
 *     exactly `"/"` (e.g. `` `/${x}` ``) is REJECTED by this rule, because
 *     the substitution occupies the position right after the slash and
 *     `/${'/evil.example.com'}` resolves to `//evil.example.com`, a foreign
 *     origin. With a real literal character in that position instead,
 *     whatever the substitution resolves to, the result can never start with
 *     `//` or `/\`, so it cannot escape to another origin, the same
 *     containment argument `isSafeNavTarget` itself relies on, just applied
 *     to the literal prefix instead of the whole string.
 *   - a numeric literal, or a unary-minus numeric literal (`navigate(-1)`):
 *     that is a history-delta call, not a path, and is out of scope for this
 *     guard.
 *   - a conditional expression (`cond ? a : b`) where both branches are
 *     themselves safe by these rules (recursively).
 *   - a call to `safeNavTarget(...)`: the explicit, guarded escape hatch.
 *
 * Everything else (a bare identifier, a property access, a function call
 * other than `safeNavTarget`, a template literal with a non-literal or
 * empty head, ...) is flagged. This is deliberately strict rather than
 * trying to prove particular identifiers are "obviously" locally-literal:
 * wrapping an already-safe value in `safeNavTarget` is a no-op (it returns
 * the value unchanged), so there is no correctness cost to requiring the
 * wrap everywhere, and it removes the need for data-flow analysis this
 * scanner cannot do reliably.
 *
 * Also flags `<Navigate to={...}>` (react-router-dom's declarative redirect
 * element) under the same rules as `<Link to={...}>`, and walks `.ts` files
 * in addition to `.tsx` (a call site does not need JSX to call `navigate`).
 *
 * Known blind spots (not covered by this scanner, listed so a reviewer or a
 * future change does not mistake silence here for safety):
 *   - JSX spread props (`<Link {...linkProps} />`): the `to` value is not a
 *     literal attribute the AST walk can see.
 *   - An aliased `navigate` (`const nav = useNavigate(); nav(x)`): only the
 *     identifier `navigate` is recognised as the call target.
 *   - A member-expression callee (`router.navigate(x)`, `history.push(x)`):
 *     only a bare identifier call is recognised.
 *   - Direct `window.location` assignment (`window.location.href = x`,
 *     `window.location.assign(x)`): entirely outside this scanner's scope,
 *     which only looks at `<Link>`/`<Navigate>`/`navigate(...)`.
 */
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface NavGuardViolation {
  file: string;
  line: number;
  kind: "Link" | "Navigate" | "navigate";
  snippet: string;
}

const SAFE_NAV_WRAPPER = "safeNavTarget";

function isLiteralPrefixedTemplate(node: ts.TemplateExpression): boolean {
  // Requires an actual literal character after the leading slash, not just
  // the slash itself. A head of exactly "/" (e.g. `/${x}`) must NOT match:
  // `/^\/(?![/\\])/` matches it too (the negative lookahead is vacuously true
  // at end-of-string), which would silently allowlist
  // `/${'/evil.example.com'}` === '//evil.example.com'.
  return /^\/[^/\\]/.test(node.head.text);
}

function isSafeExpression(expr: ts.Expression): boolean {
  const inner = ts.isParenthesizedExpression(expr) ? expr.expression : expr;

  // String literal or no-substitution template literal: fully author-known.
  if (ts.isStringLiteralLike(inner)) return true;

  // navigate(-1) / navigate(1): a history delta, not a path.
  if (ts.isNumericLiteral(inner)) return true;
  if (
    ts.isPrefixUnaryExpression(inner) &&
    (inner.operator === ts.SyntaxKind.MinusToken || inner.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(inner.operand)
  ) {
    return true;
  }

  // Template literal with a literal, path-absolute, single-slash head:
  // the substitution(s) can never reach position 0.
  if (ts.isTemplateExpression(inner)) return isLiteralPrefixedTemplate(inner);

  // Both branches must independently be safe.
  if (ts.isConditionalExpression(inner)) {
    return isSafeExpression(inner.whenTrue) && isSafeExpression(inner.whenFalse);
  }

  // Explicitly wrapped.
  if (ts.isCallExpression(inner)) {
    const callee = inner.expression;
    if (ts.isIdentifier(callee) && callee.text === SAFE_NAV_WRAPPER) return true;
  }

  return false;
}

const NAV_ELEMENT_TAGS = new Set(["Link", "Navigate"]);

function checkLinkElement(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  relFile: string,
  sourceFile: ts.SourceFile,
  violations: NavGuardViolation[],
): void {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const tagName = opening.tagName.getText();
  if (!NAV_ELEMENT_TAGS.has(tagName)) return;

  for (const prop of opening.attributes.properties) {
    if (!ts.isJsxAttribute(prop)) continue;
    if (prop.name.getText() !== "to") continue;
    const init = prop.initializer;
    if (!init) continue; // bare `to` shorthand, not a navigation target here
    if (ts.isStringLiteral(init)) continue; // to="/literal", always safe

    if (ts.isJsxExpression(init) && init.expression && !isSafeExpression(init.expression)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(prop.getStart(sourceFile));
      violations.push({
        file: relFile,
        line: line + 1,
        kind: tagName as "Link" | "Navigate",
        snippet: prop.getText(sourceFile).slice(0, 160),
      });
    }
  }
}

function checkNavigateCall(
  node: ts.CallExpression,
  relFile: string,
  sourceFile: ts.SourceFile,
  violations: NavGuardViolation[],
): void {
  const callee = node.expression;
  if (!ts.isIdentifier(callee) || callee.text !== "navigate") return;
  const arg = node.arguments[0];
  if (!arg) return;
  if (!isSafeExpression(arg)) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push({
      file: relFile,
      line: line + 1,
      kind: "navigate",
      snippet: node.getText(sourceFile).slice(0, 160),
    });
  }
}

function scanSourceFile(
  sourceFile: ts.SourceFile,
  relFile: string,
  violations: NavGuardViolation[],
): void {
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      checkLinkElement(node, relFile, sourceFile, violations);
    }
    if (ts.isCallExpression(node)) {
      checkNavigateCall(node, relFile, sourceFile, violations);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

/**
 * Collects every `.ts`/`.tsx` file under `rootDir` (recursively, skipping
 * the given directory names and `.d.ts` declaration files). Local to this
 * scanner rather than shared with iconOnlyButtonScan.ts's collectTsxFiles,
 * which intentionally stays .tsx-only for its own (JSX-only) concern.
 */
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
 * node_modules/__tests__/dist by default) for `<Link to={...}>` /
 * `<Navigate to={...}>` / `navigate(...)` call sites whose target is not
 * provably safe. Returns one entry per violation found.
 */
export function scanForUnguardedNavTargets(
  rootDir: string,
  options: { excludeDirNames?: string[] } = {},
): NavGuardViolation[] {
  const excludeDirNames = new Set(
    options.excludeDirNames ?? ["node_modules", "__tests__", "dist"],
  );
  const files = collectTsAndTsxFiles(rootDir, excludeDirNames);
  const violations: NavGuardViolation[] = [];

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
