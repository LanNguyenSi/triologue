// @vitest-environment jsdom
/**
 * Mobile chat: hover-only controls and small touch targets.
 *
 * jsdom has no layout engine and no Tailwind, so these tests pin the class
 * contract that the compiled CSS turns into behaviour:
 *  - `[@media(hover:none)]:opacity-100` reveals the message actions, the
 *    grouped-message timestamp and the reaction trigger on touch devices,
 *    while the desktop `group-hover:opacity-100` reveal stays in place;
 *  - `max-md:min-h-11 max-md:min-w-11` (44 px) on the chat action buttons and
 *    the chat header icon buttons below the md breakpoint, with no md+ size
 *    change and the shared Button primitive untouched;
 *  - `wrap-anywhere` on the inbox body and memory text so long URLs wrap.
 * Real rendering of the compiled CSS is checked in a browser, not here.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import inboxSource from "../../pages/InboxPage.tsx?raw";
import memorySource from "../../pages/AgentMemoryPage.tsx?raw";
import buttonSource from "../ui/primitives/Button.tsx?raw";
import { MessageActions } from "./MessageActions";
import { MessageItem } from "./MessageItem";
import { ReactionSystem } from "./ReactionSystem";
import { LanguageProvider } from "../../contexts/LanguageContext";
import { ThemeProvider } from "../../contexts/ThemeContext";
import type { Message } from "../../types/chat";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const TOUCH = "[@media(hover:none)]:opacity-100";
const HOVER = "group-hover:opacity-100";
const MOBILE_TARGET = ["max-md:min-h-11", "max-md:min-w-11"];

const message: Message = {
  id: "m1",
  content: "hello world",
  sender: { id: "u1", username: "alice", displayName: "Alice", userType: "human" },
  createdAt: new Date().toISOString(),
};

function withProviders(node: React.ReactNode) {
  return (
    <LanguageProvider>
      <ThemeProvider>{node}</ThemeProvider>
    </LanguageProvider>
  );
}

function expectMobileTarget(el: HTMLElement) {
  for (const cls of MOBILE_TARGET) expect(el.className).toContain(cls);
  // Only below md: no unprefixed size utility that would also grow desktop.
  expect(el.className).not.toMatch(/(^|\s)(min-h-11|min-w-11|h-11|w-11)(\s|$)/);
}

describe("MessageActions mobile touch targets", () => {
  it("gives copy, pin and delete a 44 px target below md only", () => {
    render(
      withProviders(
        <MessageActions
          message={message}
          canPin
          canDelete
          isPinning={false}
          isDeleting={false}
          onPin={() => undefined}
          onDelete={() => undefined}
        />,
      ),
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    for (const b of buttons) expectMobileTarget(b);
  });
});

describe("MessageItem reveals actions and timestamp on touch devices", () => {
  it("ungrouped: the actions wrapper is hover-revealed and touch-visible", () => {
    render(
      withProviders(<MessageItem message={message} isGrouped={false} canPin={false} />),
    );
    const wrapper = screen.getAllByRole("button")[0].parentElement as HTMLElement;
    expect(wrapper.className).toContain(HOVER);
    expect(wrapper.className).toContain(TOUCH);
    expect(wrapper.className).toContain("focus-within:opacity-100");
  });

  it("grouped: both the timestamp and the actions wrapper are touch-visible", () => {
    const { container } = render(
      withProviders(<MessageItem message={message} isGrouped canPin={false} />),
    );
    const wrapper = screen.getAllByRole("button")[0].parentElement as HTMLElement;
    expect(wrapper.className).toContain(TOUCH);
    expect(wrapper.className).toContain(HOVER);
    const timestamp = container.querySelector("span[title]") as HTMLElement;
    expect(timestamp.className).toContain("opacity-0");
    expect(timestamp.className).toContain(HOVER);
    expect(timestamp.className).toContain(TOUCH);
  });
});

describe("ReactionSystem add-reaction trigger", () => {
  it("is touch-visible, keeps the hover reveal and has a 44 px mobile target", () => {
    render(withProviders(<ReactionSystem messageId="m1" onReact={() => undefined} />));
    const trigger = screen.getByRole("button");
    expect(trigger.className).toContain("opacity-0");
    expect(trigger.className).toContain(HOVER);
    expect(trigger.className).toContain(TOUCH);
    expectMobileTarget(trigger);
  });
});

describe("ChatHeader icon buttons mobile touch targets", () => {
  it("search, participants, invite and export reach 44 px below md", async () => {
    vi.doMock("../../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../../stores/authStore", () => ({
      useAuthStore: () => ({ user: { id: "u1", username: "alice", isAdmin: true } }),
    }));
    vi.doMock("../../lib/apiClient", () => ({ apiClient: vi.fn() }));
    vi.doMock("../../stores/notificationStore", () => ({
      useNotificationStore: (s: (state: { add: () => void }) => unknown) => s({ add: vi.fn() }),
    }));
    vi.doMock("../../stores/chatStore", () => ({
      useChatStore: (s: (state: { messages: unknown[] }) => unknown) => s({ messages: [] }),
    }));
    vi.doMock("../../stores/socketStore", () => ({
      useSocketStore: (s: (state: { isConnected: boolean }) => unknown) => s({ isConnected: true }),
    }));
    vi.doMock("../ui/NotificationCenter", () => ({ NotificationCenter: () => null }));
    vi.doMock("./InvitePopup", () => ({ InvitePopup: () => null }));
    const [{ ChatHeader }, { LanguageProvider: LP }] = await Promise.all([
      import("./ChatHeader"),
      import("../../contexts/LanguageContext"),
    ]);
    const { container } = render(
      <LP>
        <ChatHeader
          room={{ id: "r1", name: "Room One" }}
          onToggleUserList={() => undefined}
          onJumpToMessage={() => undefined}
        />
      </LP>,
    );
    const iconButtons = Array.from(container.querySelectorAll("button")).filter((b) =>
      b.className.includes("p-1.5"),
    ) as HTMLElement[];
    // export, invite, search, participants
    expect(iconButtons).toHaveLength(4);
    for (const b of iconButtons) expectMobileTarget(b);
  });
});

describe("long URLs wrap in inbox and memory text", () => {
  it("InboxPage body text carries wrap-anywhere", () => {
    const line = inboxSource
      .split("\n")
      .find((l: string) => l.includes("mt-1 text-xs") && l.includes("isDark"));
    expect(line).toBeDefined();
    expect(line).toContain("wrap-anywhere");
  });

  it("AgentMemoryPage note text carries wrap-anywhere next to whitespace-pre-wrap", () => {
    const line = memorySource
      .split("\n")
      .find((l: string) => l.includes("whitespace-pre-wrap"));
    expect(line).toBeDefined();
    expect(line).toContain("wrap-anywhere");
  });

  it("the shared Button primitive is not changed to 44 px", () => {
    expect(buttonSource).not.toContain("max-md:min-h-11");
  });
});
