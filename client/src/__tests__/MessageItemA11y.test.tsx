// @vitest-environment jsdom
/**
 * Render-level a11y guard for MessageItem's hover-only actions wrapper
 * (a11y round 3): the wrapper keeps its buttons in the tab order while
 * visually hidden (opacity-0), so it must also un-hide on keyboard focus
 * (focus-within:opacity-100), not just on hover.
 *
 * The assertion is on the class list, not on computed style: jsdom does not
 * run Tailwind's CSS, so opacity cannot be observed here. The class is the
 * behaviour contract (Tailwind generates the CSS from it at build time).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MessageItem } from "../components/chat/MessageItem";
import { Message } from "../types/chat";

afterEach(() => {
  cleanup();
});

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: "en",
    setLanguage: vi.fn(),
  }),
}));

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({
    user: { id: "user-1", username: "lan", displayName: "Lan", isAdmin: true },
  }),
}));

vi.mock("../stores/chatStore", () => ({
  useChatStore: () => ({
    deleteMessage: vi.fn(),
    pinMessage: vi.fn(),
    unpinMessage: vi.fn(),
  }),
}));

vi.mock("../components/chat/MessageRenderer", () => ({
  MessageRenderer: () => null,
}));

vi.mock("../components/chat/ReactionSystem", () => ({
  ReactionSystem: () => null,
  aggregateReactions: () => [],
}));

vi.mock("../components/ui/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

const message: Message = {
  id: "msg-1",
  content: "hello",
  sender: {
    id: "user-2",
    username: "ice",
    displayName: "Ice Agent",
    userType: "AI",
  },
  createdAt: new Date().toISOString(),
};

// The copy button (title from chat.copy, resolved by the pass-through t) is
// always rendered by MessageActions; its wrapper is the element under test.
const actionsWrapper = () =>
  screen.getByTitle("chat.copy").parentElement as HTMLElement;

describe("MessageItem actions wrapper focus visibility (RTL)", () => {
  it("un-hides the header actions on keyboard focus (non-grouped message)", () => {
    render(<MessageItem message={message} isGrouped={false} canPin />);

    const wrapper = actionsWrapper();
    // Mutation-sensitive: fails if focus-within:opacity-100 is dropped from
    // this wrapper, or if the hover behaviour is removed alongside it.
    expect(wrapper.className).toContain("opacity-0");
    expect(wrapper.className).toContain("group-hover:opacity-100");
    expect(wrapper.className).toContain("focus-within:opacity-100");
  });

  it("un-hides the actions on keyboard focus (grouped message)", () => {
    render(<MessageItem message={message} isGrouped canPin />);

    const wrapper = actionsWrapper();
    expect(wrapper.className).toContain("opacity-0");
    expect(wrapper.className).toContain("group-hover:opacity-100");
    expect(wrapper.className).toContain("focus-within:opacity-100");
  });
});
