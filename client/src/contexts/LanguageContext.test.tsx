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

describe("FilesPage does not refetch on a real language switch (AC1, T-5e9a1688)", () => {
  // Measured baseline before this fix: mount FilesPage under the real
  // LanguageProvider, spy fetchFileProviders, trigger a real setLanguage
  // call -> afterMount=1, afterSwitch=2 (loadProviders had `t` in its
  // useCallback deps, and `t`'s identity legitimately changes on a real
  // switch even with the #222 memoization, re-firing the mount effect).
  // The fix takes `t` out of the loader deps (via a ref) so a real switch
  // does not touch the loader's identity: afterSwitch must stay 1.
  it("keeps FilesPage's provider fetch at 1 call after a real setLanguage", async () => {
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
    const {
      LanguageProvider: HarnessLanguageProvider,
      useLanguage: useHarnessLanguage,
    } = await import("./LanguageContext");

    // A sibling of FilesPage, not a wrapper: it reads setLanguage from the
    // same LanguageProvider instance so clicking it exercises a REAL
    // language switch (not the "unrelated ancestor re-render" probe used
    // above, which the file's own comments call inert for this class).
    function LanguageSwitchButton() {
      const { setLanguage } = useHarnessLanguage();
      return (
        <button onClick={() => setLanguage("en")}>real-switch-to-en</button>
      );
    }

    function Harness() {
      // Stable children reference so this does not depend on, or exercise,
      // the inline-children-under-a-rerendering-ancestor loop shape.
      const children = useMemo(
        () => (
          <>
            <MemoryRouter>
              <FilesPage />
            </MemoryRouter>
            <LanguageSwitchButton />
          </>
        ),
        [],
      );
      return <HarnessLanguageProvider>{children}</HarnessLanguageProvider>;
    }

    render(<Harness />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchFileProviders).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchFileProviders).toHaveBeenCalledTimes(1);
  });
});

describe("FilesPage translates a fresh error after a language switch, no stale closure (AC3, T-5e9a1688)", () => {
  // Loaders read `t` via a ref instead of a direct closure so their
  // useCallback identity does not change on a language switch. That ref
  // must still resolve to the CURRENT language at call time, not the
  // language in effect when the loader was first created. This test forces
  // a second loader error (clicking "Root" re-runs loadFolder) after
  // switching language, and asserts the newly rendered message is in the
  // NEW language -- a frozen/stale ref would keep rendering the old one.
  it("shows the new language's translation for an error raised after switching", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../stores/authStore", () => ({
      useAuthStore: Object.assign(() => ({ token: "tok" }), {
        getState: () => ({ token: "tok" }),
      }),
    }));
    const listSharePointFiles = vi.fn(async () => {
      // A non-Error rejection so FilesPage's catch branch falls back to
      // the translated message instead of using error.message.
      throw "boom";
    });
    vi.doMock("../services/userFilesApi", () => ({
      fetchFileProviders: vi.fn(async () => [
        {
          id: "sharepoint",
          name: "SharePoint",
          provider: "sharepoint",
          category: "files",
          connected: true,
          connectionPath: "/settings",
        },
      ]),
      fetchUserFileSources: vi.fn(async () => [
        {
          id: "src1",
          provider: "sharepoint",
          label: "Test source",
          siteUrl: "https://example.sharepoint.com/sites/test",
          siteId: "site1",
          siteName: "Test site",
          driveId: "drive1",
          driveName: "Documents",
          webUrl: "https://example.sharepoint.com/sites/test",
          createdAt: new Date().toISOString(),
        },
      ]),
      createSharePointSource: vi.fn(),
      deleteUserFileSource: vi.fn(),
      downloadSharePointFile: vi.fn(),
      listSharePointFiles,
      uploadSharePointFile: vi.fn(),
    }));

    const { FilesPage } = await import("../pages/FilesPage");
    const {
      LanguageProvider: HarnessLanguageProvider,
      useLanguage: useHarnessLanguage,
    } = await import("./LanguageContext");

    function LanguageSwitchButton() {
      const { setLanguage } = useHarnessLanguage();
      return (
        <button onClick={() => setLanguage("en")}>real-switch-to-en</button>
      );
    }

    function Harness() {
      const children = useMemo(
        () => (
          <>
            <MemoryRouter>
              <FilesPage />
            </MemoryRouter>
            <LanguageSwitchButton />
          </>
        ),
        [],
      );
      return <HarnessLanguageProvider>{children}</HarnessLanguageProvider>;
    }

    render(<Harness />);

    // Mount: providers -> sources -> activeSource -> loadFolder, which
    // fails and renders the German error message (default language).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByText("SharePoint Dateien konnten nicht geladen werden."),
    ).toBeTruthy();

    // Switch language, then force a fresh loadFolder call via the "Root"
    // button so a NEW error is caught after the switch.
    fireEvent.click(screen.getByText("real-switch-to-en"));
    // Two elements render the text "Root": the root breadcrumb segment and
    // the standalone Root button; the button is the last match.
    const rootButtons = screen.getAllByRole("button", { name: "Root" });
    fireEvent.click(rootButtons[rootButtons.length - 1]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByText("SharePoint files could not be loaded."),
    ).toBeTruthy();
    expect(
      screen.queryByText("SharePoint Dateien konnten nicht geladen werden."),
    ).toBeNull();
  });
});

