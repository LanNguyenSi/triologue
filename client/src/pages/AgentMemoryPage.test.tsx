// @vitest-environment jsdom
/**
 * fetchPage carried `t` in its useCallback dependency array. LanguageProvider
 * memoises `t` per language, so its identity legitimately changes on a real
 * language switch, which re-fired fetchPage's mount effect and refetched the
 * memory list a second time for no reason. The fix reads the translated
 * fallback error message through a useLatest(t) ref instead, so a real
 * switch no longer changes fetchPage's identity while the ref still
 * resolves to the current language at call time (no stale closure). See
 * PR #223 (commit a7377d6) for the pattern this mirrors.
 */
import { useMemo } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("AgentMemoryPage does not refetch on a real language switch", () => {
  it("keeps the memory list fetch at 1 call after a real setLanguage", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    const memoryApiSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [],
        totalCount: 0,
        pageInfo: { limit: 10, hasMore: false, nextCursor: null },
      }),
    }));
    vi.doMock("./memoryApi", () => ({
      memoryApi: memoryApiSpy,
      fetchMemoryProjects: vi.fn(async () => []),
    }));

    const { AgentMemoryPage } = await import("./AgentMemoryPage");
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
            <MemoryRouter>
              <AgentMemoryPage />
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
    expect(memoryApiSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(memoryApiSpy).toHaveBeenCalledTimes(1);
  });
});

describe("AgentMemoryPage translates a fresh load error after a language switch, no stale closure", () => {
  // Forces a SECOND fetchPage call (via the refresh button) after switching
  // language, and asserts the newly rendered error message is in the NEW
  // language. A frozen/stale ref would keep rendering the old one.
  it("shows the new language's translation for an error raised after switching", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    const memoryApiSpy = vi.fn(async () => {
      // A non-Error rejection so fetchPage's catch branch falls back to
      // the translated message instead of using err.message.
      throw "boom";
    });
    vi.doMock("./memoryApi", () => ({
      memoryApi: memoryApiSpy,
      fetchMemoryProjects: vi.fn(async () => []),
    }));

    const { AgentMemoryPage } = await import("./AgentMemoryPage");
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
            <MemoryRouter>
              <AgentMemoryPage />
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
    expect(
      screen.getByText("Memory konnte nicht geladen werden."),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("real-switch-to-en"));
    fireEvent.click(screen.getByRole("button", { name: /refresh list|liste aktualisieren/i }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Failed to load memory.")).toBeTruthy();
    expect(
      screen.queryByText("Memory konnte nicht geladen werden."),
    ).toBeNull();
  });
});
