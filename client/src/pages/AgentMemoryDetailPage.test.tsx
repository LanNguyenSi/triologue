// @vitest-environment jsdom
/**
 * AgentMemoryDetailPage's loadEntry carried `t` in its useCallback deps.
 * LanguageProvider memoizes `t` per language (#222), so its identity
 * legitimately changes on a real language switch, which re-fired
 * loadEntry's mount effect and refetched the memory entry a second time.
 *
 * These tests pin the fix (a34078b6, Klasse 1): loadEntry now reads the
 * translation function through a `useLatest(t)` ref in its catch branch
 * instead of depending on `t` directly, exactly like FilesPage/
 * PluginWorkspacePage from PR #223 (commit a7377d6).
 */
import { useMemo } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  // LanguageProvider persists the active language to localStorage. Without
  // clearing it here, the AC1 test's real setLanguage("en") leaks into the
  // next test in this file: it would mount already in English, making its
  // own language switch a no-op (see LanguageContext.tsx).
  localStorage.clear();
});

function jsonOkResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function mountAgentMemoryDetail(apiClientMock: ReturnType<typeof vi.fn>) {
  vi.doMock("../contexts/ThemeContext", () => ({
    useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
  }));
  vi.doMock("../lib/apiClient", () => ({
    apiClient: apiClientMock,
  }));

  return Promise.all([
    import("./AgentMemoryDetailPage"),
    import("../contexts/LanguageContext"),
  ]).then(([{ AgentMemoryDetailPage }, { LanguageProvider, useLanguage }]) => {
    function LanguageSwitchButton() {
      const { setLanguage } = useLanguage();
      return <button onClick={() => setLanguage("en")}>real-switch-to-en</button>;
    }

    function Harness() {
      const children = useMemo(
        () => (
          <>
            <MemoryRouter initialEntries={["/memory/m1"]}>
              <Routes>
                <Route path="/memory/:memoryId" element={<AgentMemoryDetailPage />} />
              </Routes>
            </MemoryRouter>
            <LanguageSwitchButton />
          </>
        ),
        [],
      );
      return <LanguageProvider>{children}</LanguageProvider>;
    }

    render(<Harness />);
  });
}

describe("AgentMemoryDetailPage does not refetch on a real language switch (AC1, a34078b6)", () => {
  it("keeps loadEntry's fetch at 1 call after a real setLanguage", async () => {
    const apiClientMock = vi.fn(async () =>
      jsonOkResponse({
        id: "m1",
        scope: "GLOBAL",
        memoryType: "core.note",
        title: "A memory",
        tags: [],
        summary: "note text",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        editable: true,
      }),
    );

    await mountAgentMemoryDetail(apiClientMock);

    // Mounted state: the entry loaded and the page shows its German
    // subtitle (default language), confirming we start in German.
    await screen.findByText("A memory");
    await waitFor(() => expect(apiClientMock).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText("Eintrag prüfen, Kontext sehen und Aktionen ausführen."),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("real-switch-to-en"));

    // The subtitle flips to English, proving the real language switch took
    // effect, while the entry fetch itself stays at 1 call.
    await screen.findByText("Review the entry, inspect context, and run actions.");
    await waitFor(() => expect(apiClientMock).toHaveBeenCalledTimes(1));
  });
});

describe("AgentMemoryDetailPage translates a fresh error in the new language, no stale closure (AC2, a34078b6)", () => {
  it("shows the new language's fallback message for an error caught after switching", async () => {
    let rejectLoad: ((reason?: unknown) => void) | undefined;
    const apiClientMock = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );

    await mountAgentMemoryDetail(apiClientMock);

    // The subtitle renders synchronously from the live `t`, independent of
    // the still-pending load, confirming the page starts in German.
    expect(
      screen.getByText("Eintrag prüfen, Kontext sehen und Aktionen ausführen."),
    ).toBeTruthy();

    // Let loadEntry start and begin awaiting the (still pending) response.
    await act(async () => {
      await Promise.resolve();
    });

    // Switch language while the request is still in flight.
    fireEvent.click(screen.getByText("real-switch-to-en"));
    await screen.findByText("Review the entry, inspect context, and run actions.");

    // Now let the pending request fail with a non-Error rejection, so the
    // catch branch falls back to the translated message (tRef.current(...)).
    rejectLoad?.("boom");

    expect(await screen.findByText("Failed to load memory.")).toBeTruthy();
    expect(screen.queryByText("Memory konnte nicht geladen werden.")).toBeNull();
  });
});
