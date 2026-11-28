/**
 * Single source of truth for the language shown in a chat code block. The
 * class list of the highlighted <code> element can carry more than the fence
 * language: rehype-highlight adds `hljs` next to `language-<x>`, and unknown
 * or extra classes can appear in any order. Splitting on whitespace and
 * reading only the first `language-` prefixed token keeps the header label and
 * the scroll group's accessible name in agreement for every shape, including
 * languages whose name has non-word characters (`c++`, `c#`). An empty result
 * means the fence declared no language; callers fall back to the localised
 * placeholder.
 */
export function extractCodeLanguage(className?: string | null): string {
  if (!className) return "";
  for (const token of className.split(/\s+/)) {
    if (token.startsWith("language-")) {
      return token.slice("language-".length);
    }
  }
  return "";
}
