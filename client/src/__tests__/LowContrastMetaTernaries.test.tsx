// @vitest-environment jsdom
/**
 * Contrast guards for the dead-ternary contrast fixes:
 * - ProjectActivityPage timestamp and meta line used isDark ? text-gray-400 :
 *   text-gray-400 (light 2.43:1 on the page), with the resource id and the
 *   duration dimmed by opacity-75/opacity-60 (down to 2.27:1 light, 3.4:1 dark).
 *   Light now pins text-gray-600 (7.2:1) and the dim spans inherit the solid
 *   line color; dark keeps text-gray-400 (7.6:1 on the dark base).
 * - DashboardPage "soon" badge used bg-gray-700 text-gray-400 in dark (4.06:1);
 *   the text is now text-gray-200 (8.3:1). Light keeps bg-gray-200 text-gray-600.
 * - InboxPage item timestamp and ApprovalsPage history heading, row date and
 *   meta row used isDark ? text-gray-400 : text-gray-400 (light 2.4-2.5:1);
 *   light now pins text-gray-600, dark keeps text-gray-400.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProjectActivityPage } from "../pages/ProjectActivityPage";
import { DashboardPage } from "../pages/DashboardPage";
import { InboxPage } from "../pages/InboxPage";
import { ApprovalsPage } from "../pages/ApprovalsPage";

const themeState = vi.hoisted(() => ({ theme: "light" }));

afterEach(() => {
  cleanup();
  themeState.theme = "light";
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
  useAuthStore: Object.assign(() => ({ user: { id: "user-1" }, token: "tok" }), {
    getState: () => ({ token: "tok" }),
  }),
}));

vi.mock("../stores/notificationStore", () => ({
  useNotificationStore: (selector: (state: { items: unknown[]; loadInbox: unknown }) => unknown) =>
    selector({ items: [], loadInbox: vi.fn() }),
}));

vi.mock("../stores/chatStore", () => ({
  useChatStore: () => ({
    rooms: [{ id: "room-1", name: "Main Triologue", role: "MEMBER" }],
    unreadCounts: { "room-1": 3 },
    loadRooms: vi.fn(),
  }),
}));

vi.mock("../services/auditApi", () => ({
  fetchProjectActivity: vi.fn(async () => ({
    items: [
      {
        id: "e1",
        timestamp: new Date().toISOString(),
        agentId: "agent-1",
        agentName: "Lava Agent",
        action: "task.completed",
        resourceType: "task",
        resourceId: "res-42",
        success: true,
        details: null,
        durationMs: 234,
      },
    ],
    totalCount: 1,
  })),
}));

vi.mock("../lib/apiClient", () => ({
  apiClient: vi.fn(async (url: string) => {
    if (url.startsWith("/api/approvals")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          approvals: [
            {
              id: "a1",
              connectorId: "github",
              actionId: "push",
              riskLevel: "medium",
              reason: "release cut",
              status: "approved",
              taskId: "task-1234567890abcdef",
              projectId: "p1",
              requestedBy: "user-1",
              decidedBy: "user-1",
              decisionNote: "ok",
              createdAt: "2026-10-01T10:00:00.000Z",
              decidedAt: "2026-10-01T10:05:00.000Z",
            },
          ],
        }),
      };
    }
    if (url.startsWith("/api/inbox")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: "i1",
              type: "info",
              title: "Room invite",
              message: "You were added to Project Falcon",
              link: null,
              isRead: false,
              createdAt: "2026-10-01T10:00:00.000Z",
            },
          ],
          unreadCount: 1,
          totalCount: 1,
          pageInfo: { page: 1, limit: 20, totalPages: 1, hasMore: false, nextPage: null },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ id: "p1", name: "Falcon" }) };
  }),
}));

describe("ProjectActivityPage activity-log meta contrast", () => {
  async function renderActivity() {
    render(
      <MemoryRouter initialEntries={["/projects/p1/activity"]}>
        <Routes>
          <Route path="/projects/:projectId/activity" element={<ProjectActivityPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText(/\(res-42\)/);
  }

  it("light: timestamp and meta line use text-gray-600, no dead gray-400 and no opacity dim", async () => {
    themeState.theme = "light";
    await renderActivity();
    const resourceId = screen.getByText(/\(res-42\)/) as HTMLElement;
    const meta = resourceId.parentElement as HTMLElement;
    const entry = meta.closest("div.flex.gap-3") as HTMLElement;
    const timestamp = entry.querySelector("div.whitespace-nowrap") as HTMLElement;
    expect(timestamp.className).toContain("text-gray-600");
    expect(timestamp.className).not.toContain("text-gray-400");
    expect(meta.className).toContain("text-gray-600");
    expect(meta.className).not.toContain("text-gray-400");
    const duration = screen.getByText(/projectActivity.duration/) as HTMLElement;
    expect(resourceId.className).not.toMatch(/opacity-/);
    expect(duration.className).not.toMatch(/opacity-/);
  });

  it("dark: timestamp and meta line keep text-gray-400, no opacity dim", async () => {
    themeState.theme = "dark";
    await renderActivity();
    const resourceId = screen.getByText(/\(res-42\)/) as HTMLElement;
    const meta = resourceId.parentElement as HTMLElement;
    const entry = meta.closest("div.flex.gap-3") as HTMLElement;
    const timestamp = entry.querySelector("div.whitespace-nowrap") as HTMLElement;
    expect(timestamp.className).toContain("text-gray-400");
    expect(meta.className).toContain("text-gray-400");
    expect(meta.className).not.toContain("text-gray-600");
    const duration = screen.getByText(/projectActivity.duration/) as HTMLElement;
    expect(resourceId.className).not.toMatch(/opacity-/);
    expect(duration.className).not.toMatch(/opacity-/);
  });
});

describe("DashboardPage soon badge contrast", () => {
  function soonBadges(): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLSpanElement>("span.absolute.top-3.right-3"),
    ).filter((el) => el.textContent === "landing.platform.soon");
  }

  it("dark: soon badge is bg-gray-700 with text-gray-200, never text-gray-400", async () => {
    themeState.theme = "dark";
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    const badges = await vi.waitFor(() => {
      const found = soonBadges();
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    for (const badge of badges as unknown as HTMLElement[]) {
      expect(badge.className).toContain("bg-gray-700");
      expect(badge.className).toContain("text-gray-200");
      expect(badge.className).not.toContain("text-gray-400");
    }
  });

  it("light: soon badge keeps bg-gray-200 with text-gray-600", async () => {
    themeState.theme = "light";
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    const badges = await vi.waitFor(() => {
      const found = soonBadges();
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    for (const badge of badges as unknown as HTMLElement[]) {
      expect(badge.className).toContain("bg-gray-200");
      expect(badge.className).toContain("text-gray-600");
    }
  });
});

describe("InboxPage item timestamp contrast", () => {
  it("light: timestamp uses text-gray-600, not the dead text-gray-400", async () => {
    themeState.theme = "light";
    render(
      <MemoryRouter>
        <InboxPage />
      </MemoryRouter>,
    );
    await screen.findByText("Room invite");
    const timestamp = document.querySelector("div.text-\\[11px\\]") as HTMLElement;
    expect(timestamp.className).toContain("text-gray-600");
    expect(timestamp.className).not.toContain("text-gray-400");
  });

  it("dark: timestamp keeps text-gray-400", async () => {
    themeState.theme = "dark";
    render(
      <MemoryRouter>
        <InboxPage />
      </MemoryRouter>,
    );
    await screen.findByText("Room invite");
    const timestamp = document.querySelector("div.text-\\[11px\\]") as HTMLElement;
    expect(timestamp.className).toContain("text-gray-400");
    expect(timestamp.className).not.toContain("text-gray-600");
  });
});

describe("ApprovalsPage meta text contrast", () => {
  async function renderApprovals() {
    render(
      <MemoryRouter>
        <ApprovalsPage />
      </MemoryRouter>,
    );
    await screen.findByText("approvals.history");
  }

  it("light: history heading, row date and meta row use text-gray-600", async () => {
    themeState.theme = "light";
    await renderApprovals();
    const heading = screen.getByText("approvals.history");
    const rowDate = document.querySelector("div.flex.items-center.gap-1.text-xs") as HTMLElement;
    const metaRow = document.querySelector("div.flex.flex-wrap.text-xs") as HTMLElement;
    expect(heading.className).toContain("text-gray-600");
    expect(heading.className).not.toContain("text-gray-400");
    expect(rowDate.className).toContain("text-gray-600");
    expect(rowDate.className).not.toContain("text-gray-400");
    expect(metaRow.className).toContain("text-gray-600");
    expect(metaRow.className).not.toContain("text-gray-400");
  });

  it("dark: history heading, row date and meta row keep text-gray-400", async () => {
    themeState.theme = "dark";
    await renderApprovals();
    const heading = screen.getByText("approvals.history");
    const rowDate = document.querySelector("div.flex.items-center.gap-1.text-xs") as HTMLElement;
    const metaRow = document.querySelector("div.flex.flex-wrap.text-xs") as HTMLElement;
    expect(heading.className).toContain("text-gray-400");
    expect(rowDate.className).toContain("text-gray-400");
    expect(metaRow.className).toContain("text-gray-400");
  });
});
