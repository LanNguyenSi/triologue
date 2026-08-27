# Client

React/Vite frontend for OpenTriologue. See the repo root `README.md` for
overall project setup.

## i18n: don't let a translation freeze at the wrong language

`useLanguage()` (`src/contexts/LanguageContext.tsx`) memoises its `t`
translation function per language: `t`'s identity legitimately changes on
every real language switch. Two patterns in this codebase have repeatedly
broken because of that (task a34078b6, Slices 1-3):

- **A data loader must not depend on `t` directly.** `t` in a
  `useCallback`/`useEffect` dependency array re-fires that effect on every
  language switch, needlessly refetching data. Read `t` through a
  `useLatest(t)` ref (`src/hooks/useLatest.ts`) inside the callback body
  instead, and keep `t`/the ref out of the dependency array once nothing in
  the callback body still calls it directly.
- **Error/status state must store a translation key, not an
  already-translated string.** `setSomething(t(key))` (or
  `toast.success(t(key))`) bakes in whichever language was active the
  moment the call ran; a later language switch never retranslates text
  already on screen. Store a `{ message: string } | { key: string }` union
  instead (a raw message straight from the server is rendered verbatim; a
  client-side fallback is stored as its key) and translate the key at
  render time. See `FilesPage`'s `RuntimeError` or
  `PluginWorkspacePage`'s `RunError` for the pattern, and
  `src/lib/i18nToast.tsx`'s `toastT.success`/`toastT.error`/`toastT.loading`
  for the toast equivalent (pass a translation key; it renders a small
  component that reads `useLanguage()` itself, so it re-translates for as
  long as the toast stays on screen).

A repo-wide AST guard enforces both patterns:
`src/__tests__/i18nFreezeGuard.test.ts` (scanner:
`src/__tests__/helpers/i18nFreezeGuardScan.ts`) flags any bare `t` in a
`useCallback`/`useEffect` dependency array (deliberately NOT `useMemo`: a
`useMemo` that translates purely for render, like
`UserConnectionsPage`'s `oauthErrorMessage`, is correct to depend on `t`)
and any `t(...)` call passed directly as an argument to a `set<X>(...)`
setter or a `toast.success`/`toast.error`/`toast.loading` call. Pre-existing
violations not yet fixed are tracked in
`src/__tests__/helpers/i18nFreezeGuardAllowlist.ts` with a file:line and a
reason; fixing one removes its entry rather than leaving it there
permanently. The guard runs as part of the normal `npm test` / `npx vitest
run` suite.

The shared test harness for exercising a REAL language switch (real
`LanguageProvider`, real `setLanguage`, not a mocked `t`) lives in
`src/test/languageSwitchHarness.tsx` (`buildLanguageSwitchHarness`); see any
of the `*.test.tsx` files under `src/pages/` for usage.
