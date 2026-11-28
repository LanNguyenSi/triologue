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
import { act } from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

// Copy contract: the clipboard gets the plain fence source, never the
// React element dump. A fence with a language is tokenised by
// rehype-highlight into <span> children, so building the copy text from
// `children` with String() produced "[object Object],..." in the clipboard;
// the component reads textContent of the rendered <code> instead, which is
// the source for highlighted and plain fences alike. The trailing newline
// every fenced block carries is trimmed.
describe("MessageRenderer code block copy (clipboard)", () => {
  // Two lines, a quoted string and a `<`: characters rehype-highlight splits
  // into separate token spans, so the highlighted and plain paths differ here.
  const TS_SOURCE = 'const label = "a < b";\nif (1 < 2) console.log(label);';
  const TS_FENCE = "```ts\n" + TS_SOURCE + "\n```";
  const PLAIN_SOURCE = "plain text with < and \"quotes\"";
  const PLAIN_FENCE = "```\n" + PLAIN_SOURCE + "\n```";

  const mockClipboard = () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  };

  const clickCopy = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
  };

  it("passes the exact source of a highlighted fence to clipboard.writeText", async () => {
    localStorage.setItem("triologue_language", "en");
    const writeText = mockClipboard();
    renderMessage(TS_FENCE);
    // Sanity: the fence really was tokenised into spans, otherwise this test
    // would not cover the highlighted path.
    expect(
      document.querySelector("div[role=group] code span"),
    ).toBeTruthy();

    await clickCopy();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(TS_SOURCE);
    expect(writeText.mock.calls[0][0].endsWith("\n")).toBe(false);
    expect(screen.getByText("Copied!")).toBeTruthy();
  });

  it("passes the exact text of a plain fence to clipboard.writeText", async () => {
    localStorage.setItem("triologue_language", "en");
    const writeText = mockClipboard();
    renderMessage(PLAIN_FENCE);
    expect(document.querySelector("div[role=group] code span")).toBeNull();

    await clickCopy();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(PLAIN_SOURCE);
    expect(writeText.mock.calls[0][0].endsWith("\n")).toBe(false);
    expect(screen.getByText("Copied!")).toBeTruthy();
  });

  it("trims exactly one trailing newline and keeps tabs, trailing blank lines and entities", async () => {
    localStorage.setItem("triologue_language", "en");
    const writeText = mockClipboard();
    // The fence body ends in two blank lines; only the newline the fence
    // itself adds may be dropped.
    const source = "a\tb &lt; c\n\n";
    renderMessage("```\n" + source + "\n```");

    await clickCopy();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(source);
  });
});

// Header contract: the small label above the code shows exactly the fence
// language (or the localised fallback when the fence declares none), never a
// highlight.js class. rehype-highlight adds `hljs` next to `language-<x>` on
// the <code>, so deriving the label from the raw class list used to print
// `hljs ts`. The header and the scroll group's accessible name come from the
// same token extraction and must agree.
describe("MessageRenderer code block header (fence language)", () => {
  const headerLabels = () =>
    Array.from(
      document.querySelectorAll("span.text-xs.font-mono"),
    ).map((el) => el.textContent);

  it("shows the fence language and never the hljs class (en)", () => {
    localStorage.setItem("triologue_language", "en");
    renderMessage("```ts\nconst x = 1;\n```");

    expect(headerLabels()).toEqual(["ts"]);
    expect(screen.queryByText("hljs ts")).toBeNull();
    expect(screen.queryByText(/^hljs/)).toBeNull();
  });

  it("shows the fence language in German (de)", () => {
    localStorage.setItem("triologue_language", "de");
    renderMessage("```ts\nconst x = 1;\n```");

    expect(headerLabels()).toEqual(["ts"]);
  });

  it("shows the localised fallback when the fence declares none (en)", () => {
    localStorage.setItem("triologue_language", "en");
    renderMessage("```\nplain text\n```");

    expect(headerLabels()).toEqual(["text"]);
  });

  it("shows the localised fallback when the fence declares none (de)", () => {
    localStorage.setItem("triologue_language", "de");
    renderMessage("```\nplain text\n```");

    expect(headerLabels()).toEqual(["text"]);
  });

  it("shows a language unknown to highlight.js", () => {
    localStorage.setItem("triologue_language", "en");
    renderMessage("```xyz\nhello there\n```");

    expect(headerLabels()).toEqual(["xyz"]);
  });

  it("keeps non-word characters in the header and the aria-label (c++)", () => {
    localStorage.setItem("triologue_language", "en");
    renderMessage("```c++\nint x = 1;\n```");

    expect(headerLabels()).toEqual(["c++"]);
    expect(
      screen.getByRole("group", { name: "Code block (scrollable), c++" }),
    ).toBeTruthy();
  });
});
