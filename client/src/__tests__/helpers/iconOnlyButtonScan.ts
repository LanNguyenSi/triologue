/**
 * AST-based scanner for icon-only <button>/<Button> elements that carry no
 * accessible name (no aria-label, aria-labelledby, or title).
 *
 * This is the repo-wide INVARIANT guard for a11y round 2 (task 74d695bb):
 * instead of a frozen list of already-fixed call sites (which a NEW nameless
 * icon-only button anywhere in client/src would silently slip past), this
 * walks every .tsx file's real AST (via the TypeScript compiler API, already
 * a devDependency) and flags any <button>/<Button> whose only children are
 * heroicons-style icon components (component name ending in "Icon") with no
 * non-whitespace text and no aria-label/aria-labelledby/title attribute.
 *
 * Deliberately conservative to avoid false positives on the existing (green)
 * codebase:
 *   - `title`-only buttons count as named (functionally OK; out of scope per
 *     task spec even though aria-label would be the more idiomatic AT name).
 *   - A spread attribute ({...rest}) is assumed to possibly carry a name at
 *     runtime, so it counts as named.
 *   - Any child that is not clearly "only icon components" (e.g. a
 *     conditional expression, plain text, a non-Icon-suffixed element)
 *     disqualifies the element from being flagged, erring toward missing a
 *     real violation rather than flagging a false one.
 *   - Self-closing <button/>/<Button/> (no children) are never flagged: with
 *     no children to inspect, "icon-only" cannot be determined from the AST
 *     alone in this codebase's usage patterns.
 */
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface IconOnlyViolation {
  file: string;
  line: number;
  tag: string;
}

const ICON_TAG_RE = /Icon$/;
const NAME_ATTRS = new Set(["aria-label", "aria-labelledby", "title"]);
const FLAGGED_TAGS = new Set(["button", "Button"]);

function getTagName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const tagNameNode = ts.isJsxElement(node)
    ? node.openingElement.tagName
    : node.tagName;
  return tagNameNode.getText();
}

function hasNameAttr(attributes: ts.JsxAttributes): boolean {
  for (const prop of attributes.properties) {
    if (ts.isJsxSpreadAttribute(prop)) return true;
    if (ts.isJsxAttribute(prop) && NAME_ATTRS.has(prop.name.getText())) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true only when every child is either whitespace-only JSX text or a
 * JSX element/self-closing element whose tag name ends in "Icon" (with no
 * other icon-bearing form present as a bare expression). Any other content
 * (real text, a non-Icon element, a conditional/fragment expression) makes
 * this return false so the caller does not flag the button.
 */
function isIconOnlyChildren(children: ts.NodeArray<ts.JsxChild>): boolean {
  let sawIcon = false;
  for (const child of children) {
    if (ts.isJsxText(child)) {
      if (child.text.trim() !== "") return false;
      continue;
    }
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      if (ICON_TAG_RE.test(getTagName(child))) {
        sawIcon = true;
        continue;
      }
      return false;
    }
    if (ts.isJsxExpression(child)) {
      const expr = child.expression;
      if (!expr) continue; // {/* comment */} — ignore
      if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr)) {
        if (ICON_TAG_RE.test(getTagName(expr))) {
          sawIcon = true;
          continue;
        }
      }
      return false; // any other expression (text, conditional, fragment, ...)
    }
    return false; // fragments or anything else
  }
  return sawIcon;
}

function scanSourceFile(
  sourceFile: ts.SourceFile,
  relFile: string,
  violations: IconOnlyViolation[],
): void {
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const tag = getTagName(node);
      if (FLAGGED_TAGS.has(tag)) {
        const attrs = node.openingElement.attributes;
        if (!hasNameAttr(attrs) && isIconOnlyChildren(node.children)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );
          violations.push({ file: relFile, line: line + 1, tag });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function collectTsxFiles(rootDir: string, excludeDirNames: Set<string>): string[] {
  const results: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (excludeDirNames.has(entry)) continue;
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".tsx")) {
        results.push(full);
      }
    }
  };
  walk(rootDir);
  return results;
}

/**
 * Scans every .tsx file under `rootDir` (recursively, skipping
 * node_modules/__tests__/dist by default) for nameless icon-only
 * <button>/<Button> elements. Returns one entry per violation found.
 */
export function scanForNamelessIconButtons(
  rootDir: string,
  options: { excludeDirNames?: string[] } = {},
): IconOnlyViolation[] {
  const excludeDirNames = new Set(
    options.excludeDirNames ?? ["node_modules", "__tests__", "dist"],
  );
  const files = collectTsxFiles(rootDir, excludeDirNames);
  const violations: IconOnlyViolation[] = [];

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
