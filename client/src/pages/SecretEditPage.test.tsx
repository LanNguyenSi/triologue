// @vitest-environment jsdom
/**
 * SecretEditPage's loadSecret carried `t` in its useCallback deps.
 * LanguageProvider memoizes `t` per language (#222), so its identity
 * legitimately changes on a real language switch, which re-fired
 * loadSecret's mount effect and refetched the secret a second time.
 * (loadProjects has no `t` dep and is unaffected.)
 *
 * These tests pin the fix (a34078b6, Klasse 1): loadSecret now reads the
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

function mountSecretEdit(apiClientMock: ReturnType<typeof vi.fn>) {
  vi.doMock("../contexts/ThemeContext", () => ({
    useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
  }));
  vi.doMock("../lib/apiClient", () => ({
    apiClient: apiClientMock,
  }));

  return Promise.all([
    import("./SecretEditPage"),
    import("../contexts/LanguageContext"),
  ]).then(([{ SecretEditPage }, { LanguageProvider, useLanguage }]) => {
    function LanguageSwitchButton() {
      const { setLanguage } = useLanguage();
      return <button onClick={() => setLanguage("en")}>real-switch-to-en</button>;
    }

    function Harness() {
      const children = useMemo(
        () => (
          <>
            <MemoryRouter initialEntries={["/secrets/s1/edit"]}>
              <Routes>
                <Route path="/secrets/:secretId/edit" element={<SecretEditPage />} />
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

describe("SecretEditPage does not refetch the secret on a real language switch (AC1, a34078b6)", () => {
  it("keeps loadSecret's fetch at 1 call after a real setLanguage, loadProjects unaffected", async () => {
    const apiClientMock = vi.fn(async (path: string) => {
      if (path.startsWith("/api/projects")) {
        return jsonOkResponse({ items: [], totalCount: 0 });
      }
      return jsonOkResponse({
        id: "s1",
        name: "MY_SECRET",
        description: null,
        projectId: null,
      });
    });

    await mountSecretEdit(apiClientMock);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const secretCallsAfterMount = apiClientMock.mock.calls.filter(
      ([path]) => typeof path === "string" && path.startsWith("/api/secrets/"),
    ).length;
    expect(secretCallsAfterMount).toBe(1);

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    const secretCallsAfterSwitch = apiClientMock.mock.calls.filter(
      ([path]) => typeof path === "string" && path.startsWith("/api/secrets/"),
    ).length;
    expect(secretCallsAfterSwitch).toBe(1);
  });
});

describe("SecretEditPage translates a fresh error in the new language, no stale closure (AC2, a34078b6)", () => {
  it("shows the new language's fallback message for an error caught after switching", async () => {
    let rejectLoad: ((reason?: unknown) => void) | undefined;
    const apiClientMock = vi.fn((path: string) => {
      if (path.startsWith("/api/projects")) {
        return Promise.resolve(jsonOkResponse({ items: [], totalCount: 0 }));
      }
      return new Promise((_resolve, reject) => {
        rejectLoad = reject;
      });
    });

    await mountSecretEdit(apiClientMock);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText("real-switch-to-en"));

    await act(async () => {
      rejectLoad?.("boom");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Failed to load secrets")).toBeTruthy();
    expect(screen.queryByText("Fehler beim Laden der Secrets")).toBeNull();
  });
});
