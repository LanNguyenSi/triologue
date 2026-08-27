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
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { buildLanguageSwitchHarness } from "../test/languageSwitchHarness";

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
    const languageContextModule = await import("../contexts/LanguageContext");

    const Harness = buildLanguageSwitchHarness(
      languageContextModule,
      <MemoryRouter initialEntries={["/projects/p1/edit"]}>
        <Routes>
          <Route path="/projects/:projectId/edit" element={<ProjectEditPage />} />
        </Routes>
      </MemoryRouter>,
    );

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

describe("ProjectEditPage renders load errors in the current language after navigating and switching", () => {
  // loadProject has no manual re-call site in production: its only caller
  // is the mount effect keyed on `loadProject` itself (ProjectEditPage.tsx
  // around the `useEffect(() => { void loadProject(); }, [loadProject])`
  // block), and loadProject's own identity now only changes when
  // `projectId` changes (tRef is stable). So the second fetch this test
  // forces, by navigating to a different projectId, is driven by a real
  // dependency change (`projectId`) and not by the useLatest(t) fix: it
  // would refetch and re-render in the new language whether or not the
  // ref fix is in place. This test therefore does NOT discriminate a
  // stale `t` closure in loadProject; it pins the correct, unrelated
  // behaviour that switching projects always re-fetches and renders in
  // whatever language is active at fetch time.
  it("shows the new language's translation for an error raised after navigating and switching", async () => {
    mockCommonModules();
    const apiClientSpy = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    vi.doMock("../lib/apiClient", () => ({ apiClient: apiClientSpy }));

    const { ProjectEditPage } = await import("./ProjectEditPage");
    const languageContextModule = await import("../contexts/LanguageContext");

    function NavigateToProjectTwo() {
      const navigate = useNavigate();
      return (
        <button onClick={() => navigate("/projects/p2/edit")}>
          go-to-p2
        </button>
      );
    }

    const Harness = buildLanguageSwitchHarness(
      languageContextModule,
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
      </MemoryRouter>,
    );

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
