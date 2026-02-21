/**
 * Minimal HTML sanitizer for i18n strings.
 * Allows only safe inline tags (a, b, strong, em, i, code, br, span).
 * Strips everything else including script, img, svg, event handlers.
 */
export function sanitizeHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;

  const ALLOWED_TAGS = new Set([
    "A", "B", "STRONG", "EM", "I", "CODE", "BR", "SPAN", "P", "UL", "OL", "LI",
  ]);
  const ALLOWED_ATTRS: Record<string, Set<string>> = {
    A: new Set(["href", "target", "rel"]),
    SPAN: new Set(["class"]),
  };

  function walk(node: Node): void {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (!ALLOWED_TAGS.has(el.tagName)) {
          // Replace disallowed element with its text content
          const text = document.createTextNode(el.textContent ?? "");
          node.replaceChild(text, el);
          continue;
        }
        // Strip disallowed attributes
        const allowed = ALLOWED_ATTRS[el.tagName] ?? new Set();
        for (const attr of Array.from(el.attributes)) {
          if (!allowed.has(attr.name) || (attr.name === "href" && attr.value.startsWith("javascript:"))) {
            el.removeAttribute(attr.name);
          }
        }
        // Force safe link attributes
        if (el.tagName === "A") {
          el.setAttribute("rel", "noopener noreferrer");
        }
        walk(el);
      }
    }
  }

  walk(div);
  return div.innerHTML;
}

/** Shorthand for React's dangerouslySetInnerHTML with sanitization */
export function safeHtml(html: string): { __html: string } {
  return { __html: sanitizeHtml(html) };
}
