// @vitest-environment jsdom
/**
 * Task b3d530dd (reviewer finding on Batch 26 / 1f795204): LanguageProvider
 * used to build `t`, `setLanguage` and the context `value` object fresh on
 * every render, not just on a real language change. Two consequences:
 *
 *  1. Any consumer that puts `t` (or a callback built from it) in a
 *     useCallback/useEffect dependency list re-runs that effect on every
 *     provider render, not only on a real language switch. FilesPage's
 *     loadProviders/loadSources/loadFolder and PluginWorkspacePage's
 *     loadProjects/loadRuns/loadProjectAttachments/loadMemorySnapshot all do
 *     this, so an unrelated re-render of the provider silently re-fetches
 *     everything.
 *  2. The only thing keeping that from looping forever today is that
 *     App.tsx mounts LanguageProvider directly under ThemeProvider with
 *     element-identical children, so a theme change never re-renders it. If
 *     LanguageProvider were ever moved under a component that re-renders it,
 *     or given inline children, real pages would loop into the heap
 *     exhaustion crash documented in
 *     src/__tests__/safeNavGuardCallSites.test.tsx (STABLE_T).
 *
 * These tests pin the fix (t/setLanguage/value now memoized) directly, so
 * the invariant is checked by this file rather than resting only on that
 * comment.
 */
import { useMemo, useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LanguageProvider, useLanguage } from "./LanguageContext";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  localStorage.clear();
});

/**
 * Captures every `t`/`setLanguage` reference the consumer receives, plus the
 * whole object useLanguage() returns (the context `value` itself). The
 * whole-object capture matters separately from `t`/`setLanguage`: every
 * consumer in the codebase destructures individual fields
 * (`const { t } = useLanguage()`), so a test that only checks `t`'s and
 * `setLanguage`'s identity would stay green even if the `value` object
 * itself were rebuilt on every render (i.e. even without useMemo around
 * `value`), because the individual field references would still be stable
 * on their own. Capturing the container object pins that separate part of
 * the fix.
 */
function IdentityProbe({
  onCapture,
}: {
  onCapture: (snapshot: {
    t: unknown;
    setLanguage: unknown;
    value: unknown;
  }) => void;
}) {
  const value = useLanguage();
  const { t, setLanguage } = value;
  onCapture({ t, setLanguage, value });
  return (
    <button onClick={() => setLanguage("en")}>switch-to-en</button>
  );
}

describe("LanguageProvider identity memoization (AC1/AC2)", () => {
  it("keeps `t` (and the context value object) referentially stable across an ancestor-triggered re-render, and changes them on a real setLanguage call", () => {
    const snapshots: { t: unknown; setLanguage: unknown; value: unknown }[] =
      [];

    // A re-render of IdentityProbe alone (e.g. via its own local state)
    // would prove nothing: LanguageProvider is a plain function component
    // with its own state, so it only re-executes when ITS OWN state changes
    // or when ITS OWN parent re-renders it -- a child's local re-render
    // never touches it, memoized or not. To actually exercise the fix, an
    // ANCESTOR of LanguageProvider must re-render for a reason unrelated to
    // language, forcing LanguageProvider's function body to run again while
    // `language` itself is untouched. `probeChildren` is memoized (stable
    // reference across Harness re-renders) so this does not depend on, or
    // exercise, the "inline children under a re-rendering ancestor" shape
    // that causes the known heap-exhaustion loop.
    function Harness() {
      const [tick, setTick] = useState(0);
      const probeChildren = useMemo(
        () => <IdentityProbe onCapture={(s) => snapshots.push(s)} />,
        [],
      );
      return (
        <>
          <button onClick={() => setTick((c) => c + 1)}>
            unrelated-rerender
          </button>
          <span data-testid="tick">{tick}</span>
          <LanguageProvider>{probeChildren}</LanguageProvider>
        </>
      );
    }

    render(<Harness />);

    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    const initialT = snapshots[snapshots.length - 1].t;
    const initialValue = snapshots[snapshots.length - 1].value;

    // Re-render LanguageProvider's ancestor without changing language.
    fireEvent.click(screen.getByText("unrelated-rerender"));
    expect(screen.getByTestId("tick").textContent).toBe("1");
    const afterAncestorRerender = snapshots[snapshots.length - 1];
    expect(afterAncestorRerender.t).toBe(initialT);
    expect(afterAncestorRerender.value).toBe(initialValue);

    // A real language switch must produce a new `t` and a new value object
    // (translations differ).
    fireEvent.click(screen.getByText("switch-to-en"));
    const afterSwitch = snapshots[snapshots.length - 1];
    expect(afterSwitch.t).not.toBe(initialT);
    expect(afterSwitch.value).not.toBe(initialValue);
  });
});

