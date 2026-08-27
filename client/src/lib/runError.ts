/**
 * A run/operation error is either a raw message straight from the
 * server/thrown Error (already in whatever language the server responded
 * in, so it is rendered verbatim) or a translation key for a client-side
 * fallback message. Keeping the key instead of the translated string means
 * the message re-renders in the current language if the user switches
 * while the error is still on screen; a plain translated string would
 * freeze at whatever language was active when the error was set. Mirrors
 * FilesPage's RuntimeError (PR #223/#219).
 *
 * Extracted from PluginWorkspacePage.tsx (task a34078b6, Slice 3, review
 * round 3, F6): PluginWorkspacePage.describeRunError was the only
 * non-component export under `pages/`, and FilesPage.tsx independently
 * carries the same `RunError`-shaped union plus eight inline copies of this
 * shaping expression (including the same empty-message bug this function
 * fixes below). PluginWorkspacePage now imports this shared helper instead
 * of defining its own; FilesPage.tsx is NOT converted to use it here (that
 * inline-copy cleanup is a separate follow-up task) but should use it going
 * forward instead of re-deriving the same shape per call site.
 */
export type RunError = { message: string } | { key: string };

/**
 * Shapes a thrown/caught error into a `RunError`: a real `Error` with a
 * non-empty message is rendered verbatim (`{ message }`); anything else
 * (a non-Error throw, or an `Error` with an EMPTY message, e.g.
 * `new Error()`) falls back to the translated key instead. Without the
 * empty-message check, `{ message: "" }` would render as a blank error
 * block and fire `toast.error("")`: a silent-looking failure with no
 * visible text (review round 2, F5).
 */
export function describeRunError(error: unknown, fallbackKey: string): RunError {
  return error instanceof Error && error.message
    ? { message: error.message }
    : { key: fallbackKey };
}
