// @vitest-environment jsdom
/**
 * Heading-order guard for /projects: the page owns one h1 (the PageShell
 * title) and the mobile card list used to render every project name in an
 * <h3>, so the first heading after the h1 jumped two levels (axe
 * heading-order). The names are h2 now, which keeps the reading order valid
 * in both lists (the desktop rows are plain divs).
 *
 * jsdom applies no CSS media queries, so both the desktop and the mobile
 * list render; the mobile list is addressed through its md:hidden wrapper.
 * Only the mocks the other page tests need are installed (see
 * ProjectDetailPageTabsA11y.test.tsx), the page itself renders for real.
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
    "projects.title": "Projekte",
    "projects.description": "Alle Projekte",
    "projects.empty": "Keine Projekte",
    "common.createAction": "Neu",
  };
  return {
    useLanguage: () => ({
      t: (key: string) => messages[key] ?? key,
      language: "de",
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

vi.mock("../lib/apiClient", () => ({
  apiClient: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      items: [
        {
          id: "p1",
          name: "Website relaunch",
          description: "Kickoff",
          status: "active",
          ownerId: "u1",
          teamMemberIds: [],
          roomId: "r3",
          _count: { tasks: 3, secrets: 0 },
          createdAt: "2026-01-05T10:00:00.000Z",
        },
        {
          id: "p2",
          name: "Empty project",
          description: "",
          status: "active",
          ownerId: "u1",
          teamMemberIds: [],
          roomId: null,
          _count: { tasks: 0, secrets: 0 },
          createdAt: "2026-01-06T10:00:00.000Z",
        },
      ],
      totalCount: 2,
      pageInfo: { limit: 8, hasMore: false, nextCursor: null },
    }),
  })),
}));

const mobileList = (container: HTMLElement) => {
  const list = container.querySelector(".md\\:hidden");
  expect(list).toBeTruthy();
  return list as HTMLElement;
};

const headingLevels = () =>
  [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) =>
    Number(h.tagName.slice(1)),
  );

describe("ProjectsPage heading order (axe heading-order)", () => {
  it("renders one h1 and no h3 in the project rows", async () => {
    const { ProjectsPage } = await import("./ProjectsPage");
    const { container } = render(
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectsPage />
      </MemoryRouter>,
    );

    // Both lists render under jsdom (no media queries), so each name matches
    // once in the desktop row and once in the mobile card.
    await screen.findAllByText("Website relaunch");

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(container.querySelectorAll("h3")).toHaveLength(0);
  });

  it("gives every mobile card row an h2 with the previous visual size class", async () => {
    const { ProjectsPage } = await import("./ProjectsPage");
    const { container } = render(
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectsPage />
      </MemoryRouter>,
    );

    // Both lists render under jsdom (no media queries), so each name matches
    // once in the desktop row and once in the mobile card.
    await screen.findAllByText("Website relaunch");

    const rows = mobileList(container).querySelectorAll("h2");
    expect(rows).toHaveLength(2);
    expect([...rows].map((h) => h.textContent)).toEqual([
      "Website relaunch",
      "Empty project",
    ]);
    // The look is carried by these classes, not by the heading level:
    // Tailwind's preflight resets heading font-size/weight to inherit, so
    // h2 and h3 render identically with them.
    for (const row of rows) {
      expect(row.className).toContain("font-bold");
      expect(row.className).toContain("truncate");
    }
  });

  it("never increases the heading level by more than one in DOM order", async () => {
    const { ProjectsPage } = await import("./ProjectsPage");
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <ProjectsPage />
      </MemoryRouter>,
    );

    // Both lists render under jsdom (no media queries), so each name matches
    // once in the desktop row and once in the mobile card.
    await screen.findAllByText("Website relaunch");

    const levels = headingLevels();
    expect(levels.length).toBeGreaterThan(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });
});