describe("PluginWorkspacePage does not refetch on a real language switch (AC2, T-5e9a1688)", () => {
  // Same defect class and same fix as FilesPage above: loadProjects (and
  // loadProjectAttachments/loadRuns/loadMemorySnapshot) carried `t` in
  // their useCallback deps, re-fetching on a real language switch even
  // though the plugin/project data itself does not depend on language.
  it("keeps PluginWorkspacePage's project fetch at 1 call after a real setLanguage", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../stores/pluginStore", () => ({
      usePluginStore: () => ({
        plugins: [
          {
            id: "sales-workbench",
            name: "Sales Workbench",
            ui: { navItems: [] },
          },
        ],
        isLoading: false,
        loadPlugins: vi.fn(),
      }),
    }));
    const apiClient = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));
    vi.doMock("../lib/apiClient", () => ({ apiClient }));

    const { PluginWorkspacePage } = await import("../pages/PluginWorkspacePage");
    const {
      LanguageProvider: HarnessLanguageProvider,
      useLanguage: useHarnessLanguage,
    } = await import("./LanguageContext");
    const { Routes, Route } = await import("react-router-dom");

    function LanguageSwitchButton() {
      const { setLanguage } = useHarnessLanguage();
      return (
        <button onClick={() => setLanguage("en")}>real-switch-to-en</button>
      );
    }

    function Harness() {
      const children = useMemo(
        () => (
          <>
            <MemoryRouter initialEntries={["/plugins/sales-workbench"]}>
              <Routes>
                <Route
                  path="/plugins/:pluginId"
                  element={<PluginWorkspacePage />}
                />
              </Routes>
            </MemoryRouter>
            <LanguageSwitchButton />
          </>
        ),
        [],
      );
      return <HarnessLanguageProvider>{children}</HarnessLanguageProvider>;
    }

    render(<Harness />);

    await act(async () => {
      await Promise.resolve();
    });
    // loadProjects is the only sales-workbench loader that fires
    // unconditionally on mount (loadRuns/loadProjectAttachments/
    // loadMemorySnapshot all require an explicit project selection).
    expect(apiClient).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiClient).toHaveBeenCalledTimes(1);
  });
});

