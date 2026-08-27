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
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import toast, { Toaster } from "react-hot-toast";
import { buildLanguageSwitchHarness } from "../test/languageSwitchHarness";

// jsdom does not implement matchMedia; react-hot-toast's <Toaster /> reads
// it (prefers-reduced-motion) on every render to decide its position style.
window.matchMedia =
  window.matchMedia ||
  ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);

afterEach(() => {
  cleanup();
  // react-hot-toast keeps its own module-global toast store independent of
  // React's tree; clear it so a toast fired by one test doesn't leak into
  // the next (see client/src/lib/i18nToast.test.tsx's review round 3, F2
  // fix for the failure mode this avoids).
  toast.remove();
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

const VALID_PROJECT_FIXTURE = {
  id: "p1",
  name: "Project One",
  description: "",
  status: "active",
  ownerId: "u1",
  workflowConfig: {},
  projectContext: {},
};

function renderProjectEditPageWithToaster(apiClientSpy: ReturnType<typeof vi.fn>) {
  mockCommonModules();
  vi.doMock("../lib/apiClient", () => ({ apiClient: apiClientSpy }));

  return Promise.all([
    import("./ProjectEditPage"),
    import("../contexts/LanguageContext"),
  ]).then(([{ ProjectEditPage }, languageContextModule]) => {
    const Harness = buildLanguageSwitchHarness(
      languageContextModule,
      <MemoryRouter initialEntries={["/projects/p1/edit"]}>
        <Routes>
          <Route
            path="/projects/:projectId/edit"
            element={
              <>
                <Toaster />
                <ProjectEditPage />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    render(<Harness />);
  });
}

// Covers one of the four `if (err instanceof Error) toast.error(err.message);
// else toastT.error(key)` sites this task's CHANGELOG entry describes
// (ProjectEditPage/ProjectDetailPage): saveProjectBasics's catch branch.
// Missing test flagged by review round 3 (this is the "missing tests"
// follow-up, not one of F1-F7).
describe("ProjectEditPage's save-basics error toast (a34078b6, review round 3 missing-test follow-up)", () => {
  it("shows a real Error's message verbatim, unaffected by a language switch", async () => {
    const apiClientSpy = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "Server exploded" }),
        };
      }
      return { ok: true, status: 200, json: async () => VALID_PROJECT_FIXTURE };
    });

    await renderProjectEditPageWithToaster(apiClientSpy);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText("Änderungen speichern"));
    await waitFor(() => expect(screen.getByText("Server exploded")).toBeTruthy());

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    // A raw server message has nothing to re-translate: it must still read
    // exactly the same after a language switch.
    expect(screen.getByText("Server exploded")).toBeTruthy();
  });

  it("shows the translated fallback key for a non-Error rejection, and re-translates after a real language switch", async () => {
    let patchCalls = 0;
    const apiClientSpy = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        patchCalls += 1;
        // A non-Error rejection (e.g. a raw string thrown by a lower-level
        // client): describeRunError-style branches in this codebase fall
        // back to the translated key instead of trying to stringify it.
        throw "boom";
      }
      return { ok: true, status: 200, json: async () => VALID_PROJECT_FIXTURE };
    });

    await renderProjectEditPageWithToaster(apiClientSpy);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText("Änderungen speichern"));
    await waitFor(() => expect(patchCalls).toBe(1));
    await waitFor(() =>
      expect(screen.getByText("Projekt konnte nicht aktualisiert werden.")).toBeTruthy(),
    );

    fireEvent.click(screen.getByText("real-switch-to-en"));

    await waitFor(() => expect(screen.getByText("Failed to update project.")).toBeTruthy());
    expect(screen.queryByText("Projekt konnte nicht aktualisiert werden.")).toBeNull();
  });
});
