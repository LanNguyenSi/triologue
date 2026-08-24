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
 *     `` `/inbox` ``) — fully author-controlled, nothing to guard.
 *   - a template literal whose literal head already starts with exactly one
 *     `/` not itself followed by `/` or `\` (e.g. `` `/room/${room.id}` ``).
 *     Whatever the substitution resolves to, the result can never start with
 *     `//` or `/\`, so it cannot escape to another origin — the same
 *     containment argument `isSafeNavTarget` itself relies on, just applied
 *     to the literal prefix instead of the whole string.
 *   - a numeric literal, or a unary-minus numeric literal (`navigate(-1)`):
 *     that is a history-delta call, not a path, and is out of scope for this
 *     guard.
 *   - a conditional expression (`cond ? a : b`) where both branches are
 *     themselves safe by these rules (recursively).
 *   - a call to `safeNavTarget(...)` — the explicit, guarded escape hatch.
 *
 * Everything else (a bare identifier, a property access, a function call
 * other than `safeNavTarget`, a template literal with a non-literal or
 * empty head, ...) is flagged. This is deliberately strict rather than
 * trying to prove particular identifiers are "obviously" locally-literal:
 * wrapping an already-safe value in `safeNavTarget` is a no-op (it returns
 * the value unchanged), so there is no correctness cost to requiring the
 * wrap everywhere, and it removes the need for data-flow analysis this
 * scanner cannot do reliably.
 */
import ts from "typescript";
import { readFileSync } from "node:fs";
import path from "node:path";
import { collectTsxFiles } from "./iconOnlyButtonScan";

export interface NavGuardViolation {
  file: string;
  line: number;
  kind: "Link" | "navigate";
  snippet: string;
}

const SAFE_NAV_WRAPPER = "safeNavTarget";

function isLiteralPrefixedTemplate(node: ts.TemplateExpression): boolean {
  return /^\/(?![/\\])/.test(node.head.text);
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

function checkLinkElement(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  relFile: string,
  sourceFile: ts.SourceFile,
  violations: NavGuardViolation[],
): void {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  if (opening.tagName.getText() !== "Link") return;

  for (const prop of opening.attributes.properties) {
    if (!ts.isJsxAttribute(prop)) continue;
    if (prop.name.getText() !== "to") continue;
    const init = prop.initializer;
    if (!init) continue; // bare `to` shorthand — not a navigation target here
    if (ts.isStringLiteral(init)) continue; // to="/literal" — always safe

    if (ts.isJsxExpression(init) && init.expression && !isSafeExpression(init.expression)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(prop.getStart(sourceFile));
      violations.push({
        file: relFile,
        line: line + 1,
        kind: "Link",
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
 * Scans every .tsx file under `rootDir` (recursively, skipping
 * node_modules/__tests__/dist by default) for `<Link to={...}>` / `navigate(...)`
 * call sites whose target is not provably safe. Returns one entry per
 * violation found.
 */
export function scanForUnguardedNavTargets(
  rootDir: string,
  options: { excludeDirNames?: string[] } = {},
): NavGuardViolation[] {
  const excludeDirNames = new Set(
    options.excludeDirNames ?? ["node_modules", "__tests__", "dist"],
  );
  const files = collectTsxFiles(rootDir, excludeDirNames);
  const violations: NavGuardViolation[] = [];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    );
    const relFile = path.relative(rootDir, file);
    scanSourceFile(sourceFile, relFile, violations);
  }

  return violations;
}
