// @vitest-environment jsdom
/**
 * PluginWorkspacePage.runError used to store an already-translated string
 * (`error.message` or `t(fallbackKey)`), so it froze at whatever language
 * was active when the error was set: a later language switch never
 * retranslated an error already on screen. The fix (a34078b6, Slice 3,
 * Klasse 2) stores a `{ message } | { key }` union instead (mirroring
 * FilesPage's RuntimeError) and translates the key at render time, so the
 * message flips language along with everything else.
 *
 * A prior investigation (safeNavGuardCallSites.test.tsx, see STABLE_T
 * there) found that mounting this page can reproducibly OOM-crash the
 * vitest worker, but traced the actual cause: an UNSTABLE mocked `t` (a
 * fresh inline closure returned from a mocked `useLanguage()` on every
 * render) turned a `useCallback([..., t])` guard branch into an infinite
 * setState loop. This test sidesteps that: it uses the REAL LanguageProvider
 * (via languageSwitchHarness), whose `t` is memoised per language and only
 * changes identity on an actual language switch, and after this fix none of
 * loadProjectAttachments/loadRuns/loadMemorySnapshot depend on `t`/`tRef` at
 * all any more. Confirmed safe by running this file directly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { buildLanguageSwitchHarness } from "../test/languageSwitchHarness";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  // LanguageProvider persists the active language to localStorage. Without
  // clearing it here, a real setLanguage("en") from one test leaks into the
  // next (see LanguageContext.tsx).
  localStorage.clear();
});

function mountSalesWorkbench(apiClientMock: ReturnType<typeof vi.fn>) {
  vi.doMock("../contexts/ThemeContext", () => ({
    useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
  }));
  vi.doMock("../lib/apiClient", () => ({
    apiClient: apiClientMock,
  }));
  vi.doMock("../stores/pluginStore", () => ({
    usePluginStore: () => ({
      plugins: [
        {
          id: "sales-workbench",
          name: "Sales Workbench",
          version: "1.0.0",
          description: "",
          capabilities: [],
          ui: { navItems: [] },
        },
      ],
      isLoading: false,
      loadPlugins: vi.fn(),
    }),
  }));

  return Promise.all([
    import("./PluginWorkspacePage"),
    import("../contexts/LanguageContext"),
  ]).then(([{ PluginWorkspacePage }, languageContextModule]) => {
    const Harness = buildLanguageSwitchHarness(
      languageContextModule,
      <MemoryRouter initialEntries={["/plugins/sales-workbench?projectId=p1"]}>
        <Routes>
          <Route path="/plugins/:pluginId" element={<PluginWorkspacePage />} />
        </Routes>
      </MemoryRouter>,
    );
    render(<Harness />);
  });
}

describe("PluginWorkspacePage.runError translates in the current language after a real language switch (AC1, a34078b6 Slice 3)", () => {
  it("re-renders an already-visible runError in the new language, no stale closure", async () => {
    const apiClientMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/projects")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (url.includes("/project-attachments")) {
        // Non-Error rejection: describeRunError falls back to the
        // translation key instead of a raw error.message.
        throw "boom";
      }
      if (url.includes("/instances")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ moduleInstance: null, runs: [] }),
        };
      }
      if (url.includes("/sales-workbench/memory")) {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await mountSalesWorkbench(apiClientMock);

    // The attachments loader's catch branch fired and stored the fallback
    // key; rendered in German (the default language), proving we start in
    // German.
    await screen.findByText("Projekt-Anhänge konnten nicht geladen werden.");

    fireEvent.click(screen.getByText("real-switch-to-en"));

    // Same error, still on screen, no new fetch: it re-renders in English
    // because the render translates the stored key, not a frozen string.
    await waitFor(() =>
      expect(
        screen.getByText("Failed to load project attachments."),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByText("Projekt-Anhänge konnten nicht geladen werden."),
    ).toBeNull();
  });
});

describe("PluginWorkspacePage.describeRunError falls back to the translated key for an empty Error message (review round 2, F5)", () => {
  // Dynamically imported (not a static top-level import): a static import
  // here would be hoisted above every `vi.doMock` call in this file and
  // get cached as the REAL (unmocked) module before the first test's
  // `mountSalesWorkbench` runs, breaking its ThemeContext/apiClient mocks
  // (confirmed: it did, with "useTheme must be used within ThemeProvider").
  // A plain function call doesn't touch any of PluginWorkspacePage's
  // module-level dependencies at import time (only at render time), so an
  // unmocked dynamic import is safe here regardless of import order.
  it("does NOT return a message-shaped RunError for an Error with an empty message", async () => {
    const { describeRunError } = await import("./PluginWorkspacePage");
    // Before the fix, `{ message: error.message }` for `new Error("")`
    // rendered a blank red block and fired `toast.error("")`: a
    // silent-looking failure with no visible text.
    expect(describeRunError(new Error(""), "plugins.screening.error.moduleLoad")).toEqual({
      key: "plugins.screening.error.moduleLoad",
    });
  });

  it("still returns the raw message for an Error with a non-empty message", async () => {
    const { describeRunError } = await import("./PluginWorkspacePage");
    expect(describeRunError(new Error("disk full"), "plugins.screening.error.moduleLoad")).toEqual(
      { message: "disk full" },
    );
  });

  it("falls back to the key for a non-Error rejection", async () => {
    const { describeRunError } = await import("./PluginWorkspacePage");
    expect(describeRunError("boom", "plugins.screening.error.moduleLoad")).toEqual({
      key: "plugins.screening.error.moduleLoad",
    });
  });
});

describe("PluginWorkspacePage does not refetch loadRuns on a real language switch (review round 2, F6)", () => {
  it("keeps the instances fetch at 1 call after a real setLanguage", async () => {
    const apiClientMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/projects")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      if (url.includes("/project-attachments")) {
        return { ok: true, status: 200, json: async () => ({ attachments: [] }) };
      }
      if (url.includes("/instances")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ moduleInstance: null, runs: [] }),
        };
      }
      if (url.includes("/sales-workbench/memory")) {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await mountSalesWorkbench(apiClientMock);

    const instancesCalls = () =>
      apiClientMock.mock.calls.filter(([url]) =>
        String(url).includes("/instances"),
      );

    await waitFor(() => expect(instancesCalls()).toHaveLength(1));

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(instancesCalls()).toHaveLength(1);
  });
});
