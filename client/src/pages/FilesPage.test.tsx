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
 * an empty block.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { buildLanguageSwitchHarness } from "../test/languageSwitchHarness";

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

  // English is forced via localStorage before mount so the assertion below
  // checks a fixed, known translation instead of depending on the
  // LanguageProvider's default ("de"), matching how sibling a34078b6 page
  // tests pin the language they assert against.
  localStorage.setItem("triologue_language", "en");

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
  it("shows 'File providers could not be loaded.' instead of a blank error block", async () => {
    await mountFilesPage();

    // Guard against the historical bug: this call site's error Card must
    // show the translated fallback text, never an empty message block.
    const errorCard = await waitFor(() =>
      screen.getByText("File providers could not be loaded."),
    );
    expect(errorCard.textContent).toBe("File providers could not be loaded.");
  });
});
