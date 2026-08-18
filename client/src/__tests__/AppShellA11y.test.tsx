// @vitest-environment jsdom
/**
 * Render-level a11y guard for AppShell's mobile close-sidebar and
 * hamburger open-sidebar buttons (a11y round 2, task 74d695bb, controls
 * 4/7 and 5/7 from PR #211's icon-only-button sweep). See
 * ConfirmDialogA11y.test.tsx for why a real render assertion is needed in
 * addition to the source-text guard in uiConsistency.test.ts.
 *
 * Both buttons are always present in the DOM (visibility is CSS-only, via
 * translate-x / md:hidden classes — see AppShell.tsx), so no interaction is
 * needed to reach them.
 *
 * All stores are real zustand `create()` stores (no Provider needed), but
 * several of their actions hit the network on mount (loadRooms, loadPlugins,
 * connect), so they are mocked here purely to keep the test hermetic — not
 * because zustand itself requires it.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MotionGlobalConfig } from "framer-motion";
import { AppShell } from "../components/layout/AppShell";

MotionGlobalConfig.skipAnimations = true;

afterEach(() => {
  cleanup();
});

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => {
  const t = (key: string) => {
    if (key === "nav.closeSidebar") return "Close sidebar";
    if (key === "nav.openSidebar") return "Open sidebar";
    return key;
  };
  const setLanguage = () => undefined;
  return {
    useLanguage: () => ({ t, language: "en", setLanguage }),
  };
});

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({
    user: { id: "user-1", username: "lan", isAdmin: false },
    logout: vi.fn(),
  }),
}));

vi.mock("../stores/chatStore", () => ({
  useChatStore: () => ({
    rooms: [],
    unreadCounts: {},
    markRoomAsRead: vi.fn(),
    loadRooms: vi.fn(),
    createRoom: vi.fn(),
    deleteRoom: vi.fn(async () => true),
  }),
}));

vi.mock("../stores/socketStore", () => ({
  useSocketStore: () => ({
    joinRoom: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendMessage: vi.fn(() => true),
  }),
}));

vi.mock("../stores/pluginStore", () => ({
  usePluginStore: (selector: (state: unknown) => unknown) =>
    selector({ plugins: [], loadPlugins: vi.fn(async () => undefined), resetPlugins: vi.fn() }),
}));

vi.mock("../stores/notificationStore", () => ({
  useNotificationStore: (selector: (state: unknown) => unknown) =>
    selector({ items: [], add: vi.fn(() => "notif-1") }),
}));

vi.mock("../hooks/usePendingApprovals", () => ({
  usePendingApprovals: () => 0,
}));

describe("AppShell close/open sidebar buttons (RTL)", () => {
  it("exposes both the mobile close-X and the hamburger open button by name", () => {
    render(
      <MemoryRouter>
        <AppShell>
          <div>page content</div>
        </AppShell>
      </MemoryRouter>,
    );

    // Mutation-sensitive: fails if either aria-label is dropped or moved off
    // the actual <button> element (e.g. onto the surrounding icon or a
    // wrapper), a class of regression the source-text grep guard cannot see.
    const closeButton = screen.getByRole("button", { name: "Close sidebar" });
    expect(closeButton.tagName).toBe("BUTTON");

    const openButton = screen.getByRole("button", { name: "Open sidebar" });
    expect(openButton.tagName).toBe("BUTTON");

    // They are distinct controls.
    expect(closeButton).not.toBe(openButton);
  });
});
