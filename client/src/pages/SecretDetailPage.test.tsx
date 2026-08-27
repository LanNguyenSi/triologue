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
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { buildLanguageSwitchHarness } from "../test/languageSwitchHarness";

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
  ]).then(([{ SecretDetailPage }, languageContextModule]) => {
    const Harness = buildLanguageSwitchHarness(
      languageContextModule,
      <MemoryRouter initialEntries={["/secrets/s1"]}>
        <Routes>
          <Route path="/secrets/:secretId" element={<SecretDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
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

    // Mounted state: the secret loaded and the page shows its German
    // subtitle (default language), confirming we start in German. The
    // secret name renders in more than one place (card heading and meta
    // table), so wait on the heading role instead of the plain text.
    await screen.findByRole("heading", { name: "MY_SECRET", level: 2 });
    await waitFor(() => expect(apiClientMock).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText("Details und Metadaten eines Secrets."),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("real-switch-to-en"));

    // The subtitle flips to English, proving the real language switch took
    // effect, while the secret fetch itself stays at 1 call.
    await screen.findByText(
      "View metadata and management actions for a secret.",
    );
    await waitFor(() => expect(apiClientMock).toHaveBeenCalledTimes(1));
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

    // The subtitle renders synchronously from the live `t`, independent of
    // the still-pending load, confirming the page starts in German.
    expect(
      screen.getByText("Details und Metadaten eines Secrets."),
    ).toBeTruthy();

    // Let loadSecret start and begin awaiting the (still pending) response.
    await act(async () => {
      await Promise.resolve();
    });

    // Switch language while the request is still in flight.
    fireEvent.click(screen.getByText("real-switch-to-en"));
    await screen.findByText(
      "View metadata and management actions for a secret.",
    );

    // Now let the pending request fail with a non-Error rejection, so the
    // catch branch falls back to the translated message (tRef.current(...)).
    rejectLoad?.("boom");

    expect(await screen.findByText("Failed to load secrets")).toBeTruthy();
    expect(screen.queryByText("Fehler beim Laden der Secrets")).toBeNull();
  });
});
