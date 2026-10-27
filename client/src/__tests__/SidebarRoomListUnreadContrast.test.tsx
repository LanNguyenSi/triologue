// @vitest-environment jsdom
/**
 * Light-theme contrast guard for the unread, non-active room row of the desktop
 * sidebar. Before the fix the name/timestamp/preview of an unread row used
 * text-white / text-blue-200 / text-blue-100 in BOTH themes, which is near
 * invisible on the light sidebar surface (axe color-contrast). Light now picks
 * darker grays (font-semibold text-gray-900, text-gray-700); dark keeps the
 * original classes unchanged.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
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
        lastMessage: {
          timestamp: new Date().toISOString(),
          content: "Kickoff is on Monday",
          sender: { displayName: "Lava Agent" },
        },
      },
    ],
    // MemoryRouter starts at "/", so currentRoomId is null and room-42 is an
    // unread NON-active row (the exact state the bug affected).
    unreadCounts: { "room-42": 3 },
    markRoomAsRead: vi.fn(),
  }),
}));

function renderUnreadRow() {
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
  const link = 'a[href="/room/room-42"]';
  return {
    name: document.querySelector(`${link} span.truncate`) as HTMLElement,
    timestamp: document.querySelector(
      `${link} span.text-\\[11px\\]`,
    ) as HTMLElement,
    preview: document.querySelector(`${link} div.truncate`) as HTMLElement,
  };
}

describe("SidebarRoomList unread non-active row contrast", () => {
  it("light: name/timestamp/preview use the dark-enough gray classes, not the light-on-dark ones", () => {
    themeState.theme = "light";
    const { name, timestamp, preview } = renderUnreadRow();
    expect(name).not.toBeNull();
    expect(timestamp).not.toBeNull();
    expect(preview).not.toBeNull();
    // Name stays bolder than a read row (text-gray-500) but readable on white.
    expect(name.className).toContain("font-semibold");
    expect(name.className).toContain("text-gray-900");
    expect(name.className).not.toContain("text-white");
    // Timestamp/preview are darker than the read-row grays (gray-600 / gray-500).
    expect(timestamp.className).toContain("text-gray-700");
    expect(timestamp.className).not.toContain("text-blue-200");
    expect(preview.className).toContain("text-gray-700");
    expect(preview.className).not.toContain("text-blue-100");
  });

  it("dark: name/timestamp/preview keep the original light-on-dark classes", () => {
    themeState.theme = "dark";
    const { name, timestamp, preview } = renderUnreadRow();
    expect(name.className).toContain("font-semibold");
    expect(name.className).toContain("text-white");
    expect(name.className).not.toContain("text-gray-900");
    expect(timestamp.className).toContain("text-blue-200");
    expect(timestamp.className).not.toContain("text-gray-700");
    expect(preview.className).toContain("text-blue-100");
    expect(preview.className).not.toContain("text-gray-700");
  });
});
