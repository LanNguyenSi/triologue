// @vitest-environment jsdom
/**
 * Light-theme contrast guard for the desktop sidebar room list: the section
 * header and the room activity timestamp must not use text-gray-400 on the
 * light surface (axe color-contrast), while dark keeps text-gray-400.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarRoomList } from "../components/layout/SidebarRoomList";

const themeState = vi.hoisted(() => ({ theme: "light" }));

afterEach(() => {
  cleanup();
});

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: themeState.theme, setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: "en",
    setLanguage: vi.fn(),
  }),
}));

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({ user: { id: "user-1", isAdmin: false } }),
}));

vi.mock("../stores/chatStore", () => ({
  useChatStore: () => ({
    rooms: [
      {
        id: "room-42",
        name: "Project Falcon",
        role: "MEMBER",
        lastMessage: { timestamp: new Date().toISOString(), content: "hi" },
      },
    ],
    unreadCounts: {},
    markRoomAsRead: vi.fn(),
  }),
}));

function renderList() {
  render(
    <MemoryRouter>
      <SidebarRoomList
        roomSearchQuery=""
        onSearchChange={vi.fn()}
        onOpenCreateRoom={vi.fn()}
        onRequestDeleteRoom={vi.fn()}
      />
    </MemoryRouter>,
  );
  const header = screen.getByText("nav.rooms");
  const timestamp = document.querySelector("span.text-\\[11px\\]") as HTMLElement;
  return { header, timestamp };
}

describe("SidebarRoomList meta text contrast", () => {
  it("light: header is gray-500 and timestamp gray-600, never gray-400", () => {
    themeState.theme = "light";
    const { header, timestamp } = renderList();
    expect(timestamp).not.toBeNull();
    expect(header.className).toContain("text-gray-500");
    expect(header.className).not.toContain("text-gray-400");
    expect(timestamp.className).toContain("text-gray-600");
    expect(timestamp.className).not.toContain("text-gray-400");
  });

  it("dark: header and timestamp keep text-gray-400", () => {
    themeState.theme = "dark";
    const { header, timestamp } = renderList();
    expect(timestamp).not.toBeNull();
    expect(header.className).toContain("text-gray-400");
    expect(timestamp.className).toContain("text-gray-400");
  });
});
