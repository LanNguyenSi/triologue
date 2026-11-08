// @vitest-environment jsdom
/**
 * Mobile layout bundle (390 px): class contracts. jsdom has no layout engine,
 * so these pin the classes the compiled CSS turns into behaviour; the real
 * rendering is checked in a browser.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import adminSource from "../../pages/AdminPage.tsx?raw";
import approvalsSource from "../../pages/ApprovalsPage.tsx?raw";
import inboxSource from "../../pages/InboxPage.tsx?raw";
import { MessageItem } from "./MessageItem";
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

const message: Message = {
  id: "m1",
  content: "hello world",
  sender: {
    id: "u1",
    username: "alice",
    displayName: "Alice With A Rather Long Display Name",
    userType: "human",
  },
  createdAt: new Date().toISOString(),
};

describe("chat message header does not break name or time mid-word", () => {
  it("truncates the name, keeps the time on one line, actions do not shrink", () => {
    const { container } = render(
      <LanguageProvider>
        <ThemeProvider>
          <MessageItem message={message} isGrouped={false} canPin={false} />
        </ThemeProvider>
      </LanguageProvider>,
    );
    const name = screen.getByText(message.sender.displayName);
    expect(name.className).toContain("truncate");
    expect(name.className).toContain("min-w-0");
    const time = container.querySelector("span[title]") as HTMLElement;
    expect(time.className).toContain("whitespace-nowrap");
    expect(time.className).toContain("shrink-0");
    const actions = screen.getAllByRole("button")[0].parentElement as HTMLElement;
    expect(actions.className).toContain("shrink-0");
    // Touch visibility from the earlier fix stays.
    expect(actions.className).toContain("[@media(hover:none)]:opacity-100");
  });
});

describe("sidebar delete-room button is not an invisible touch target", () => {
  it("is touch-visible next to the hover reveal and keeps the 44 px target", async () => {
    vi.doMock("../../stores/authStore", () => ({
      useAuthStore: () => ({ user: { id: "u1", username: "alice", isAdmin: true } }),
    }));
    vi.doMock("../../hooks/useRoomList", () => ({
      PROTECTED_ROOMS: [],
      useRoomList: () => ({
        filteredRooms: [{ id: "r1", name: "Room One", createdBy: "u1" }],
        getRoomPreview: () => "",
        formatRoomActivityTime: () => "",
        currentRoomId: undefined,
        unreadCounts: {},
        markRoomAsRead: vi.fn(),
      }),
    }));
    const [{ SidebarRoomList }, { LanguageProvider: LP }, { ThemeProvider: TP }] =
      await Promise.all([
        import("../layout/SidebarRoomList"),
        import("../../contexts/LanguageContext"),
        import("../../contexts/ThemeContext"),
      ]);
    const { container } = render(
      <MemoryRouter>
        <LP>
          <TP>
            <SidebarRoomList
              roomSearchQuery=""
              onSearchChange={() => undefined}
              onOpenCreateRoom={() => undefined}
              onRequestDeleteRoom={() => undefined}
            />
          </TP>
        </LP>
      </MemoryRouter>,
    );
    const del = Array.from(container.querySelectorAll("button")).find((b) =>
      b.className.includes("hover:text-red-400"),
    ) as HTMLElement;
    expect(del).toBeDefined();
    expect(del.className).toContain("opacity-0");
    expect(del.className).toContain("group-hover:opacity-100");
    expect(del.className).toContain("[@media(hover:none)]:opacity-100");
    expect(del.className).toContain("max-md:min-h-11");
    expect(del.className).toContain("max-md:min-w-11");
  });
});

describe("page class contracts", () => {
  it("admin invite status badge keeps its natural width on mobile", () => {
    const i = adminSource.indexOf('"admin.invites.expired"');
    const before = adminSource.slice(Math.max(0, i - 400), i);
    expect(before).toContain("self-start");
  });

  it("approvals note input takes the full row on mobile and flexes from sm", () => {
    expect(approvalsSource).toContain('<div className="flex flex-wrap items-center gap-2 pt-1">');
    expect(approvalsSource).toContain('className="w-full min-w-0 sm:w-auto sm:flex-1"');
  });

  it("inbox read and delete icon buttons reach 44 px below md", () => {
    const lines = inboxSource.split("\n");
    for (const key of ["inbox.item.markRead", "inbox.item.delete"]) {
      const idx = lines.findIndex((l) => l.includes(key));
      const around = lines.slice(Math.max(0, idx - 4), idx + 1).join("\n");
      expect(around).toContain("max-md:min-h-11");
      expect(around).toContain("max-md:min-w-11");
    }
  });
});
