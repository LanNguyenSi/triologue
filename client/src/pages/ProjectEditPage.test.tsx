// @vitest-environment jsdom
/**
 * loadProject carried `t` in its useCallback dependency array. LanguageProvider
 * memoises `t` per language, so its identity legitimately changes on a real
 * language switch, which re-fired loadProject's mount effect and refetched
 * the project a second time for no reason. The fix reads the translated
 * fallback error message through a useLatest(t) ref instead, so a real
 * switch no longer changes loadProject's identity while the ref still
 * resolves to the current language at call time (no stale closure). See
 * PR #223 (commit a7377d6) for the pattern this mirrors.
 */
import { useMemo } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  localStorage.clear();
});

function mockCommonModules() {
  vi.doMock("../contexts/ThemeContext", () => ({
    useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
  }));
  vi.doMock("../stores/authStore", () => ({
    useAuthStore: Object.assign(() => ({ user: { id: "u1" } }), {
      getState: () => ({ user: { id: "u1" } }),
    }),
  }));
  vi.doMock("../stores/chatStore", () => ({
    useChatStore: Object.assign(
      (selector: (state: { loadRooms: () => Promise<void> }) => unknown) =>
        selector({ loadRooms: vi.fn(async () => undefined) }),
      { getState: () => ({ loadRooms: vi.fn(async () => undefined) }) },
    ),
  }));
}

describe("ProjectEditPage does not refetch on a real language switch", () => {
  it("keeps the project fetch at 1 call after a real setLanguage", async () => {
    mockCommonModules();
    const apiClientSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "p1",
        name: "Project One",
        description: "",
        status: "active",
        ownerId: "u1",
        workflowConfig: {},
        projectContext: {},
      }),
    }));
    vi.doMock("../lib/apiClient", () => ({ apiClient: apiClientSpy }));

    const { ProjectEditPage } = await import("./ProjectEditPage");
    const {
      LanguageProvider: HarnessLanguageProvider,
      useLanguage: useHarnessLanguage,
    } = await import("../contexts/LanguageContext");

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
            <MemoryRouter initialEntries={["/projects/p1/edit"]}>
              <Routes>
                <Route path="/projects/:projectId/edit" element={<ProjectEditPage />} />
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
    expect(apiClientSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiClientSpy).toHaveBeenCalledTimes(1);
  });
});

describe("ProjectEditPage translates a fresh load error after a language switch, no stale closure", () => {
  // Forces a SECOND loadProject call (by navigating to a different
  // projectId, which changes loadProject's identity via its `projectId`
  // dependency) after switching language, and asserts the newly rendered
  // error message is in the NEW language. A frozen/stale ref would keep
  // rendering the old one.
  it("shows the new language's translation for an error raised after switching", async () => {
    mockCommonModules();
    const apiClientSpy = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    vi.doMock("../lib/apiClient", () => ({ apiClient: apiClientSpy }));

    const { ProjectEditPage } = await import("./ProjectEditPage");
    const {
      LanguageProvider: HarnessLanguageProvider,
      useLanguage: useHarnessLanguage,
    } = await import("../contexts/LanguageContext");

    function LanguageSwitchButton() {
      const { setLanguage } = useHarnessLanguage();
      return (
        <button onClick={() => setLanguage("en")}>real-switch-to-en</button>
      );
    }

    function NavigateToProjectTwo() {
      const navigate = useNavigate();
      return (
        <button onClick={() => navigate("/projects/p2/edit")}>
          go-to-p2
        </button>
      );
    }

    function Harness() {
      const children = useMemo(
        () => (
          <MemoryRouter initialEntries={["/projects/p1/edit"]}>
            <Routes>
              <Route
                path="/projects/:projectId/edit"
                element={
                  <>
                    <ProjectEditPage />
                    <NavigateToProjectTwo />
                  </>
                }
              />
            </Routes>
          </MemoryRouter>
        ),
        [],
      );
      return (
        <HarnessLanguageProvider>
          {children}
          <LanguageSwitchButton />
        </HarnessLanguageProvider>
      );
    }

    render(<Harness />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Fehler beim Laden")).toBeTruthy();
    expect(apiClientSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("real-switch-to-en"));
    fireEvent.click(screen.getByText("go-to-p2"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiClientSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Failed to load project")).toBeTruthy();
    expect(screen.queryByText("Fehler beim Laden")).toBeNull();
  });
});
