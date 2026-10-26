// @vitest-environment jsdom
/**
 * PageShell's subtitle <p> must carry the wrapping class (break-words) so a
 * long unbreakable token (e.g. a URL) wraps at narrow viewports instead of
 * running past the card edge (axe/overflow audit, dark meta contrast task).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PageShell } from "../components/ui/PageShell";
import { ThemeProvider } from "../contexts/ThemeContext";

afterEach(() => {
  cleanup();
});

describe("PageShell subtitle wrapping (RTL)", () => {
  it("renders the subtitle paragraph with the break-words wrapping class", () => {
    localStorage.setItem("triologue_theme", "dark");
    render(
      <ThemeProvider>
        <PageShell title="Projects" subtitle="See https://triologue.example/a/deliberately/very/long/url/that/must/not/overflow">
          <p>content</p>
        </PageShell>
      </ThemeProvider>,
    );

    const subtitle = screen.getByText(/deliberately\/very\/long\/url/);
    expect(subtitle.tagName).toBe("P");
    expect(subtitle.className).toContain("break-words");
  });
});
