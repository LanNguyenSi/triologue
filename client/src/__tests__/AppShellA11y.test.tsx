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
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    // Interpolated by SidebarRoomList's deleteRoomLabel() with the room name.
    if (key === "nav.a11y.deleteRoom") return "Delete room: {name}";
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
    rooms: [
      { id: "room-42", name: "Project Falcon", role: "OWNER", lastMessage: null },
      { id: "room-77", name: "Other Room", role: "OWNER", lastMessage: null },
    ],
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

describe("AppShell mobile drawer inert state (RTL)", () => {
  it("marks the closed drawer inert and the open drawer interactive, never the desktop sidebar", () => {
    const { container } = render(
      <MemoryRouter>
        <AppShell>
          <div>page content</div>
        </AppShell>
      </MemoryRouter>,
    );

    // The mobile drawer is the fixed off-canvas container; the desktop
    // sidebar is the separate md:flex container (AppShell renders both).
    const drawer = screen
      .getByRole("button", { name: "Close sidebar" })
      .closest("aside.fixed.left-0") as HTMLElement;
    const desktopSidebar = container.querySelector(
      "aside.md\\:flex",
    ) as HTMLElement;
    expect(drawer).toBeTruthy();
    expect(desktopSidebar).toBeTruthy();

    // Closed (translate-x-full): inert keeps the drawer out of the tab
    // order and the a11y tree. Mutation-sensitive on both branches:
    // dropping `inert={!open}` fails the closed assert, hardcoding
    // `inert` fails the open and desktop asserts.
    expect(drawer.hasAttribute("inert")).toBe(true);
    expect(desktopSidebar.hasAttribute("inert")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Open sidebar" }));

    expect(drawer.hasAttribute("inert")).toBe(false);
    expect(desktopSidebar.hasAttribute("inert")).toBe(false);
  });
});

describe("AppShell landmarks (RTL)", () => {
  it("exposes both sidebars as named complementary landmarks and a named nav, and renders no main", () => {
    // jsdom applies no CSS, so both sidebar copies (mobile drawer + desktop)
    // are in the a11y tree; AppShell renders both. Pages provide their own
    // <main> (PageShell), so the shell must not add one.
    const { container } = render(
      <MemoryRouter>
        <AppShell>
          <div>page content</div>
        </AppShell>
      </MemoryRouter>,
    );

    // Mutation-sensitive: reverting either sidebar container to a plain
    // <div> drops the count below 2 (or loses the accessible name).
    const asides = screen.getAllByRole("complementary");
    expect(asides).toHaveLength(2);
    for (const aside of asides) {
      expect(aside.tagName).toBe("ASIDE");
      expect(aside.getAttribute("aria-label")).toBe("Seitenleiste");
    }

    const navs = screen.getAllByRole("navigation");
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      expect(nav.getAttribute("aria-label")).toBe("Hauptnavigation");
    }

    expect(container.querySelector("main")).toBeNull();
  });
});

describe("AppShell delete-room dialog keyboard behavior (RTL)", () => {
  // The desktop sidebar copy is the last render of each control (AppShell
  // renders the mobile drawer first); jsdom applies no CSS, so both copies
  // are in the a11y tree. The desktop copy is the keyboard path reviewers hit
  // at >=md widths (the drawer copy sits in the closed, inert drawer).
  const desktopDeleteButton = () =>
    screen
      .getAllByRole("button", { name: "Delete room: Project Falcon" })
      .pop() as HTMLElement;

  it("Escape closes the dialog opened with Enter on the focused delete button and restores focus to it", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppShell>
          <div>page content</div>
        </AppShell>
      </MemoryRouter>,
    );

    const trigger = desktopDeleteButton();
    trigger.focus();
    // Enter on a focused button activates its click (the reported open path).
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Modal moves focus into the dialog (its first focusable element).
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
      true,
    );

    await user.keyboard("{Escape}");
    // Mutation-sensitive on Modal's Escape -> onClose path: without it the
    // dialog never leaves the DOM.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Mutation-sensitive on Modal's focus restore: focus returns to the
    // delete button that opened the dialog.
    expect(document.activeElement).toBe(trigger);
  });

  it("SPA navigation to another room closes the dialog and returns focus to the delete button", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppShell>
          <div>page content</div>
        </AppShell>
      </MemoryRouter>,
    );

    const trigger = desktopDeleteButton();
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();

    // SPA route change while the dialog is open (the sidebar persists, so
    // this is a location change, not an unmount).
    const otherRoomLink = screen
      .getAllByRole("link", { name: /Other Room/ })
      .pop() as HTMLElement;
    await user.click(otherRoomLink);

    // Mutation-sensitive on AppShell's route-change close (the reported bug:
    // the dialog survived navigation and kept its focus trap over the new
    // page until a full reload).
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
