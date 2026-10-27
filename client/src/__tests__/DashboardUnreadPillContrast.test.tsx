// @vitest-environment jsdom
/**
 * Contrast guard for the dashboard total-unread pill. Before the fix the pill
 * used bg-blue-500 with text-white in BOTH themes (~3.7:1, axe color-contrast
 * on the dashboard cards). Light now pins bg-blue-700 (~6.7:1) and dark pins
 * bg-blue-600 (~5.2:1), both white text; bg-blue-500 must not come back.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "../pages/DashboardPage";

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
  useAuthStore: { getState: () => ({ token: null }) },
}));

vi.mock("../stores/chatStore", () => ({
  useChatStore: () => ({
    rooms: [{ id: "room-1", name: "Main Triologue", role: "MEMBER" }],
    unreadCounts: { "room-1": 3 },
    loadRooms: vi.fn(),
  }),
}));

vi.mock("../stores/notificationStore", () => ({
  useNotificationStore: (selector: (state: { items: unknown[] }) => unknown) =>
    selector({ items: [] }),
}));

vi.mock("../lib/apiClient", () => ({
  apiClient: vi.fn(),
}));

function renderUnreadPill() {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
  return document.querySelector(
    "span.absolute.top-3.right-3.text-xs.font-bold",
  ) as HTMLElement;
}

describe("DashboardPage total-unread pill contrast", () => {
  it("light: pill uses bg-blue-700 with text-white, never bg-blue-500", () => {
    themeState.theme = "light";
    const pill = renderUnreadPill();
    expect(pill).not.toBeNull();
    expect(pill.className).toContain("bg-blue-700");
    expect(pill.className).toContain("text-white");
    expect(pill.className).not.toContain("bg-blue-500");
  });

  it("dark: pill uses bg-blue-600 with text-white, never bg-blue-500", () => {
    themeState.theme = "dark";
    const pill = renderUnreadPill();
    expect(pill).not.toBeNull();
    expect(pill.className).toContain("bg-blue-600");
    expect(pill.className).toContain("text-white");
    expect(pill.className).not.toContain("bg-blue-500");
  });
});
