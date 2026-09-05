// @vitest-environment jsdom
/**
 * FilesPage used to carry its own inline `RuntimeError` union plus seven
 * copies of `error instanceof Error ? { message: error.message } : { key }`,
 * independently reproducing the same empty-message bug `describeRunError`
 * (client/src/lib/runError.ts, task a34078b6 Slice 3) already fixes there:
 * a real `Error` with an EMPTY message (e.g. `new Error("")`) used to render
 * as a blank error block (`{ message: "" }` renders nothing) instead of
 * falling back to the translated key. FilesPage now imports the shared
 * `describeRunError` helper (agent-tasks 4b75a2d7, slice 1) instead of
 * re-deriving the shape per call site.
 *
 * This test reproduces the `fetchFileProviders` rejection path (the first
 * of the seven converted call sites) with an empty-message Error and
 * asserts the rendered error block shows the translated fallback text, not
 * an empty block. It also drives a REAL language switch (via
 * `buildLanguageSwitchHarness`) and asserts the SAME still-visible
 * fallback re-renders in English, proving the stored `RunError` is a key
 * (translated at render time) rather than an already-translated string
 * that would freeze at whatever language was active when it was set.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import {
  buildLanguageSwitchHarness,
  REAL_SWITCH_TO_EN_LABEL,
} from "../test/languageSwitchHarness";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  localStorage.clear();
});

function mountFilesPage() {
  vi.doMock("../stores/authStore", () => ({
    useAuthStore: Object.assign(() => ({ token: "t1" }), {
      getState: () => ({ token: "t1" }),
    }),
  }));
  vi.doMock("../contexts/ThemeContext", () => ({
    useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
  }));
  vi.doMock("../services/userFilesApi", () => ({
    fetchFileProviders: vi.fn(async () => {
      // Non-Error rejection stays out of scope here: this reproduces the
      // empty-message Error case specifically, since that is the case
      // describeRunError's fallback fixes (see file doc comment).
      throw new Error("");
    }),
    fetchUserFileSources: vi.fn(async () => []),
    listSharePointFiles: vi.fn(async () => ({ items: [], folderPath: "/" })),
    createSharePointSource: vi.fn(),
    deleteUserFileSource: vi.fn(),
    uploadSharePointFile: vi.fn(),
    downloadSharePointFile: vi.fn(),
  }));

  return Promise.all([
    import("./FilesPage"),
    import("../contexts/LanguageContext"),
  ]).then(([{ FilesPage }, languageContextModule]) => {
    const Harness = buildLanguageSwitchHarness(
      languageContextModule,
      <MemoryRouter initialEntries={["/files"]}>
        <Routes>
          <Route path="/files" element={<FilesPage />} />
        </Routes>
      </MemoryRouter>,
    );
    render(<Harness />);
  });
}

describe("FilesPage renders the translated fallback for an empty-message Error (agent-tasks 4b75a2d7)", () => {
  it("shows the German fallback first, then re-renders in English after a real language switch (no stale closure)", async () => {
    await mountFilesPage();

    // Guard against the historical bug: this call site's error Card must
    // show the translated fallback text, never an empty message block.
    // LanguageProvider defaults to German, so the fallback renders in
    // German first.
    const errorCard = await waitFor(() =>
      screen.getByText("Datei-Provider konnten nicht geladen werden."),
    );
    expect(errorCard.textContent).toBe(
      "Datei-Provider konnten nicht geladen werden.",
    );

    fireEvent.click(screen.getByText(REAL_SWITCH_TO_EN_LABEL));

    await waitFor(() =>
      expect(
        screen.getByText("File providers could not be loaded."),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByText("Datei-Provider konnten nicht geladen werden."),
    ).toBeNull();
  });
});
