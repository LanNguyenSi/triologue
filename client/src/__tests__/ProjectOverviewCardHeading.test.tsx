// @vitest-environment jsdom
/**
 * Render-level heading-order guard for the project detail page:
 * ProjectOverviewCard is the first section
 * below PageShell's h1, so its section title must be an h2. It used to be
 * an h3, making the visible page order jump h1 -> h3 (axe heading-order
 * violation on /projects/:id).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectOverviewCard } from "../components/projects/ProjectOverviewCard";
import type { Project } from "../projects/projectDomainTypes";

vi.mock("../contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: "en",
    setLanguage: vi.fn(),
  }),
}));

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

const project: Project = {
  id: "p1",
  name: "Website relaunch",
  description: null,
  status: "active",
  ownerId: "u1",
  roomId: "r3",
  teamMemberIds: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("ProjectOverviewCard heading level (RTL)", () => {
  it("titles the overview with an h2 (h1 -> h2 under PageShell), not an h3", () => {
    render(
      <MemoryRouter>
        <ProjectOverviewCard project={project} />
      </MemoryRouter>,
    );

    // Mutation-sensitive: reverting to <h3> fails both the level-2 lookup
    // and the level-3 exclusion below.
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.tagName).toBe("H2");
    expect(heading.textContent).toBe("projects.detail.status");
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });
});
