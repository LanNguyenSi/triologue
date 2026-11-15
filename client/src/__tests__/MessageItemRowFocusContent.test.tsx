// @vitest-environment jsdom
/**
 * Focusing something inside a message row re-renders the row (its actions
 * become tab stops). The rendered content must survive that: the real
 * MessageRenderer is used (not mocked) with a fenced code block (no language, so it is not syntax-highlighted) in a row that
 * is not the active one. A remounted code block would drop focus to the body,
 * swallow the first click on its copy button and leave the row "focused".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    hasMoreMessages: false,
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

vi.mock("emoji-picker-react", () => ({
  default: () => null,
  Theme: { DARK: "dark", LIGHT: "light" },
  Categories: {},
  SkinTonePickerLocation: {},
}));

const alice = { id: "user-2", username: "alice", displayName: "Alice", userType: "human" as const };
const bob = { id: "user-3", username: "bob", displayName: "Bob", userType: "human" as const };
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const messages: Message[] = [
  { id: "m1", content: "first", sender: alice, createdAt: at(60) },
  {
    id: "m2",
    content: "see [docs](https://example.test/docs)\n\n```\nexport const answer = 42;\n```",
    sender: bob,
    createdAt: at(50),
  },
  { id: "m3", content: "last", sender: alice, createdAt: at(40) },
];

function Harness() {
  return (
    <LanguageProvider>
      <button>before-list</button>
      <MessageList messages={messages} roomId="room-1" onReact={() => undefined} />
      <button>after-list</button>
    </LanguageProvider>
  );
}

const rows = () => screen.getAllByRole("article") as HTMLElement[];
const focusEl = (el: HTMLElement) => act(() => el.focus());
const region = () => screen.getByRole("group", { name: /Code/i });
const copyButton = () => within(rows()[1]).getByTitle("Copy code");

beforeEach(() => {
  localStorage.setItem("triologue_language", "en");
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("content of an inactive row keeps its DOM while focus moves inside the row", () => {
  it("focusing the code region leaves focus on that same connected region", () => {
    render(<Harness />);

    const before = region();
    expect(rows()[1].tabIndex).toBe(-1); // not the active row
    focusEl(before);
    expect(document.activeElement).toBe(before);
    expect(before.isConnected).toBe(true);
    expect(region()).toBe(before); // not remounted by the row's re-render
  });

  it("the first click on the copy button of an inactive row copies", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<Harness />);

    await user.click(copyButton());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("export const answer = 42;");
  });

  it("a link in the row keeps focus too", () => {
    render(<Harness />);

    const link = within(rows()[1]).getByRole("link", { name: "docs" });
    focusEl(link);
    expect(document.activeElement).toBe(link);
    expect(link.isConnected).toBe(true);
  });

  it("focusing the row's content and then moving focus out leaves the row inactive", () => {
    render(<Harness />);

    focusEl(region());
    expect(rows()[1].tabIndex).toBe(0); // active while focus is inside
    focusEl(screen.getByText("after-list"));
    const buttons = within(rows()[1]).getAllByRole("button");
    expect(buttons.every((b) => b.tabIndex === -1)).toBe(true);
  });
});
