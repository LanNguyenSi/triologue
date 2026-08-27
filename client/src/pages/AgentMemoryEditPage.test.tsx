// @vitest-environment jsdom
/**
 * AgentMemoryEditPage's loadEntry carried `t` in its useCallback deps.
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
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

function jsonOkResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function mountAgentMemoryEdit(apiClientMock: ReturnType<typeof vi.fn>) {
  vi.doMock("../contexts/ThemeContext", () => ({
    useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
  }));
  vi.doMock("../lib/apiClient", () => ({
    apiClient: apiClientMock,
  }));

  return Promise.all([
    import("./AgentMemoryEditPage"),
    import("../contexts/LanguageContext"),
  ]).then(([{ AgentMemoryEditPage }, { LanguageProvider, useLanguage }]) => {
    function LanguageSwitchButton() {
      const { setLanguage } = useLanguage();
      return <button onClick={() => setLanguage("en")}>real-switch-to-en</button>;
    }

    function Harness() {
      const children = useMemo(
        () => (
          <>
            <MemoryRouter initialEntries={["/memory/m1/edit"]}>
              <Routes>
                <Route path="/memory/:memoryId/edit" element={<AgentMemoryEditPage />} />
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

describe("AgentMemoryEditPage does not refetch on a real language switch (AC1, a34078b6)", () => {
  it("keeps loadEntry's fetch at 1 call after a real setLanguage", async () => {
    const apiClientMock = vi.fn(async () =>
      jsonOkResponse({
        id: "m1",
        scope: "GLOBAL",
        memoryType: "core.note",
        title: "A memory",
        tags: [],
        summary: "note text",
        confidence: 0.7,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        editable: true,
      }),
    );

    await mountAgentMemoryEdit(apiClientMock);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiClientMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiClientMock).toHaveBeenCalledTimes(1);
  });
});

describe("AgentMemoryEditPage translates a fresh error in the new language, no stale closure (AC2, a34078b6)", () => {
  it("shows the new language's fallback message for an error caught after switching", async () => {
    let rejectLoad: ((reason?: unknown) => void) | undefined;
    const apiClientMock = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );

    await mountAgentMemoryEdit(apiClientMock);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText("real-switch-to-en"));

    await act(async () => {
      rejectLoad?.("boom");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Failed to load memory.")).toBeTruthy();
    expect(screen.queryByText("Memory konnte nicht geladen werden.")).toBeNull();
  });
});
