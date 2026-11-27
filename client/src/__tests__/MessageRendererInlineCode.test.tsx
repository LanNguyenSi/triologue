// @vitest-environment jsdom
/**
 * Inline code (single backticks) renders as a styled inline <code> without
 * the block chrome; fenced and indented blocks keep the full CodeBlock
 * (Copy button, labelled scroll group). react-markdown 10 passes no `inline`
 * prop, so the distinction rests on the <pre> wrapper.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MessageRenderer } from "../components/chat/MessageRenderer";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LanguageProvider } from "../contexts/LanguageContext";

afterEach(() => cleanup());
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("triologue_theme", "dark");
  localStorage.setItem("triologue_language", "en");
});

const renderMessage = (content: string) =>
  render(
    <ThemeProvider>
      <LanguageProvider>
        <MessageRenderer content={content} />
      </LanguageProvider>
    </ThemeProvider>,
  );

const INLINE_CLASSES = ["px-1", "py-0.5", "rounded", "font-mono"];

const expectInlineOnly = (container: HTMLElement, text: string) => {
  const codes = Array.from(container.querySelectorAll("code"));
  expect(codes).toHaveLength(1);
  const code = codes[0];
  expect(code.textContent).toBe(text);
  for (const c of INLINE_CLASSES) expect(code.className).toContain(c);
  expect(code.closest("pre")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("group")).toBeNull();
};

const expectOneBlock = (container: HTMLElement, text: string) => {
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getAllByRole("group")).toHaveLength(1);
  expect(screen.getByRole("button").textContent).toContain("Copy");
  expect(container.querySelector("pre")).toBeNull();
  const code = screen.getByRole("group").querySelector("code")!;
  expect(code.textContent?.replace(/\n$/, "")).toBe(text);
};

describe("MessageRenderer inline code", () => {
  it("renders inline code in a paragraph inline", () => {
    const { container } = renderMessage("Use `x` here");
    expectInlineOnly(container, "x");
  });

  it("renders inline code in a list item inline", () => {
    const { container } = renderMessage("- item with `x`\n- other");
    expectInlineOnly(container, "x");
  });

  it("renders inline code in a GFM table cell inline", () => {
    const { container } = renderMessage("| a | b |\n|---|---|\n| `x` | y |");
    expectInlineOnly(container, "x");
  });

  it("renders inline code inside a link inline", () => {
    const { container } = renderMessage("[`x`](https://example.com)");
    expectInlineOnly(container, "x");
    expect(container.querySelector("a code")).not.toBeNull();
  });
});

describe("MessageRenderer block code", () => {
  it("renders a fence with a language as a block", () => {
    const { container } = renderMessage("```ts\nconst a = 1;\n```");
    expectOneBlock(container, "const a = 1;");
    expect(
      screen.getByRole("group", { name: "Code block (scrollable), ts" }),
    ).toBeTruthy();
  });

  it("renders a fence without a language as a block", () => {
    const { container } = renderMessage("```\nplain\ntext\n```");
    expectOneBlock(container, "plain\ntext");
  });

  it("renders a one-line fence without a language as a block", () => {
    const { container } = renderMessage("```\none\n```");
    expectOneBlock(container, "one");
  });

  it("renders an indented code block as a block", () => {
    const { container } = renderMessage("Intro\n\n    indented()\n");
    expectOneBlock(container, "indented()");
  });

  it("renders a fence inside a list item as a block", () => {
    const { container } = renderMessage("- item\n\n  ```js\n  let b = 2;\n  ```\n");
    expectOneBlock(container, "let b = 2;");
  });

  it("renders a message with both as one block and one inline element", () => {
    const { container } = renderMessage(
      "Text with `inline` code\n\n```ts\nconst c = 3;\n```",
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getAllByRole("group")).toHaveLength(1);
    const inline = Array.from(container.querySelectorAll("code")).filter(
      (c) => !c.closest('[role="group"]'),
    );
    expect(inline).toHaveLength(1);
    expect(inline[0].textContent).toBe("inline");
    expect(inline[0].className).toContain("px-1");
  });

  it("keeps component identity across a re-render (focus survives)", () => {
    const content = "```ts\nconst d = 4;\n```";
    const ui = () => (
      <ThemeProvider>
        <LanguageProvider>
          <MessageRenderer content={content} />
        </LanguageProvider>
      </ThemeProvider>
    );
    const { rerender } = render(ui());
    const group = screen.getByRole("group");
    group.focus();
    expect(document.activeElement).toBe(group);
    rerender(ui());
    expect(screen.getByRole("group")).toBe(group);
    expect(document.activeElement).toBe(group);
    fireEvent.click(screen.getByRole("button"));
  });
});
