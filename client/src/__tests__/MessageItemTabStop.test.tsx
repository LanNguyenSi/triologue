// @vitest-environment jsdom
/**
 * Each chat message row is a single tab stop (a11y: invisible hover-only
 * action buttons used to sit in the tab order of every message, so the
 * composer sat hundreds of stops away). The row element itself is focusable
 * (role article, aria-label from sender name and time, tabIndex 0); its
 * action buttons are tabIndex -1 while the row is inactive and tabIndex 0
 * while it is active. Active means: hovered, or focus contained in the row;
 * a blur whose relatedTarget stays inside the row keeps it active, so Tab
 * can walk from the row into its actions and Shift+Tab back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageItem } from "../components/chat/MessageItem";
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
    username: "alice",
    displayName: "Alice",
    userType: "human",
  },
  createdAt: new Date().toISOString(),
};

// The always-rendered action buttons of a non-grouped message with
// canPin and onReplyInThread: copy, reply in thread, pin, delete.
const actionButtons = () =>
  [
    screen.getByTitle("Copy"),
    screen.getByTitle("Reply in thread"),
    screen.getByTitle("Pin message"),
    screen.getByTitle("Delete message"),
  ] as HTMLElement[];

const row = () => screen.getByRole("article") as HTMLElement;

function Harness() {
  return (
    <LanguageProvider>
      <button>before-row</button>
      <MessageItem
        message={message}
        isGrouped={false}
        canPin
        onReplyInThread={() => undefined}
      />
      <button>after-row</button>
    </LanguageProvider>
  );
}

beforeEach(() => {
  localStorage.setItem("triologue_language", "en");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("MessageItem single tab stop per message", () => {
  it("row is a focusable article labelled with the sender name and an inactive row keeps every action button out of the tab order", () => {
    render(<Harness />);

    // Mutation-sensitive: fails if the row loses tabIndex, role or label.
    const r = row();
    expect(r.tabIndex).toBe(0);
    expect(r.getAttribute("aria-label")).toMatch(/^Message from Alice, /);
    for (const button of actionButtons()) {
      expect(button.tabIndex).toBe(-1);
    }
  });

  it("grouped messages activate the actions of their grouped row too", () => {
    render(
      <LanguageProvider>
        <MessageItem
          message={message}
          isGrouped
          canPin
          onReplyInThread={() => undefined}
        />
      </LanguageProvider>,
    );

    for (const button of actionButtons()) {
      expect(button.tabIndex).toBe(-1);
    }
    fireEvent.focusIn(screen.getByRole("article"), { relatedTarget: document.body });
    for (const button of actionButtons()) {
      expect(button.tabIndex).toBe(0);
    }
  });

  it("Tab reaches the row as the only stop before its actions, walks into them and out to the next element, and Shift+Tab returns to the row", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab(); // -> before-row
    expect(document.activeElement?.textContent).toBe("before-row");

    await user.tab(); // -> the row; focusing it activates its actions
    expect(document.activeElement).toBe(row());
    for (const button of actionButtons()) {
      expect(button.tabIndex).toBe(0);
    }

    await user.tab(); // -> copy (actions became visible tab stops)
    expect(document.activeElement).toBe(screen.getByTitle("Copy"));

    await user.tab({ shift: true }); // -> back to the row
    expect(document.activeElement).toBe(row());

    // Tab past all four actions: the element after the row gets focus and
    // the actions drop out of the tab order again.
    await user.tab(); // copy
    await user.tab(); // reply in thread
    await user.tab(); // pin
    await user.tab(); // delete
    expect(document.activeElement).toBe(screen.getByTitle("Delete message"));
    await user.tab(); // -> after-row
    expect(document.activeElement?.textContent).toBe("after-row");
    for (const button of actionButtons()) {
      expect(button.tabIndex).toBe(-1);
    }
  });

  it("focus moving from the row into one of its buttons keeps the actions tabbable (relatedTarget check)", () => {
    render(<Harness />);

    // Activate the row with focus arriving from outside.
    fireEvent.focusIn(row(), { relatedTarget: document.body });
    for (const button of actionButtons()) {
      expect(button.tabIndex).toBe(0);
    }

    // focusout bubbles through the row when focus moves row -> copy. Its
    // relatedTarget is inside the row, so the row must stay active; without
    // that check the buttons fall back to tabIndex -1 before their focusin
    // and Tab cannot enter them.
    fireEvent.focusOut(row(), { relatedTarget: screen.getByTitle("Copy") });
    for (const button of actionButtons()) {
      expect(button.tabIndex).toBe(0);
    }
  });

  it("blur to an element outside the row puts the actions back to tabIndex -1", () => {
    render(<Harness />);

    fireEvent.focusIn(row(), { relatedTarget: document.body });
    expect(screen.getByTitle("Copy").tabIndex).toBe(0);

    const outside = screen.getByText("after-row");
    fireEvent.focusOut(row(), { relatedTarget: outside });
    for (const button of actionButtons()) {
      expect(button.tabIndex).toBe(-1);
    }
  });

  it("hovering the row makes the actions tabbable and leaving it removes them from the tab order again", () => {
    render(<Harness />);

    fireEvent.mouseEnter(row());
    for (const button of actionButtons()) {
      expect(button.tabIndex).toBe(0);
    }

    fireEvent.mouseLeave(row());
    for (const button of actionButtons()) {
      expect(button.tabIndex).toBe(-1);
    }
  });
});
