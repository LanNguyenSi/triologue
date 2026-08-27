// @vitest-environment jsdom
/**
 * SecretDetailPage's loadSecret carried `t` in its useCallback deps.
 * LanguageProvider memoizes `t` per language (#222), so its identity
 * legitimately changes on a real language switch, which re-fired
 * loadSecret's mount effect and refetched the secret a second time.
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

function mountSecretDetail(apiClientMock: ReturnType<typeof vi.fn>) {
  vi.doMock("../contexts/ThemeContext", () => ({
    useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
  }));
  vi.doMock("../lib/apiClient", () => ({
    apiClient: apiClientMock,
  }));

  return Promise.all([
    import("./SecretDetailPage"),
    import("../contexts/LanguageContext"),
  ]).then(([{ SecretDetailPage }, { LanguageProvider, useLanguage }]) => {
    function LanguageSwitchButton() {
      const { setLanguage } = useLanguage();
      return <button onClick={() => setLanguage("en")}>real-switch-to-en</button>;
    }

    function Harness() {
      const children = useMemo(
        () => (
          <>
            <MemoryRouter initialEntries={["/secrets/s1"]}>
              <Routes>
                <Route path="/secrets/:secretId" element={<SecretDetailPage />} />
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

describe("SecretDetailPage does not refetch on a real language switch (AC1, a34078b6)", () => {
  it("keeps loadSecret's fetch at 1 call after a real setLanguage", async () => {
    const apiClientMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "s1",
        name: "MY_SECRET",
        description: null,
        projectId: null,
        projectName: null,
        lastUsedAt: null,
        lastUsedBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    }));

    await mountSecretDetail(apiClientMock);

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

describe("SecretDetailPage translates a fresh error in the new language, no stale closure (AC2, a34078b6)", () => {
  it("shows the new language's fallback message for an error caught after switching", async () => {
    let rejectLoad: ((reason?: unknown) => void) | undefined;
    const apiClientMock = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject;
        }),
    );

    await mountSecretDetail(apiClientMock);

    // Let loadSecret start and begin awaiting the (still pending) response.
    await act(async () => {
      await Promise.resolve();
    });

    // Switch language while the request is still in flight.
    fireEvent.click(screen.getByText("real-switch-to-en"));

    // Now let the pending request fail with a non-Error rejection, so the
    // catch branch falls back to the translated message (tRef.current(...)).
    await act(async () => {
      rejectLoad?.("boom");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Failed to load secrets")).toBeTruthy();
    expect(screen.queryByText("Fehler beim Laden der Secrets")).toBeNull();
  });
});
