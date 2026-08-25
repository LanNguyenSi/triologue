// @vitest-environment jsdom
/**
 * LanguageProvider used to build `t`, `setLanguage` and the context `value`
 * object fresh on every render, not just on a real language change. Any
 * consumer that puts `t` (or a callback built from it) in a
 * useCallback/useEffect dependency list would then re-run that effect on
 * every provider render, not only on a real language switch (see
 * FilesPage/PluginWorkspacePage's load* effects, and the heap-exhaustion
 * loop documented in src/__tests__/safeNavGuardCallSites.test.tsx). These
 * tests pin the fix (t/setLanguage/value now memoized) directly. See the
 * CHANGELOG and the PR description for the original bug report.
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
 * Captures every `t`/`setLanguage` reference plus the whole object
 * useLanguage() returns. Capturing the container object separately matters
 * because consumers destructure individual fields, so a test that only
 * checks `t`'s and `setLanguage`'s identity would stay green even if
 * `value` itself were rebuilt on every render.
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
    // A re-render of IdentityProbe alone (e.g. via its own local state)
    // would be inert: LanguageProvider is a plain function component with
    // its own state, so it only re-executes when ITS OWN state changes or
    // its own parent re-renders it. `probeChildren` is memoized (stable
    // reference across Harness re-renders) so the "unrelated-rerender"
    // click below forces LanguageProvider to re-run its body while
    // `language` itself is untouched, without depending on the
    // inline-children shape that causes the known heap-exhaustion loop.
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
    const initialSetLanguage = snapshots[snapshots.length - 1].setLanguage;
    const initialValue = snapshots[snapshots.length - 1].value;

    // Re-render LanguageProvider's ancestor without changing language.
    fireEvent.click(screen.getByText("unrelated-rerender"));
    expect(screen.getByTestId("tick").textContent).toBe("1");
    const afterAncestorRerender = snapshots[snapshots.length - 1];
    expect(afterAncestorRerender.t).toBe(initialT);
    expect(afterAncestorRerender.setLanguage).toBe(initialSetLanguage);
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
  // `pageChildren` is memoized with an empty dependency array, so its
  // element reference is stable across Harness re-renders and this
  // deliberately avoids the inline-children shape that causes the known
  // heap-exhaustion loop.
  //
  // A real language switch is an inert probe here: translations legitimately
  // change once regardless of this fix, so that fetch would fire once either
  // way. The defect only shows up on a re-render that is NOT a language
  // change, so the probe below forces exactly that (a click that re-renders
  // the Harness parent, with the language untouched) and asserts FilesPage's
  // provider-loading fetch is not re-issued.
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