describe("LanguageProvider identity memoization prevents spurious refetch (AC3)", () => {
  // Deliberately NOT the "mount the provider under a re-rendering ancestor
  // with inline children" shape that reproduces the heap-exhaustion loop in
  // safeNavGuardCallSites.test.tsx: `pageChildren` below is memoized with an
  // empty dependency array, so its element reference never changes across
  // Harness re-renders, and the harness only re-renders ONCE per click (no
  // state anywhere here feeds back into the tick counter), so there is no
  // cascade to loop.
  //
  // What this proves: bug (1) above is "unstable `t`/`value` fire consuming
  // effects on ANY provider render", not narrowly "on a language switch".
  // Asserting only that a single real language switch doesn't cause more
  // than one fetch would not actually distinguish fixed from broken code:
  // a genuine language switch legitimately changes `t` exactly once either
  // way (translations differ by design), so that fetch happens once
  // regardless of this fix. The defect only shows up on a re-render that is
  // NOT a language change, so the probe below forces exactly that (a click
  // that re-renders the Harness parent, with the language untouched) and
  // asserts FilesPage's provider-loading fetch is not re-issued.
  it("does not re-issue FilesPage's provider fetch when the provider re-renders without a language change", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../stores/authStore", () => ({
      useAuthStore: Object.assign(() => ({ token: "tok" }), {
        getState: () => ({ token: "tok" }),
      }),
    }));
    const fetchFileProviders = vi.fn(async () => []);
    vi.doMock("../services/userFilesApi", () => ({
      fetchFileProviders,
      fetchUserFileSources: vi.fn(async () => []),
      createSharePointSource: vi.fn(),
      deleteUserFileSource: vi.fn(),
      downloadSharePointFile: vi.fn(),
      listSharePointFiles: vi.fn(async () => ({ items: [], folderPath: "/" })),
      uploadSharePointFile: vi.fn(),
    }));

    const { FilesPage } = await import("../pages/FilesPage");
    // Re-import LanguageContext through the same module registry FilesPage
    // was just (re-)loaded from. vi.resetModules() in afterEach clears the
    // registry between tests, so the top-of-file static `LanguageProvider`
    // import (bound once, at collection time) would otherwise be a
    // different module instance than the Context object FilesPage's
    // dynamically re-imported `useLanguage` reads from, and useLanguage()
    // would throw "must be used within LanguageProvider" despite actually
    // being wrapped in one.
    const { LanguageProvider: HarnessLanguageProvider } = await import(
      "./LanguageContext"
    );

    function Harness() {
      const [tick, setTick] = useState(0);
      // Stable children reference across Harness re-renders: this is the
      // "memoize children instead of feeding inline JSX" pattern the task
      // constraints require to avoid the known loop shape.
      const pageChildren = useMemo(
        () => (
          <MemoryRouter>
            <FilesPage />
          </MemoryRouter>
        ),
        [],
      );
      return (
        <>
          <button onClick={() => setTick((c) => c + 1)}>
            unrelated-rerender
          </button>
          <span data-testid="tick">{tick}</span>
          <HarnessLanguageProvider>{pageChildren}</HarnessLanguageProvider>
        </>
      );
    }

    render(<Harness />);

    // Let the initial mount effect (loadProviders) resolve.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchFileProviders).toHaveBeenCalledTimes(1);

    // Trigger a re-render of LanguageProvider's parent that does NOT change
    // language. Before the fix, LanguageProvider's own re-render allocates a
    // new `t`/`value`, which FilesPage picks up via context regardless of
    // its memoized children, giving loadProviders a new identity and
    // re-firing its effect.
    fireEvent.click(screen.getByText("unrelated-rerender"));
    expect(screen.getByTestId("tick").textContent).toBe("1");
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchFileProviders).toHaveBeenCalledTimes(1);
  });
});