describe("PluginWorkspacePage translates a nameless project's label live (F1, T-5e9a1688 fix round 1)", () => {
  // loadProjects used to translate the untitled-project fallback with
  // tRef.current at fetch time and freeze the translated string into
  // `projects` state. After a language switch, a nameless project's label
  // (both the Select option and the handoff prompt) kept showing the OLD
  // language. The fix keeps the raw (empty) name in state and translates it
  // at render time with the live `t`, so the label must follow a switch.
  it("re-renders a nameless project's Select label in the new language after a switch", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../stores/pluginStore", () => ({
      usePluginStore: () => ({
        plugins: [
          {
            id: "sales-workbench",
            name: "Sales Workbench",
            ui: { navItems: [] },
          },
        ],
        isLoading: false,
        loadPlugins: vi.fn(),
      }),
    }));
    const apiClient = vi.fn(async (url: string) => {
      if (url.startsWith("/api/projects")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { id: "p1", name: "", status: "active", roomId: "room1" },
          ],
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.doMock("../lib/apiClient", () => ({ apiClient }));

    const { PluginWorkspacePage } = await import("../pages/PluginWorkspacePage");
    const {
      LanguageProvider: HarnessLanguageProvider,
      useLanguage: useHarnessLanguage,
    } = await import("./LanguageContext");
    const { Routes, Route } = await import("react-router-dom");

    function LanguageSwitchButton() {
      const { setLanguage } = useHarnessLanguage();
      return (
        <button onClick={() => setLanguage("en")}>real-switch-to-en</button>
      );
    }

    function Harness() {
      const children = useMemo(
        () => (
          <>
            <MemoryRouter
              initialEntries={["/plugins/sales-workbench?projectId=p1"]}
            >
              <Routes>
                <Route
                  path="/plugins/:pluginId"
                  element={<PluginWorkspacePage />}
                />
              </Routes>
            </MemoryRouter>
            <LanguageSwitchButton />
          </>
        ),
        [],
      );
      return <HarnessLanguageProvider>{children}</HarnessLanguageProvider>;
    }

    render(<Harness />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Unbenanntes Projekt")).toBeTruthy();

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Untitled project")).toBeTruthy();
    expect(screen.queryByText("Unbenanntes Projekt")).toBeNull();
  });
});

describe("FilesPage pins loadSources/loadFolder refetch counts across a real language switch (F2, T-5e9a1688 fix round 1)", () => {
  // The original AC1 test above only pinned loadProviders. loadSources and
  // loadFolder carry the exact same `t`-in-deps defect class; this exercises
  // both with a connected-provider-plus-source fixture (loadFolder only
  // fires once there is an activeSource) so both loaders are provably
  // pinned, not just loadProviders.
  it("keeps fetchUserFileSources and listSharePointFiles at 1 call each after a real setLanguage", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../stores/authStore", () => ({
      useAuthStore: Object.assign(() => ({ token: "tok" }), {
        getState: () => ({ token: "tok" }),
      }),
    }));
    const fetchUserFileSources = vi.fn(async () => [
      {
        id: "src1",
        provider: "sharepoint",
        label: "Test source",
        siteUrl: "https://example.sharepoint.com/sites/test",
        siteId: "site1",
        siteName: "Test site",
        driveId: "drive1",
        driveName: "Documents",
        webUrl: "https://example.sharepoint.com/sites/test",
        createdAt: new Date().toISOString(),
      },
    ]);
    const listSharePointFiles = vi.fn(async () => ({
      items: [],
      folderPath: "/",
    }));
    vi.doMock("../services/userFilesApi", () => ({
      fetchFileProviders: vi.fn(async () => [
        {
          id: "sharepoint",
          name: "SharePoint",
          provider: "sharepoint",
          category: "files",
          connected: true,
          connectionPath: "/settings",
        },
      ]),
      fetchUserFileSources,
      createSharePointSource: vi.fn(),
      deleteUserFileSource: vi.fn(),
      downloadSharePointFile: vi.fn(),
      listSharePointFiles,
      uploadSharePointFile: vi.fn(),
    }));

    const { FilesPage } = await import("../pages/FilesPage");
    const {
      LanguageProvider: HarnessLanguageProvider,
      useLanguage: useHarnessLanguage,
    } = await import("./LanguageContext");

    function LanguageSwitchButton() {
      const { setLanguage } = useHarnessLanguage();
      return (
        <button onClick={() => setLanguage("en")}>real-switch-to-en</button>
      );
    }

    function Harness() {
      const children = useMemo(
        () => (
          <>
            <MemoryRouter>
              <FilesPage />
            </MemoryRouter>
            <LanguageSwitchButton />
          </>
        ),
        [],
      );
      return <HarnessLanguageProvider>{children}</HarnessLanguageProvider>;
    }

    render(<Harness />);

    // Mount: providers -> sources -> activeSource -> loadFolder, all resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchUserFileSources).toHaveBeenCalledTimes(1);
    expect(listSharePointFiles).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchUserFileSources).toHaveBeenCalledTimes(1);
    expect(listSharePointFiles).toHaveBeenCalledTimes(1);
  });
});

