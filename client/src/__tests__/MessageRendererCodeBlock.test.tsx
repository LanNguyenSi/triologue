// @vitest-environment jsdom
/**
 * Render-level guard for the chat code block scroll container: the overflow-x-auto element
 * must be reachable and operable by keyboard (tabIndex 0, axe
 * scrollable-region-focusable) and must announce itself (role region +
 * localised aria-label via the existing LanguageContext key
 * chat.code.scrollRegion). Rendered with the real providers so the label
 * is asserted as a real translation in both languages.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MessageRenderer } from "../components/chat/MessageRenderer";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LanguageProvider } from "../contexts/LanguageContext";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("triologue_theme", "dark");
});

const CODE_CONTENT = "```ts\nconst veryLongLine = 'x'.repeat(500);\n```";
// Region name the component composes: localised label + message id + the
// first code line truncated to 40 chars (axe landmark-unique).
const FIRST_CODE_LINE = "const veryLongLine = 'x'.repeat(500);";

const renderMessage = () =>
  render(
    <ThemeProvider>
      <LanguageProvider>
        <MessageRenderer content={CODE_CONTENT} messageId="m1" />
      </LanguageProvider>
    </ThemeProvider>,
  );

describe("MessageRenderer code block scroll container (RTL)", () => {
  it("makes the scroll container focusable with a localised region label (en)", () => {
    localStorage.setItem("triologue_language", "en");
    renderMessage();

    // Mutation-sensitive: dropping tabIndex drops the region out of the
    // focusable query; dropping role/aria-label drops the named match. The
    // message id and first code line are part of the name (axe
    // landmark-unique: many identical code blocks share one page).
    const region = screen.getByRole("region", {
      name: `Code block (scrollable) m1: ${FIRST_CODE_LINE}`,
    });
    expect(region.getAttribute("role")).toBe("region");
    expect(region.tabIndex).toBe(0);
    // jsdom applies no CSS; the class is the behaviour contract (Tailwind
    // generates the visible focus ring from it at build time).
    expect(region.className).toContain("overflow-x-auto");
    expect(region.className).toContain("focus-visible:ring-2");
    expect(region.querySelector("code")).toBeTruthy();
  });

  it("labels the scroll container in German (de)", () => {
    localStorage.setItem("triologue_language", "de");
    renderMessage();

    expect(
      screen.getByRole("region", {
        name: `Codeblock (scrollbar) m1: ${FIRST_CODE_LINE}`,
      }),
    ).toBeTruthy();
  });
});
