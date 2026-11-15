// @vitest-environment jsdom
/**
 * The chat message list is an ARIA feed with a roving tabindex (a11y: the
 * hover-only action buttons of every message used to sit in the tab order, so
 * the composer was hundreds of Tab presses away).
 *
 * - Exactly one message row is a tab stop (tabIndex 0): the last row the user
 *   focused, else the newest. All other rows are tabIndex -1.
 * - Arrow keys, Home and End move focus between rows while a row has focus.
 * - A row's action buttons and its add-reaction button are tab stops only
 *   while focus is inside that row; hovering never changes the tab order.
 * ReactionSystem is the real component here (only the emoji picker is
 * stubbed), so the add-reaction button's tabIndex is asserted too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageList } from "../components/chat/MessageList";
import { MessageItem } from "../components/chat/MessageItem";
import { ReactionSystem } from "../components/chat/ReactionSystem";
import { LanguageProvider } from "../contexts/LanguageContext";
import { Message } from "../types/chat";

const store = vi.hoisted(() => ({ hasMoreMessages: false, isLoadingMore: false }));

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
    hasMoreMessages: store.hasMoreMessages,
    isLoadingMore: store.isLoadingMore,
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
  // Stands in for the content a real message can hold: a link and a
  // keyboard-focusable scroll region (like a code block).
  MessageRenderer: ({ content }: { content: string }) => (
    <>
      <span>{content}</span>
      {content.includes("[link]") && <a href="https://example.test">a link</a>}
      {content.includes("[scroll]") && (
        <div tabIndex={0} role="group" aria-label="scroll region">
          code
        </div>
      )}
    </>
  ),
}));

vi.mock("emoji-picker-react", () => ({
  default: () => null,
  Theme: { DARK: "dark", LIGHT: "light" },
  Categories: {},
  SkinTonePickerLocation: {},
}));

const alice = { id: "user-2", username: "alice", displayName: "Alice", userType: "human" as const };
const bob = { id: "user-3", username: "bob", displayName: "Bob", userType: "human" as const };

const NOW = Date.now();
const mk = (
  id: string,
  sender: typeof alice,
  minutesAgo: number,
  extra: Partial<Message> = {},
): Message => ({
  id,
  content: `text ${id}`,
  sender,
  createdAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
  ...extra,
});

// m1, m2, m3 are separate groups; m4 follows m3 from the same sender within
// five minutes, so it renders as a grouped row without a sender header.
const four: Message[] = [
  mk("m1", alice, 60),
  mk("m2", bob, 50, {
    content: "text m2 [link]",
    reactions: [{ emoji: "👍", userId: "user-9" }] as Message["reactions"],
  }),
  mk("m3", alice, 40),
  mk("m4", alice, 39),
];

function Harness({ messages = four }: { messages?: Message[] }) {
  return (
    <LanguageProvider>
      <button>before-list</button>
      <MessageList
        messages={messages}
        roomId="room-1"
        onReact={() => undefined}
        onReplyInThread={() => undefined}
      />
      <button>after-list</button>
    </LanguageProvider>
  );
}

const rows = () => screen.getAllByRole("article") as HTMLElement[];
const rowOf = (n: number) => rows()[n - 1];
const actionsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole("button")
    // the reaction chips are not part of the contract; none exist in these messages
    .filter((b) => b.tagName === "BUTTON");
// Focus moves made from the test body run inside act so React flushes the
// focus handlers' state updates before the next assertion.
const focusEl = (el: HTMLElement) => act(() => el.focus());
const tabIndexes = (row: HTMLElement) => actionsOf(row).map((b) => b.tabIndex);

beforeEach(() => {
  localStorage.setItem("triologue_language", "en");
  store.hasMoreMessages = false;
  store.isLoadingMore = false;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("message list is a feed with one roving tab stop", () => {
  it("is a labelled feed of articles and only the newest row is tabIndex 0 at first", () => {
    render(<Harness />);

    expect(screen.getByRole("feed", { name: "Messages" })).toBeTruthy();
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, -1, -1, 0]);
  });

  it("an unfocused row keeps every action button, including add-reaction, out of the tab order but in the accessibility tree", () => {
    render(<Harness />);

    for (const row of rows()) {
      const buttons = actionsOf(row);
      expect(buttons.length).toBeGreaterThanOrEqual(5); // copy, thread, pin, delete, add reaction
      expect(buttons.every((b) => b.tabIndex === -1)).toBe(true);
      expect(within(row).getByRole("button", { name: "Add reaction" })).toBeTruthy();
    }
  });

  it("Tab from the button before the list to the button after it takes the row, its actions and the exit, not one stop per message", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.tab();
    expect(document.activeElement?.textContent).toBe("before-list");

    const after = screen.getByText("after-list");
    let presses = 0;
    const visited: Element[] = [];
    while (document.activeElement !== after && presses < 30) {
      await user.tab();
      presses += 1;
      if (document.activeElement) visited.push(document.activeElement);
    }
    // newest row (grouped: copy, thread, pin, delete + add reaction = 5) + exit
    expect(presses).toBe(1 + 5 + 1);
    expect(visited[0]).toBe(rowOf(4));
    expect(visited.slice(1, 6).every((el) => rowOf(4).contains(el))).toBe(true);
  });

  it("Shift+Tab from the button after the list lands on the active row, not on a hidden action", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    focusEl(screen.getByText("after-list"));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(rowOf(4));
  });

  it("focusing a row makes it the only tab stop and keeps it after focus leaves", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(rowOf(2));
    expect(document.activeElement).toBe(rowOf(2));
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]);

    focusEl(screen.getByText("after-list"));
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]);

    // Tab from the button before the list now enters the list at row 2.
    focusEl(screen.getByText("before-list"));
    await user.tab();
    expect(document.activeElement).toBe(rowOf(2));
  });

  it("focus on a button inside a row makes that row the tab stop", () => {
    render(<Harness />);

    focusEl(actionsOf(rowOf(1))[0]);
    expect(rows().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it("the feed is aria-busy only while older messages load", () => {
    store.isLoadingMore = true;
    render(<Harness />);
    expect(screen.getByRole("feed").getAttribute("aria-busy")).toBe("true");
    cleanup();

    store.isLoadingMore = false;
    render(<Harness />);
    expect(screen.getByRole("feed").getAttribute("aria-busy")).toBe("false");
  });

  it("the first message sits flush at the top, or one gap below the load-older button", () => {
    render(<Harness />);
    const first = () => document.getElementById("message-m1") as HTMLElement;
    expect(first().className).toContain("mt-0");
    expect(first().className).not.toContain("mt-4");
    cleanup();

    store.hasMoreMessages = true;
    render(<Harness />);
    expect(first().className).toContain("mt-4");
    expect(first().className).not.toContain("mt-0 ");
  });

  it("the newest user message is the default stop even when a system message is newer", () => {
    render(
      <Harness
        messages={[
          ...four,
          mk("sys", alice, 1, { messageType: "SYSTEM", content: "plain system text" }),
        ]}
      />,
    );

    expect(rows().length).toBe(4);
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, -1, -1, 0]);
  });

  it("a remembered row that is no longer in the list falls back to the newest", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);

    await user.click(rowOf(1));
    expect(rows().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);

    focusEl(screen.getByText("after-list"));
    rerender(<Harness messages={four.slice(1)} />);
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
  });
});

describe("arrow keys move between rows", () => {
  it("ArrowUp and ArrowDown move focus to the neighbouring row and make it the tab stop", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    focusEl(rowOf(4));
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(rowOf(3));
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, -1, 0, -1]);

    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(rowOf(2));

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rowOf(3));
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, -1, 0, -1]);
  });

  it("PageDown and PageUp move like ArrowDown and ArrowUp", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    focusEl(rowOf(2));
    await user.keyboard("{PageDown}");
    expect(document.activeElement).toBe(rowOf(3));
    await user.keyboard("{PageUp}");
    await user.keyboard("{PageUp}");
    expect(document.activeElement).toBe(rowOf(1));
    await user.keyboard("{PageUp}");
    expect(document.activeElement).toBe(rowOf(1));
  });

  it("ArrowUp on the first row and ArrowDown on the last row stay where they are", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    focusEl(rowOf(1));
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(rowOf(1));

    focusEl(rowOf(4));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rowOf(4));
  });

  it("Home jumps to the first row and End to the last", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    focusEl(rowOf(3));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(rowOf(1));
    expect(rows().map((r) => r.tabIndex)).toEqual([0, -1, -1, -1]);

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(rowOf(4));
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, -1, -1, 0]);
  });

  it("system banners are skipped by the arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        messages={[
          mk("m1", alice, 60),
          mk("sys", alice, 55, { messageType: "SYSTEM", content: "plain system text" }),
          mk("m2", bob, 50),
        ]}
      />,
    );

    focusEl(rowOf(1));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rowOf(2));
  });

  it("arrow keys pressed on a button inside a row do not move focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const copy = within(rowOf(3)).getByRole("button", { name: "Copy" });
    focusEl(copy);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(copy);
  });

  it("handled keys are default-prevented (no page scroll), Tab and other keys are never intercepted", () => {
    render(<Harness />);

    focusEl(rowOf(2));
    for (const key of ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"]) {
      // fireEvent returns false when the event was default-prevented.
      expect(fireEvent.keyDown(rowOf(2), { key })).toBe(false);
    }
    for (const key of ["Tab", "a", "Enter", " "]) {
      expect(fireEvent.keyDown(rowOf(2), { key })).toBe(true);
    }
  });

  it("modified arrow keys are left alone", () => {
    render(<Harness />);

    focusEl(rowOf(4));
    const notPrevented = fireEvent.keyDown(rowOf(4), { key: "ArrowUp", ctrlKey: true });
    expect(notPrevented).toBe(true);
    expect(document.activeElement).toBe(rowOf(4));
  });
});

describe("focus after the focused row is removed", () => {
  const without = (id: string) => four.filter((m) => m.id !== id);

  it("moves to the next row, else the previous one, when focus was inside the removed row", () => {
    const { rerender } = render(<Harness />);

    focusEl(within(rowOf(2)).getByRole("button", { name: "Delete message" }));
    rerender(<Harness messages={without("m2")} />);
    expect(document.activeElement).toBe(rowOf(2)); // formerly m3
    expect(rowOf(2).getAttribute("data-message-row")).toBe("m3");

    focusEl(rowOf(3)); // m4, the last row
    rerender(<Harness messages={without("m2").filter((m) => m.id !== "m4")} />);
    expect(rowOf(2).getAttribute("data-message-row")).toBe("m3");
    expect(document.activeElement).toBe(rowOf(2));
  });

  it("moves focus after the delete confirmation dialog, which holds focus outside the feed, closes with the row gone", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);

    focusEl(within(rowOf(2)).getByRole("button", { name: "Delete message" }));
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog");
    expect(rowOf(2).contains(document.activeElement)).toBe(false);

    rerender(<Harness messages={without("m2")} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(rowOf(2).getAttribute("data-message-row")).toBe("m3");
    expect(document.activeElement).toBe(rowOf(2));
  });

  it("does nothing when only the focused element, not its row, disappears", () => {
    const withoutLink = four.map((m) => (m.id === "m2" ? { ...m, content: "text m2" } : m));
    const { rerender } = render(<Harness />);

    focusEl(within(rowOf(2)).getByRole("link", { name: "a link" }));
    rerender(<Harness messages={withoutLink} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("does nothing when focus had left the feed", () => {
    const { rerender } = render(<Harness />);

    focusEl(rowOf(2));
    focusEl(screen.getByText("after-list"));
    rerender(<Harness messages={without("m2")} />);
    expect(document.activeElement).toBe(screen.getByText("after-list"));
  });

  it("does nothing when focus was dropped to the page before the removal", () => {
    const { rerender } = render(<Harness />);

    focusEl(rowOf(2));
    act(() => (document.activeElement as HTMLElement).blur());
    rerender(<Harness messages={without("m2")} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("does not move focus away from a system banner link when the remembered row disappears", () => {
    const banner = mk("sys", alice, 0, {
      messageType: "SYSTEM",
      content: JSON.stringify({ type: "approval_request", connectorId: "github", actionId: "merge_pull_request", riskLevel: "high" }),
    });
    const withBanner = [...four, banner];
    const { rerender } = render(<Harness messages={withBanner} />);

    focusEl(rowOf(2)); // remembered row m2
    const link = document.querySelector('a[href="/approvals"]') as HTMLElement;
    expect(link).not.toBeNull();
    focusEl(link);
    rerender(<Harness messages={withBanner.filter((m) => m.id !== "m2")} />);
    expect(document.activeElement).toBe(link);
  });

  it("does nothing when the removed row was not the focused one", () => {
    const { rerender } = render(<Harness />);

    focusEl(rowOf(2));
    rerender(<Harness messages={without("m4")} />);
    expect(document.activeElement).toBe(rowOf(2));
  });
});

describe("a row's actions are tab stops only while focus is inside it", () => {
  it("hovering a row, even the active one, does not make its actions tabbable", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.hover(rowOf(2));
    expect(tabIndexes(rowOf(2)).every((i) => i === -1)).toBe(true);
    await user.hover(rowOf(4));
    expect(tabIndexes(rowOf(4)).every((i) => i === -1)).toBe(true);
    fireEvent.mouseEnter(rowOf(3));
    expect(tabIndexes(rowOf(3)).every((i) => i === -1)).toBe(true);
  });

  it("focusing the row makes its actions and add-reaction button tabbable, blur to outside puts them back", () => {
    render(<Harness />);

    focusEl(rowOf(4));
    expect(tabIndexes(rowOf(4)).every((i) => i === 0)).toBe(true);
    // other rows are unaffected
    expect(tabIndexes(rowOf(3)).every((i) => i === -1)).toBe(true);

    focusEl(screen.getByText("after-list"));
    expect(tabIndexes(rowOf(4)).every((i) => i === -1)).toBe(true);
  });

  it("focus moving from the row into one of its buttons keeps the actions tabbable", () => {
    render(<Harness />);

    focusEl(rowOf(4));
    const copy = within(rowOf(4)).getByRole("button", { name: "Copy" });
    // Moves focus row -> copy; the row's focusout carries a relatedTarget
    // inside the row, which must not deactivate it.
    fireEvent.focusOut(rowOf(4), { relatedTarget: copy });
    expect(tabIndexes(rowOf(4)).every((i) => i === 0)).toBe(true);
  });

  it("moving focus to another row deactivates the previous one", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    focusEl(rowOf(4));
    await user.keyboard("{ArrowUp}");
    expect(tabIndexes(rowOf(3)).every((i) => i === 0)).toBe(true);
    expect(tabIndexes(rowOf(4)).every((i) => i === -1)).toBe(true);
  });

  it("Tab walks from the row through each action and the add-reaction button, Shift+Tab walks back", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    focusEl(rowOf(3));
    const names = ["Copy", "Reply in thread", "Pin message", "Delete message", "Add reaction"];
    for (const name of names) {
      await user.tab();
      expect(document.activeElement?.getAttribute("title")).toBe(name);
    }
    await user.tab({ shift: true });
    expect(document.activeElement?.getAttribute("title")).toBe("Delete message");
    for (let i = 0; i < 3; i += 1) await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(rowOf(3));
  });

  it("Enter on Copy runs the action", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Harness />);

    focusEl(rowOf(4));
    await user.tab();
    expect(document.activeElement?.getAttribute("title")).toBe("Copy");
    await user.keyboard("{Enter}");
    expect(writeText).toHaveBeenCalledWith("text m4");
  });

  it("Delete opens the confirm dialog and focus returns to the delete button after cancelling", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    focusEl(rowOf(4));
    await user.tab(); // copy
    await user.tab(); // reply in thread
    await user.tab(); // pin
    await user.tab(); // delete
    const del = document.activeElement as HTMLElement;
    expect(del.getAttribute("title")).toBe("Delete message");

    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(del);
  });
});

describe("focusable content of a row follows the row", () => {
  const link = () => within(rowOf(2)).getByRole("link", { name: "a link" });
  const chip = () => within(rowOf(2)).getByTitle(/👍/);

  it("links and reaction chips of an inactive row are out of the tab order", () => {
    render(<Harness />);

    expect(link().tabIndex).toBe(-1);
    expect(chip().tabIndex).toBe(-1);
  });

  it("a tabindex-only scroll region keeps its tab stop in an inactive row (axe scrollable-region-focusable), and entering it activates the row", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        messages={[
          mk("a1", alice, 60, { content: "first [scroll]" }),
          mk("a2", bob, 50),
          mk("a3", alice, 40),
        ]}
      />,
    );

    const region = screen.getByRole("group", { name: "scroll region" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, -1, 0]);

    await user.tab(); // before-list
    await user.tab(); // the region of the first row
    expect(document.activeElement).toBe(region);
    expect(rows().map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it("they return, with their original tabindex, while focus is inside the row, and leave again after", () => {
    render(<Harness />);

    focusEl(rowOf(2));
    expect(link().tabIndex).toBe(0);
    expect(link().hasAttribute("tabindex")).toBe(false);
    expect(chip().tabIndex).toBe(0);
    expect(chip().hasAttribute("tabindex")).toBe(false);

    focusEl(screen.getByText("after-list"));
    expect(link().tabIndex).toBe(-1);
    expect(chip().tabIndex).toBe(-1);
    focusEl(rowOf(2));
    expect(link().hasAttribute("tabindex")).toBe(false);
  });

  it.each(["0", "3", "-1"])("an explicit tabindex of %s on a link is restored exactly", async (original) => {
    render(<Harness />);

    const late = document.createElement("a");
    late.href = "https://example.test/late";
    late.setAttribute("tabindex", original);
    // A plain link added after it marks the end of the sync that handled `late`.
    const sentinel = document.createElement("a");
    sentinel.href = "https://example.test/sentinel";
    rowOf(2).append(late, sentinel);
    await waitFor(() => expect(sentinel.tabIndex).toBe(-1));
    expect(late.tabIndex).toBe(-1);
    focusEl(rowOf(2));
    expect(late.getAttribute("tabindex")).toBe(original);
    expect(sentinel.hasAttribute("tabindex")).toBe(false);
  });

  it("content that renders into an inactive row later is taken out of the tab order too", async () => {
    render(<Harness />);

    const late = document.createElement("a");
    late.href = "https://example.test/late";
    late.textContent = "late link";
    rowOf(2).appendChild(late);
    await waitFor(() => expect(late.tabIndex).toBe(-1));
  });

  it("a later sync caused by new content keeps the original tabindex of content that was already taken out", async () => {
    render(<Harness />);

    const late = document.createElement("a");
    late.href = "https://example.test/late";
    rowOf(2).appendChild(late);
    await waitFor(() => expect(late.tabIndex).toBe(-1)); // the second sync ran
    focusEl(rowOf(2));
    expect(link().hasAttribute("tabindex")).toBe(false);
    expect(chip().hasAttribute("tabindex")).toBe(false);
    expect(late.hasAttribute("tabindex")).toBe(false);
  });

  it("clicking a link in an inactive row still focuses it and activates the row", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    link().addEventListener("click", (e) => e.preventDefault());
    await user.click(link());
    expect(rows().map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]);
    expect(document.activeElement).toBe(link());
  });
});

describe("feed semantics of a row", () => {
  it("rows are named by sender and time, described by their content, and carry their position in the feed", () => {
    render(<Harness />);

    const r2 = rowOf(2);
    expect(r2.getAttribute("aria-posinset")).toBe("2");
    expect(r2.getAttribute("aria-setsize")).toBe("4");
    expect(screen.getByRole("article", { name: /^Bob\b/ })).toBe(r2);
    expect(r2.getAttribute("aria-describedby")).toBeTruthy();
    expect(
      document.getElementById(r2.getAttribute("aria-describedby") as string)?.textContent,
    ).toContain("text m2");
  });

  it("a grouped row still has the sender in its accessible name", () => {
    render(<Harness />);

    const grouped = rowOf(4);
    expect(grouped.getAttribute("aria-posinset")).toBe("4");
    expect(grouped.getAttribute("aria-labelledby")).toMatch(/-sender .*-time$/);
    expect(screen.getAllByRole("article", { name: /^Alice\b/ })).toContain(grouped);
  });

  it("the set size is unknown (-1) while older messages can still be loaded, and counts only user messages", () => {
    store.hasMoreMessages = true;
    render(<Harness />);
    expect(rowOf(1).getAttribute("aria-setsize")).toBe("-1");
    cleanup();

    store.hasMoreMessages = false;
    render(
      <Harness
        messages={[...four, mk("sys", alice, 1, { messageType: "SYSTEM", content: "plain system text" })]}
      />,
    );
    expect(rowOf(1).getAttribute("aria-setsize")).toBe("4");
  });

  it("the action wrapper is revealed while focus is anywhere in the row, on the header and on the grouped layout", () => {
    render(<Harness />);

    // m3 shows its header, m4 is grouped; the wrapper of the buttons must
    // carry the group-focus-within reveal (a focused row is not the wrapper).
    for (const n of [3, 4]) {
      const wrapper = within(rowOf(n)).getByRole("button", { name: "Copy" }).parentElement;
      expect(wrapper?.className).toContain("group-focus-within:opacity-100");
      expect(wrapper?.className).toContain("group-hover:opacity-100");
    }
  });

  it("a row used on its own is a tab stop of its own", () => {
    render(
      <LanguageProvider>
        <MessageItem message={four[0]} isGrouped={false} canPin={false} />
      </LanguageProvider>,
    );
    expect(rowOf(1).tabIndex).toBe(0);
  });
});

describe("ReactionSystem add-reaction button", () => {
  const renderReaction = (props: { tabbable?: boolean }) =>
    render(
      <LanguageProvider>
        <ReactionSystem messageId="m1" onReact={() => undefined} {...props} />
      </LanguageProvider>,
    );

  it("is a tab stop by default and when tabbable is true", () => {
    renderReaction({});
    expect(screen.getByRole("button", { name: "Add reaction" }).tabIndex).toBe(0);
    cleanup();
    renderReaction({ tabbable: true });
    expect(screen.getByRole("button", { name: "Add reaction" }).tabIndex).toBe(0);
  });

  it("leaves the tab order but stays an accessible button when tabbable is false", () => {
    renderReaction({ tabbable: false });
    const button = screen.getByRole("button", { name: "Add reaction" });
    expect(button.tabIndex).toBe(-1);
    // opacity reveal classes stay; the old visibility hiding is gone
    expect(button.className).toContain("opacity-0");
    expect(button.className).not.toContain("invisible");
    focusEl(button);
    expect(document.activeElement).toBe(button);
  });
});