describe("PluginWorkspacePage pins loadRuns/loadProjectAttachments/loadMemorySnapshot refetch counts (F2, T-5e9a1688 fix round 1)", () => {
  // The existing AC2 test above only exercises loadProjects, the one loader
  // that fires without an explicit project selection. Routing with an
  // explicit ?projectId= makes hasExplicitProjectSelection true from mount,
  // so loadRuns/loadProjectAttachments/loadMemorySnapshot fire too and this
  // pins all three against the same defect class.
  it("keeps the total apiClient call count stable after a real setLanguage with a project selected", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../stores/pluginStore", () => ({
      usePluginStore: () => ({
        plugins: [
          {
            id: "sales-workbench",
            name: "Sales Workbench",
            ui: { navItems: [] },
          },
        ],
        isLoading: false,
        loadPlugins: vi.fn(),
      }),
    }));
    const apiClient = vi.fn(async (url: string) => {
      if (url.startsWith("/api/projects")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { id: "p1", name: "Project One", status: "active", roomId: "room1" },
          ],
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.doMock("../lib/apiClient", () => ({ apiClient }));

    const { PluginWorkspacePage } = await import("../pages/PluginWorkspacePage");
    const {
      LanguageProvider: HarnessLanguageProvider,
      useLanguage: useHarnessLanguage,
    } = await import("./LanguageContext");
    const { Routes, Route } = await import("react-router-dom");

    function LanguageSwitchButton() {
      const { setLanguage } = useHarnessLanguage();
      return (
        <button onClick={() => setLanguage("en")}>real-switch-to-en</button>
      );
    }

    function Harness() {
      const children = useMemo(
        () => (
          <>
            <MemoryRouter
              initialEntries={["/plugins/sales-workbench?projectId=p1"]}
            >
              <Routes>
                <Route
                  path="/plugins/:pluginId"
                  element={<PluginWorkspacePage />}
                />
              </Routes>
            </MemoryRouter>
            <LanguageSwitchButton />
          </>
        ),
        [],
      );
      return <HarnessLanguageProvider>{children}</HarnessLanguageProvider>;
    }

    render(<Harness />);

    // Mount fires loadProjects, loadProjectAttachments, loadRuns and
    // loadMemorySnapshot (all four gated on isSalesWorkbench, which is true,
    // and the last three additionally on hasExplicitProjectSelection, which
    // the ?projectId= route param makes true from mount).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const callsAfterMount = apiClient.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThanOrEqual(4);

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiClient.mock.calls.length).toBe(callsAfterMount);
  });
});

describe("FilesPage re-renders an already-shown runtime error in the new language on switch (F3, T-5e9a1688 fix round 1)", () => {
  // Distinct from the existing AC3 test above (which forces a NEW loadFolder
  // call after switching to catch a fresh, second error). This covers an
  // error that is already on screen BEFORE the switch: runtimeError used to
  // store the already-translated string, so a switch with no new load left
  // the stale-language message on screen. The fix stores the translation
  // key and translates at render time with the live `t`, so the SAME
  // on-screen error must retranslate without any new loader call.
  it("retranslates the loadProviders error message after a language switch, without any new fetch", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../stores/authStore", () => ({
      useAuthStore: Object.assign(() => ({ token: "tok" }), {
        getState: () => ({ token: "tok" }),
      }),
    }));
    const fetchFileProviders = vi.fn(async () => {
      // A non-Error rejection so FilesPage's catch branch falls back to the
      // translated key instead of using error.message.
      throw "boom";
    });
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
    const {
      LanguageProvider: HarnessLanguageProvider,
      useLanguage: useHarnessLanguage,
    } = await import("./LanguageContext");

    function LanguageSwitchButton() {
      const { setLanguage } = useHarnessLanguage();
      return (
        <button onClick={() => setLanguage("en")}>real-switch-to-en</button>
      );
    }

    function Harness() {
      const children = useMemo(
        () => (
          <>
            <MemoryRouter>
              <FilesPage />
            </MemoryRouter>
            <LanguageSwitchButton />
          </>
        ),
        [],
      );
      return <HarnessLanguageProvider>{children}</HarnessLanguageProvider>;
    }

    render(<Harness />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByText("Datei-Provider konnten nicht geladen werden."),
    ).toBeTruthy();
    expect(fetchFileProviders).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByText("File providers could not be loaded."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Datei-Provider konnten nicht geladen werden."),
    ).toBeNull();
    // No new load was triggered by the language switch: loadProviders
    // no longer depends on `t` at all after the fix.
    expect(fetchFileProviders).toHaveBeenCalledTimes(1);
  });
});
