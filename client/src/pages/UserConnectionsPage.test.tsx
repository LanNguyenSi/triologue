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
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { buildLanguageSwitchHarness } from "../test/languageSwitchHarness";

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
    const languageContextModule = await import("../contexts/LanguageContext");

    const Harness = buildLanguageSwitchHarness(
      languageContextModule,
      <MemoryRouter>
        <UserConnectionsPage />
      </MemoryRouter>,
    );

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
  // Forces a SECOND loadConnectors call through the same path production
  // uses: handleDisconnect awaits the memoised `loadConnectors()` after a
  // successful revoke (UserConnectionsPage.tsx:125), with no dependency
  // change involved. That second fetch rejects with a non-Error, so the
  // catch branch falls back to the translated message via tRef. A frozen/
  // stale ref would keep rendering the old language's translation here.
  it("shows the new language's translation for an error raised after switching", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../stores/authStore", () => ({
      useAuthStore: Object.assign(() => ({ token: "tok1" }), {
        getState: () => ({ token: "tok1" }),
      }),
    }));

    const connector = {
      id: "c1",
      name: "GitHub",
      provider: "github",
      scope: "repo",
      category: "storage",
      status: "connected" as const,
      integrationId: "int-1",
      connectionScope: "user" as const,
      hasPersonalConnection: true,
      hasGlobalFallback: false,
      actions: [],
    };

    const fetchUserConnectors = vi
      .fn()
      // First call (mount effect): succeeds so the disconnect button
      // renders.
      .mockImplementationOnce(async () => [connector])
      // Second call (handleDisconnect's loadConnectors, no dep change):
      // a non-Error rejection so the catch branch falls back to the
      // translated message instead of using error.message.
      .mockImplementationOnce(async () => {
        throw "boom";
      });
    const revokeUserIntegration = vi.fn(async () => undefined);
    vi.doMock("../services/connectorApi", () => ({
      fetchUserConnectors,
      revokeUserIntegration,
    }));

    const { UserConnectionsPage } = await import("./UserConnectionsPage");
    const languageContextModule = await import("../contexts/LanguageContext");

    const Harness = buildLanguageSwitchHarness(
      languageContextModule,
      <MemoryRouter>
        <UserConnectionsPage />
      </MemoryRouter>,
    );

    render(<Harness />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchUserConnectors).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Trennen")).toBeTruthy();

    fireEvent.click(screen.getByText("real-switch-to-en"));
    fireEvent.click(screen.getByText("Disconnect"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(revokeUserIntegration).toHaveBeenCalledTimes(1);
    expect(fetchUserConnectors).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Connections could not be loaded."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Verbindungen konnten nicht geladen werden."),
    ).toBeNull();
  });
});

describe("UserConnectionsPage's oauthErrorMessage re-renders in the new language on a real switch", () => {
  // oauthErrorMessage is a useMemo derived purely for render from the
  // `error` search param, not a fetching loader: it is intentionally left
  // depending on `t` directly (see the header comment above), because it
  // is correct for it to re-run on every language switch. This pins that
  // it actually does.
  it("shows the translated OAuth error in German, then in English after a real setLanguage", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../stores/authStore", () => ({
      useAuthStore: Object.assign(() => ({ token: "tok1" }), {
        getState: () => ({ token: "tok1" }),
      }),
    }));
    vi.doMock("../services/connectorApi", () => ({
      fetchUserConnectors: vi.fn(async () => []),
      revokeUserIntegration: vi.fn(async () => undefined),
    }));

    const { UserConnectionsPage } = await import("./UserConnectionsPage");
    const languageContextModule = await import("../contexts/LanguageContext");

    const Harness = buildLanguageSwitchHarness(
      languageContextModule,
      <MemoryRouter
        initialEntries={["/settings/connections?error=invalid_state"]}
      >
        <UserConnectionsPage />
      </MemoryRouter>,
    );

    render(<Harness />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByText("Ungültiger OAuth-State. Bitte versuche es erneut."),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      screen.getByText("Invalid OAuth state. Please try again."),
    ).toBeTruthy();
    expect(
      screen.queryByText("Ungültiger OAuth-State. Bitte versuche es erneut."),
    ).toBeNull();
  });
});
