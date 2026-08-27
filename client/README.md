# Client

React/Vite frontend for OpenTriologue. See the repo root `README.md` for
overall project setup.

## i18n: don't let a translation freeze at the wrong language

`useLanguage()` (`src/contexts/LanguageContext.tsx`) memoises its `t`
translation function per language: `t`'s identity legitimately changes on
every real language switch. Two patterns in this codebase have repeatedly
broken because of that; see the CHANGELOG's `[Unreleased]` section (and its
history) for which call sites were fixed when.

- **A data loader must not depend on `t` directly.** `t` in a
  `useCallback`/`useEffect`/`useLayoutEffect` dependency array re-fires that
  effect on every language switch, needlessly refetching data. Read `t`
  through a `useLatest(t)` ref (`src/hooks/useLatest.ts`) inside the
  callback body instead, and keep `t`/the ref out of the dependency array
  once nothing in the callback body still calls it directly. The guard
  below flags a bare `t` in ANY such dependency array, not just data
  loaders: a legitimate non-loader effect that depends on `t` for a reason
  other than fetching (e.g. `document.title = t(...)`) is rare enough that
  it gets an explicit opt-out instead of a narrower, harder-to-audit check
  (see below) rather than being silently exempted.
- **Error/status state must store a translation key, not an
  already-translated string.** `setSomething(t(key))` (or
  `toast.success(t(key))`) bakes in whichever language was active the
  moment the call ran; a later language switch never retranslates text
  already on screen. Store a `{ message: string } | { key: string }` union
  instead (a raw message straight from the server is rendered verbatim; a
  client-side fallback is stored as its key, NEVER as `t(key)`'s already-
  translated result) and translate the key at render time. See
  `FilesPage`'s `RuntimeError` or `PluginWorkspacePage`'s `RunError` for the
  pattern, and `src/lib/i18nToast.tsx`'s
  `toastT.success`/`toastT.error`/`toastT.loading` for the toast equivalent
  (pass a translation key; it renders a small component that reads
  `useLanguage()` itself, so it re-translates for as long as the toast
  stays on screen).

A repo-wide AST guard enforces both patterns:
`src/__tests__/i18nFreezeGuard.test.ts` (scanner:
`src/__tests__/helpers/i18nFreezeGuardScan.ts`) flags any bare `t` in a
`useCallback`/`useEffect`/`useLayoutEffect` dependency array (deliberately
NOT `useMemo`: a `useMemo` that translates purely for render, like
`UserConnectionsPage`'s `oauthErrorMessage`, is correct to depend on `t`),
unless the hook is directly preceded by an
`// i18n-freeze-guard: intentional` comment. It also flags any `t(...)`
call passed directly as an argument to a `set<X>(...)` setter or a
`toast(...)`/`toast.success`/`toast.error`/`toast.loading`/`toast.promise`
call, including through a parenthesised expression, a `cond ? a : b`
conditional, a `||`/`&&` binary operand, a template literal span, or an
object literal property initializer (so `setRunError({ message: t(key) })`
is flagged exactly like `setRunError(t(key))`; `toast.custom(...)` is not a
sink, since its argument is a render callback, not a translated string).
Known blind spots (deliberately not covered, matching `safeNavGuardScan`'s
precedent of not doing data-flow analysis): an ALIASED `t` (e.g.
`const { t: translate } = useLanguage()`), and any other data-flow through
an intermediate variable. The scan skips only DIRECTORIES literally named
`node_modules`, `__tests__`, or `dist`; a co-located `Something.test.tsx`
next to the file it tests (this repo's normal layout) is scanned like any
other file. A synthetic fixture that intentionally writes one of the
frozen patterns as a string (like the scanner's own fixtures in
`i18nFreezeGuard.test.ts`) avoids tripping the repo-wide invariant by
writing to a scratch directory OUTSIDE `src` entirely, not by relying on
the `__tests__`-name exclusion or the opt-out comment (which only covers
the loader-dep pattern, not the eager-translate one). Pre-existing
violations not yet fixed are tracked
in `src/__tests__/helpers/i18nFreezeGuardAllowlist.ts`, keyed by
file + kind + a whitespace-collapsed snippet of the call site's own text
(NOT by line number, which churns on every unrelated edit above it) with a
reason; fixing one removes its entry rather than leaving it there
permanently. The guard runs as part of the normal `npm test` / `npx vitest
run` suite.

The shared test harness for exercising a REAL language switch (real
`LanguageProvider`, real `setLanguage`, not a mocked `t`) lives in
`src/test/languageSwitchHarness.tsx` (`buildLanguageSwitchHarness`); see any
of the `*.test.tsx` files under `src/pages/` for usage.
