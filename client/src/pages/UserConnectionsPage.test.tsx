// @vitest-environment jsdom
/**
 * loadConnectors carried `t` in its useCallback dependency array.
 * LanguageProvider memoises `t` per language, so its identity legitimately
 * changes on a real language switch, which re-fired loadConnectors' mount
 * effect and refetched the connector list a second time for no reason. The
 * fix reads the translated fallback error message through a useLatest(t)
 * ref instead, so a real switch no longer changes loadConnectors' identity
 * while the ref still resolves to the current language at call time (no
 * stale closure). See PR #223 (commit a7377d6) for the pattern this
 * mirrors.
 *
 * UserConnectionsPage's second `t]`-dep site (oauthErrorMessage, a
 * useMemo derived purely for render from the `error` search param) is not
 * a fetching loader and does not write a translated string into state: it
 * is recomputed on every language switch and rendered directly, which is
 * already correct. It is intentionally left untouched.
 */
import { useMemo, useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("UserConnectionsPage does not refetch on a real language switch", () => {
  it("keeps the connector fetch at 1 call after a real setLanguage", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../stores/authStore", () => ({
      useAuthStore: Object.assign(() => ({ token: "tok1" }), {
        getState: () => ({ token: "tok1" }),
      }),
    }));
    const fetchUserConnectors = vi.fn(async () => []);
    vi.doMock("../services/connectorApi", () => ({
      fetchUserConnectors,
      revokeUserIntegration: vi.fn(async () => undefined),
    }));

    const { UserConnectionsPage } = await import("./UserConnectionsPage");
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
              <UserConnectionsPage />
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
    expect(fetchUserConnectors).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchUserConnectors).toHaveBeenCalledTimes(1);
  });
});

describe("UserConnectionsPage translates a fresh load error after a language switch, no stale closure", () => {
  // Forces a SECOND loadConnectors call (by bumping `token`, a real
  // dependency of the mount effect unrelated to the i18n fix) after
  // switching language, and asserts the newly rendered error message is
  // in the NEW language. A frozen/stale ref would keep rendering the old
  // one.
  it("shows the new language's translation for an error raised after switching", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));

    let setTokenExternal: (value: string) => void = () => undefined;
    function useAuthStoreMock() {
      const [token, setToken] = useState("tok1");
      setTokenExternal = setToken;
      return { token };
    }
    vi.doMock("../stores/authStore", () => ({
      useAuthStore: useAuthStoreMock,
    }));

    const fetchUserConnectors = vi.fn(async () => {
      // A non-Error rejection so loadConnectors' catch branch falls back
      // to the translated message instead of using error.message.
      throw "boom";
    });
    vi.doMock("../services/connectorApi", () => ({
      fetchUserConnectors,
      revokeUserIntegration: vi.fn(async () => undefined),
    }));

    const { UserConnectionsPage } = await import("./UserConnectionsPage");
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
              <UserConnectionsPage />
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
      screen.getByText("Verbindungen konnten nicht geladen werden."),
    ).toBeTruthy();
    expect(fetchUserConnectors).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("real-switch-to-en"));
    act(() => {
      setTokenExternal("tok2");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchUserConnectors).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Connections could not be loaded."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Verbindungen konnten nicht geladen werden."),
    ).toBeNull();
  });
});
