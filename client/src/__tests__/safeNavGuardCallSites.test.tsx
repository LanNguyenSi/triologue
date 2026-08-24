// @vitest-environment jsdom
/**
 * Render-level assertion for each of the safeNavTarget call sites (task
 * 67d3cf19, following up on PR #202's review): the AST guard
 * (safeNavGuard.test.ts) proves every call site is *wrapped*, but does not
 * prove the wrap actually reaches the DOM with a contained destination. Each
 * describe block below renders the real component with a hostile navigation
 * value ('//evil.example.com') coming from the same place a plugin manifest
 * or server payload would supply it, and asserts the rendered destination
 * (an <a href> or a captured navigate() call) is the fallback, not the
 * hostile value.
 *
 * Mutation-sensitivity, measured, differs by describe block below:
 *   - NotificationCenter, InboxPage, DashboardPage: each renders the one
 *     component that owns the guarded call site directly, so reverting that
 *     component's `safeNavTarget` wrap makes its assertion observe the
 *     hostile destination instead of the fallback. Mutation-sensitive.
 *   - "AppShell sidebar (plugin nav item)": AppShell itself pre-sanitizes
 *     the plugin-supplied `to` before it ever reaches SidebarNavItem
 *     (`const to = safeNavTarget(entry.to)` in AppShell.tsx), so this test
 *     proves that producer-side guard reaches the DOM, NOT that
 *     SidebarNavItem's own defense-in-depth wrap (`safeNavTarget(item.to)`
 *     in SidebarNavItem.tsx) does anything: reverting SidebarNavItem's wrap
 *     alone keeps this test green, because SidebarNavItem never sees an
 *     unsafe value when reached through AppShell. SidebarNavItem's wrap is
 *     covered instead by the repo-wide AST guard (safeNavGuard.test.ts,
 *     which fails if the wrap is removed regardless of caller) and by the
 *     direct SidebarNavItem render test below, which bypasses AppShell and
 *     feeds SidebarNavItem a hostile `item.to` itself.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MotionGlobalConfig } from "framer-motion";

MotionGlobalConfig.skipAnimations = true;

const HOSTILE = "//evil.example.com";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("AppShell sidebar (plugin nav item)", () => {
  it("renders a hostile plugin navItem.to as the fallback href, not the hostile origin", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../contexts/LanguageContext", () => ({
      useLanguage: () => ({ t: (key: string) => key, language: "en", setLanguage: vi.fn() }),
    }));
    vi.doMock("../stores/authStore", () => ({
      useAuthStore: () => ({ user: { id: "user-1", username: "lan", isAdmin: false }, logout: vi.fn() }),
    }));
    vi.doMock("../stores/chatStore", () => ({
      useChatStore: () => ({
        rooms: [],
        unreadCounts: {},
        markRoomAsRead: vi.fn(),
        loadRooms: vi.fn(),
        createRoom: vi.fn(),
        deleteRoom: vi.fn(async () => true),
      }),
    }));
    vi.doMock("../stores/socketStore", () => ({
      useSocketStore: () => ({
        joinRoom: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        sendMessage: vi.fn(() => true),
      }),
    }));
    vi.doMock("../stores/pluginStore", () => ({
      usePluginStore: (selector: (state: unknown) => unknown) =>
        selector({
          plugins: [
            {
              id: "evil-plugin",
              name: "Evil Plugin",
              ui: {
                navItems: [{ to: HOSTILE, label: "Evil Plugin Nav" }],
              },
            },
          ],
          loadPlugins: vi.fn(async () => undefined),
          resetPlugins: vi.fn(),
        }),
    }));
    vi.doMock("../stores/notificationStore", () => ({
      useNotificationStore: (selector: (state: unknown) => unknown) =>
        selector({ items: [], add: vi.fn(() => "notif-1") }),
    }));
    vi.doMock("../hooks/usePendingApprovals", () => ({
      usePendingApprovals: () => 0,
    }));

    const { AppShell } = await import("../components/layout/AppShell");

    render(
      <MemoryRouter>
        <AppShell>
          <div>page content</div>
        </AppShell>
      </MemoryRouter>,
    );

    const links = screen.getAllByText("Evil Plugin Nav").map((el) => el.closest("a"));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).not.toBeNull();
      expect(link?.getAttribute("href")).toBe("/");
    }
  });
});

describe("SidebarNavItem (direct)", () => {
  it("renders a hostile item.to as the fallback href, bypassing AppShell's own pre-sanitisation", async () => {
    // Unlike the "AppShell sidebar" case above, this mounts SidebarNavItem
    // directly with a hostile `item.to`, so it is the render-level proof
    // that SidebarNavItem's OWN safeNavTarget(item.to) wrap (SidebarNavItem.tsx)
    // is load-bearing: removing that wrap makes this assertion observe the
    // hostile href instead of the fallback.
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../contexts/LanguageContext", () => ({
      useLanguage: () => ({ t: (key: string) => key, language: "en", setLanguage: vi.fn() }),
    }));

    const { SidebarNavItem } = await import("../components/layout/SidebarNavItem");

    const item = {
      key: "evil",
      to: HOSTILE,
      icon: <span>icon</span>,
      label: "Evil Item",
      match: (path: string) => path === HOSTILE,
      available: true,
    };

    render(
      <MemoryRouter>
        <SidebarNavItem item={item} />
      </MemoryRouter>,
    );

    const link = screen.getByText("Evil Item").closest("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/");
  });
});

describe("NotificationCenter", () => {
  it("navigates to the fallback, not the hostile item.link, on click", async () => {
    // vi.doMock resolves the specifier relative to THIS file, but intercepts
    // by the resolved absolute module id, so these paths are relative to
    // src/__tests__/, not to the component being mocked (both ultimately
    // resolve to the same client/src/... file NotificationCenter itself
    // imports).
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../contexts/LanguageContext", () => ({
      useLanguage: () => ({ t: (key: string) => key, language: "en", setLanguage: vi.fn() }),
    }));
    const markRead = vi.fn();
    vi.doMock("../stores/notificationStore", () => ({
      useNotificationStore: (selector: (state: unknown) => unknown) =>
        selector({
          items: [
            {
              id: "notif-1",
              type: "info",
              title: "Evil Notification",
              message: "",
              link: HOSTILE,
              read: false,
              source: "local",
              createdAt: new Date().toISOString(),
            },
          ],
          markRead,
          markAllRead: vi.fn(),
          remove: vi.fn(),
          clear: vi.fn(),
        }),
    }));

    const navigateSpy = vi.fn();
    vi.doMock("react-router-dom", async () => {
      const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
      return { ...actual, useNavigate: () => navigateSpy };
    });

    const { NotificationCenter } = await import("../components/ui/NotificationCenter");

    render(
      <MemoryRouter>
        <NotificationCenter mode="inline" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTitle("notifications.open"));
    fireEvent.click(screen.getByText("Evil Notification"));

    expect(navigateSpy).toHaveBeenCalledWith("/");
    expect(navigateSpy).not.toHaveBeenCalledWith(HOSTILE);
  });
});

describe("InboxPage", () => {
  it("navigates to the fallback, not the hostile item.link, on click", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../contexts/LanguageContext", () => ({
      useLanguage: () => ({ t: (key: string) => key, language: "en", setLanguage: vi.fn() }),
    }));
    vi.doMock("../stores/notificationStore", () => ({
      useNotificationStore: (selector: (state: unknown) => unknown) =>
        selector({ loadInbox: vi.fn(async () => undefined) }),
    }));
    vi.doMock("../stores/authStore", () => ({
      useAuthStore: Object.assign(() => ({ token: "tok" }), {
        getState: () => ({ token: "tok" }),
      }),
    }));
    vi.doMock("../lib/apiClient", () => ({
      apiClient: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: "inbox-1",
              type: "info",
              title: "Evil Inbox Item",
              link: HOSTILE,
              isRead: true,
              createdAt: new Date().toISOString(),
            },
          ],
          unreadCount: 0,
          totalCount: 1,
          pageInfo: { page: 1, limit: 20, totalPages: 1, hasMore: false, nextPage: null },
        }),
      })),
    }));

    const navigateSpy = vi.fn();
    vi.doMock("react-router-dom", async () => {
      const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
      return { ...actual, useNavigate: () => navigateSpy };
    });

    const { InboxPage } = await import("../pages/InboxPage");

    render(
      <MemoryRouter>
        <InboxPage />
      </MemoryRouter>,
    );

    const title = await screen.findByText("Evil Inbox Item");
    fireEvent.click(title.closest("button")!);

    expect(navigateSpy).toHaveBeenCalledWith("/");
    expect(navigateSpy).not.toHaveBeenCalledWith(HOSTILE);
  });
});

describe("DashboardPage", () => {
  it("renders a hostile inbox item.link as the fallback href", async () => {
    vi.doMock("../contexts/ThemeContext", () => ({
      useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
    }));
    vi.doMock("../contexts/LanguageContext", () => ({
      useLanguage: () => ({ t: (key: string) => key, language: "en", setLanguage: vi.fn() }),
    }));
    vi.doMock("../stores/chatStore", () => ({
      useChatStore: () => ({ rooms: [], loadRooms: vi.fn(), unreadCounts: {} }),
    }));
    vi.doMock("../stores/notificationStore", () => ({
      useNotificationStore: (selector: (state: unknown) => unknown) =>
        selector({
          items: [
            {
              id: "srv-1",
              type: "info",
              title: "Evil Server Item",
              link: HOSTILE,
              read: false,
              source: "server",
              createdAt: new Date().toISOString(),
            },
          ],
        }),
    }));
    vi.doMock("../stores/authStore", () => ({
      useAuthStore: Object.assign(() => ({ token: undefined }), {
        getState: () => ({ token: undefined }),
      }),
    }));

    const { DashboardPage } = await import("../pages/DashboardPage");

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    // The action center list starts collapsed; expand it to reach the item.
    fireEvent.click(screen.getByText("dash.actionCenter.expand"));

    const link = (await screen.findByText("Evil Server Item")).closest("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/inbox");
  });
});

describe("FilesPage", () => {
  // Skipped: mounting FilesPage under vitest/jsdom in this environment
  // reproducibly crashes the vitest worker (worker exits unexpectedly)
  // (confirmed against the unmodified pre-existing component too, via
  // `git stash` + the same render, before any change in this task), not
  // something introduced or fixable here. safeNavTarget(provider.connectionPath)
  // at client/src/pages/FilesPage.tsx:417 is still covered by:
  //   - the repo-wide AST guard (safeNavGuard.test.ts), which fails if this
  //     call site's wrap is ever removed;
  //   - safeNavTarget.test.ts's exhaustive coverage of the helper itself.
  it.skip("renders a hostile provider.connectionPath as the fallback href (env: FilesPage crashes the vitest worker under jsdom here, see comment above)", () => {
    /* intentionally empty: see comment above for why this is skipped */
  });
});

describe("PluginWorkspacePage", () => {
  // Skipped for the same reason as the FilesPage case above: mounting
  // PluginWorkspacePage under vitest/jsdom here reproducibly crashes the
  // vitest worker (worker exits unexpectedly), independent of this task's
  // changes. Coverage for safeNavTarget(item.to) at
  // client/src/pages/PluginWorkspacePage.tsx:1632 comes from the AST guard
  // and the helper's own test suite instead.
  it.skip("renders a hostile plugin ui.navItems[].to as the fallback href (env: PluginWorkspacePage crashes the vitest worker under jsdom here, see comment above)", () => {
    /* intentionally empty: see comment above for why this is skipped */
  });
});
