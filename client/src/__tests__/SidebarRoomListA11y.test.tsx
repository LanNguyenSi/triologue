// @vitest-environment jsdom
/**
 * Render-level a11y guard for SidebarRoomList's per-room delete button
 * (a11y round 2, task 74d695bb, control 3/7 from PR #211's icon-only-button
 * sweep). See ConfirmDialogA11y.test.tsx for why a real render assertion is
 * needed in addition to the source-text guard in uiConsistency.test.ts.
 *
 * Unlike the other five controls, this one's accessible name interpolates
 * the room's own name (nav.a11y.deleteRoom: "Delete room: {name}"), so the
 * render assertion also guards that the interpolated value reaches the DOM.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarRoomList } from "../components/layout/SidebarRoomList";

afterEach(() => {
  cleanup();
});

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string) =>
      key === "nav.a11y.deleteRoom" ? "Delete room: {name}" : key,
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
        role: "OWNER",
        lastMessage: null,
      },
    ],
    unreadCounts: {},
    markRoomAsRead: vi.fn(),
  }),
}));

describe("SidebarRoomList delete-room button (RTL)", () => {
  it("exposes a named button interpolating the room's own name", () => {
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

    // Mutation-sensitive: fails if aria-label is dropped, or the {name}
    // interpolation regresses to the raw placeholder / a generic label
    // shared across rows.
    const deleteButton = screen.getByRole("button", {
      name: "Delete room: Project Falcon",
    });
    expect(deleteButton.tagName).toBe("BUTTON");
  });
});
