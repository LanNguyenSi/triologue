// @vitest-environment jsdom
/**
 * Accessible-name guard for the desktop stat buttons on /projects. The
 * desktop table rows render the team-member and task counts as icon +
 * number only, so before the fix their accessible name was just "4" (the
 * mobile cards already showed the t('projects.list.team') /
 * t('projects.list.tasks') labels). Both desktop buttons now carry an
 * aria-label built from the projects.a11y.teamCount / taskCount keys with
 * the count, and the icons are aria-hidden.
 *
 * jsdom applies no CSS media queries, so both lists render; the mobile
 * button names ("4 Team") never collide with the asserted desktop names
 * ("Team: 4"), so a strict getByRole match can only hit the desktop row.
 * Mock set is the one the other page tests use (see
 * ProjectsPageHeadingOrder.test.tsx).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

afterEach(() => {
  cleanup();
});

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => {
  const messages: Record<string, string> = {
    "projects.title": "Projects",
    "projects.description": "All projects",
    "projects.empty": "No projects",
    "common.createAction": "New",
    "projects.a11y.teamCount": "Team: {count}",
    "projects.a11y.taskCount": "Tasks: {count}",
  };
  return {
    useLanguage: () => ({
      t: (key: string) => messages[key] ?? key,
      language: "en",
      setLanguage: vi.fn(),
    }),
  };
});

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({ user: { id: "u1", username: "lan", isAdmin: false } }),
}));

vi.mock("../stores/chatStore", () => ({
  useChatStore: (selector: (state: { loadRooms: unknown }) => unknown) =>
    selector({ loadRooms: vi.fn() }),
}));

const PROJECT = {
  id: "p1",
  name: "Website relaunch",
  description: "Kickoff",
  status: "active",
  ownerId: "u1",
  teamMemberIds: ["u1", "u2", "u3", "u4"],
  roomId: null,
  _count: { tasks: 9, secrets: 0 },
  createdAt: "2026-01-05T10:00:00.000Z",
};

vi.mock("../lib/apiClient", () => ({
  apiClient: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      items: [PROJECT],
      totalCount: 1,
      pageInfo: { limit: 8, hasMore: false, nextCursor: null },
    }),
  })),
}));

describe("ProjectsPage desktop stat button names", () => {
  it("names the team button with the label and the count", async () => {
    const { ProjectsPage } = await import("./ProjectsPage");
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectsPage />
      </MemoryRouter>,
    );

    await screen.findAllByText("Website relaunch");

    const teamButton = screen.getByRole("button", { name: "Team: 4" });
    expect(teamButton).toBeTruthy();
    const icon = teamButton.querySelector("svg") as SVGElement;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  });

  it("names the tasks button with the label and the count", async () => {
    const { ProjectsPage } = await import("./ProjectsPage");
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectsPage />
      </MemoryRouter>,
    );

    await screen.findAllByText("Website relaunch");

    const tasksButton = screen.getByRole("button", { name: "Tasks: 9" });
    expect(tasksButton).toBeTruthy();
    const icon = tasksButton.querySelector("svg") as SVGElement;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
  });

  it("falls back to 0 in both names when the counts are missing", async () => {
    const { apiClient } = await import("../lib/apiClient");
    (apiClient as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{ ...PROJECT, teamMemberIds: undefined, _count: undefined }],
        totalCount: 1,
        pageInfo: { limit: 8, hasMore: false, nextCursor: null },
      }),
    });
    const { ProjectsPage } = await import("./ProjectsPage");
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectsPage />
      </MemoryRouter>,
    );

    await screen.findAllByText("Website relaunch");

    expect(screen.getByRole("button", { name: "Team: 0" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tasks: 0" })).toBeTruthy();
  });
});
