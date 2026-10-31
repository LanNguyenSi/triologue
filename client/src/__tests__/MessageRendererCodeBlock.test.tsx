// @vitest-environment jsdom
/**
 * Render-level guard for the chat code block scroll container: the
 * overflow-x-auto element must be reachable and operable by keyboard
 * (tabIndex 0, axe scrollable-region-focusable) and must announce itself as
 * a named group (role group, so axe landmark-unique never applies; a named
 * region would add one landmark per code block). The accessible name is the
 * localised label from the LanguageContext key chat.code.scrollRegion plus
 * the fence language, never the message id or the code text. Rendered with
 * the real providers so the label is asserted as a real translation in both
 * languages.
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
const FIRST_CODE_LINE = "const veryLongLine = 'x'.repeat(500);";
// What the label must never contain: the old name embedded the message id
// (a UUID in production) and the first code line to satisfy axe
// landmark-unique; as a group neither is needed.
const FORBIDDEN_LABEL_PARTS = ["m1", FIRST_CODE_LINE, "veryLongLine"];

const renderMessage = (content: string = CODE_CONTENT) =>
  render(
    <ThemeProvider>
      <LanguageProvider>
        <MessageRenderer content={content} />
      </LanguageProvider>
    </ThemeProvider>,
  );

describe("MessageRenderer code block scroll container (RTL)", () => {
  it("makes the scroll container focusable with a localised group label (en)", () => {
    localStorage.setItem("triologue_language", "en");
    renderMessage();

    // Mutation-sensitive: dropping tabIndex drops the group out of the
    // focusable query; dropping role/aria-label drops the named match. The
    // name is the localised label plus the fence language.
    const group = screen.getByRole("group", {
      name: "Code block (scrollable), ts",
    });
    expect(group.getAttribute("role")).toBe("group");
    expect(group.tabIndex).toBe(0);
    // jsdom applies no CSS; the class is the behaviour contract (Tailwind
    // generates the visible focus ring from it at build time).
    expect(group.className).toContain("overflow-x-auto");
    expect(group.className).toContain("focus-visible:ring-2");
    expect(group.querySelector("code")).toBeTruthy();
  });

  it("keeps the message id and the code text out of the accessible name (en)", () => {
    localStorage.setItem("triologue_language", "en");
    renderMessage();

    const group = screen.getByRole("group", {
      name: "Code block (scrollable), ts",
    });
    const label = group.getAttribute("aria-label") ?? "";
    for (const forbidden of FORBIDDEN_LABEL_PARTS) {
      expect(label).not.toContain(forbidden);
    }
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("drops the language from the label when the fence declares none", () => {
    localStorage.setItem("triologue_language", "en");
    renderMessage("```\nplain text\n```");

    const group = screen.getByRole("group", { name: "Code block (scrollable)" });
    expect(group.getAttribute("aria-label")).toBe("Code block (scrollable)");
  });

  it("labels the scroll container group in German (de)", () => {
    localStorage.setItem("triologue_language", "de");
    renderMessage();

    expect(
      screen.getByRole("group", { name: "Codeblock (scrollbar), ts" }),
    ).toBeTruthy();
  });
});
