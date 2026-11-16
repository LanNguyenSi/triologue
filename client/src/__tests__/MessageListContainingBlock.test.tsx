// @vitest-environment jsdom
/**
 * The message scroller is the containing block of everything absolutely
 * positioned inside the feed.
 *
 * A grouped row (same sender within five minutes) carries its sender name as
 * an `sr-only` span, which is `position: absolute`. When the scroller is not
 * positioned, that span's containing block is the `relative overflow-hidden`
 * wrapper around the scroller: the wrapper gets scrollable overflow as tall as
 * the history, the scrollIntoView on the list end scrolls the wrapper too, and
 * the whole list leaves the viewport (long rooms rendered blank, short ones
 * fine). jsdom has no layout, so this pins the structure that prevents it: the
 * nearest positioned ancestor of every such element lies inside the scroller.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MessageList } from "../components/chat/MessageList";
import { LanguageProvider } from "../contexts/LanguageContext";
import { Message } from "../types/chat";

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({
    user: { id: "user-1", username: "lan", displayName: "Lan", isAdmin: true },
  }),
}));

vi.mock("../stores/chatStore", () => ({
  useChatStore: () => ({
    hasMoreMessages: true,
    isLoadingMore: false,
    loadMoreMessages: vi.fn(),
    currentRoom: { role: "OWNER" },
    isLoading: false,
    messagesError: null,
    loadMessages: vi.fn(),
    deleteMessage: vi.fn(),
    pinMessage: vi.fn(),
    unpinMessage: vi.fn(),
  }),
}));

vi.mock("../components/chat/MessageRenderer", () => ({
  MessageRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}));

vi.mock("emoji-picker-react", () => ({
  default: () => null,
  Theme: { DARK: "dark", LIGHT: "light" },
  Categories: {},
  SkinTonePickerLocation: {},
}));

const alice = { id: "user-2", username: "alice", displayName: "Alice", userType: "human" as const };

// Three messages from the same sender one minute apart: rows 2 and 3 are grouped.
const grouped: Message[] = [0, 1, 2].map((i) => ({
  id: `m${i + 1}`,
  content: `message ${i + 1}`,
  senderId: alice.id,
  roomId: "r1",
  messageType: "TEXT",
  createdAt: new Date(Date.UTC(2026, 10, 16, 6, i)).toISOString(),
  sender: alice,
  reactions: [],
})) as unknown as Message[];

const POSITIONED = ["relative", "absolute", "fixed", "sticky"];
const isPositioned = (el: Element) => POSITIONED.some((c) => el.classList.contains(c));

const nearestPositionedAncestor = (el: Element): Element | null => {
  let node = el.parentElement;
  while (node && !isPositioned(node)) node = node.parentElement;
  return node;
};

beforeEach(() => {
  localStorage.setItem("triologue_language", "en");
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe("MessageList containing block", () => {
  it("the scroller is positioned", () => {
    const { container } = render(
      <LanguageProvider>
        <MessageList messages={grouped} roomId="r1" />
      </LanguageProvider>,
    );
    const scroller = container.querySelector("[data-message-scroller]");
    expect(scroller).not.toBeNull();
    expect(isPositioned(scroller!)).toBe(true);
  });

  // jsdom has no layout, so this cannot prove the wrapper is unscrollable; it
  // pins the classes that make it so: overflow: clip never creates a scroll
  // container, so no positioned descendant can make the wrapper scroll, and
  // min-h-0 keeps the flex-1 wrapper at its column's height (Chrome keeps a
  // flex item's content-based auto minimum under overflow: clip, unlike
  // overflow: hidden, and without it the wrapper grows to the history and the
  // bug moves one ancestor up).
  it("the wrapper is overflow-clip, never overflow-hidden", () => {
    const { container } = render(
      <LanguageProvider>
        <MessageList messages={grouped} roomId="r1" />
      </LanguageProvider>,
    );
    const scroller = container.querySelector("[data-message-scroller]")!;
    const wrapper = scroller.parentElement!;
    expect(wrapper.classList.contains("overflow-clip")).toBe(true);
    expect(wrapper.classList.contains("overflow-hidden")).toBe(false);
    expect(wrapper.classList.contains("min-h-0")).toBe(true);
  });

  it("every absolutely positioned element in the feed is contained by the scroller", () => {
    const { container } = render(
      <LanguageProvider>
        <MessageList messages={grouped} roomId="r1" />
      </LanguageProvider>,
    );
    const scroller = container.querySelector("[data-message-scroller]")!;
    const feed = container.querySelector("[role=feed]")!;
    const absolutes = [...feed.querySelectorAll(".sr-only, .absolute")];
    // The grouped rows render their sender as sr-only: the fixture must hit the case.
    expect(feed.querySelectorAll(".sr-only").length).toBeGreaterThanOrEqual(2);
    for (const el of absolutes) {
      const block = nearestPositionedAncestor(el);
      expect(block, el.outerHTML.slice(0, 80)).not.toBeNull();
      expect(scroller === block || scroller.contains(block!), el.outerHTML.slice(0, 80)).toBe(true);
    }
  });
});
