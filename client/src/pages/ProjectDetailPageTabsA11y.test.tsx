// @vitest-environment jsdom
/**
 * Render-level a11y guard for the ProjectDetailPage tab bar (WAI-ARIA tabs
 * pattern): the tablist owns only its tabs (the "Aktivitat" link is a
 * sibling), every tab is wired to its panel via aria-controls /
 * aria-labelledby, the roving tabindex keeps exactly one tab in the tab
 * order, and ArrowLeft/ArrowRight/Home/End move selection and focus with
 * automatic activation (wrapping at both ends).
 *
 * Stores and the API client are mocked the way the other page tests mock
 * them (see ProjectEditPage.test.tsx / LoginPageA11y.test.tsx); the page
 * itself renders for real so the roles come from the real DOM.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

afterEach(() => {
  cleanup();
});

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => {
  const messages: Record<string, string> = {
    "projects.tab.tasks": "Aufgaben",
    "projects.tab.team": "Team",
    "projects.tab.secrets": "Secrets",
  };
  const t = (key: string) => messages[key] ?? key;
  return {
    useLanguage: () => ({ t, language: "de", setLanguage: vi.fn() }),
  };
});

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({ user: { id: "u1", username: "lan", isAdmin: false } }),
}));

vi.mock("../lib/apiClient", () => ({
  apiClient: vi.fn(async (path: string) => {
    if (path.startsWith("/api/plugins/")) {
      return { ok: true, status: 200, json: async () => ({ plugins: [] }) };
    }
    if (path.endsWith("/secrets")) {
      return { ok: true, status: 200, json: async () => [] };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "p1",
        name: "Project One",
        description: "",
        status: "active",
        ownerId: "u1",
        teamMemberIds: [],
        teamMembers: [],
        workflowConfig: {},
        projectContext: {},
        tasks: [],
        attachments: [],
      }),
    };
  }),
}));

const renderPage = async (path = "/projects/p1") => {
  const { ProjectDetailPage } = await import("./ProjectDetailPage");
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  // The page shows a spinner until the project fetch resolves.
  await screen.findByRole("tablist");
};

const tabs = () => screen.getAllByRole("tab");
const selectedTab = () => screen.getByRole("tab", { selected: true });
const panel = () => screen.getByRole("tabpanel");

describe("ProjectDetailPage tablist structure (RTL)", () => {
  it("keeps the tablist free of non-tab children and the activity link beside it", async () => {
    await renderPage();

    const tablist = screen.getByRole("tablist");
    expect(within(tablist).getAllByRole("tab")).toHaveLength(3);
    // Mutation-sensitive: re-nesting the Aktivitat link into the tablist
    // (the pre-fix markup) makes this non-null (and breaks aria-required-
    // children in axe).
    expect(tablist.querySelector("a")).toBeNull();

    const activity = screen.getByRole("link", { name: "Aktivität" });
    expect(tablist.contains(activity)).toBe(false);
  });

  it("wires each tab to its panel via id/aria-controls and the panel back via aria-labelledby", async () => {
    await renderPage();

    for (const tab of tabs()) {
      const controls = tab.getAttribute("aria-controls");
      expect(controls).toBeTruthy();
      // Every referenced panel id exists in the DOM, also for inactive
      // (hidden) panels, so the IDREF never dangles.
      const target = document.getElementById(controls as string);
      expect(target).toBeTruthy();
      expect(target?.getAttribute("role")).toBe("tabpanel");
    }

    const active = selectedTab();
    const activePanel = panel();
    expect(activePanel.getAttribute("id")).toBe(
      active.getAttribute("aria-controls"),
    );
    expect(activePanel.getAttribute("aria-labelledby")).toBe(active.id);
    expect(activePanel.getAttribute("tabindex")).toBe("0");
    expect(active.id).toBeTruthy();
  });

  it("uses a roving tabindex: only the selected tab is in the tab order", async () => {
    await renderPage();

    for (const tab of tabs()) {
      expect(tab.getAttribute("tabindex")).toBe(
        tab.getAttribute("aria-selected") === "true" ? "0" : "-1",
      );
    }
  });
});

describe("ProjectDetailPage tab keyboard interaction (RTL)", () => {
  it("ArrowRight moves to and activates the next tab and moves focus with it", async () => {
    const user = userEvent.setup();
    await renderPage();

    tabs()[0].focus();
    await user.keyboard("{ArrowRight}");

    expect(selectedTab()).toBe(screen.getByRole("tab", { name: "Team" }));
    expect(document.activeElement).toBe(selectedTab());
  });

  it("ArrowLeft moves to and activates the previous tab and moves focus with it", async () => {
    const user = userEvent.setup();
    await renderPage("/projects/p1?tab=team");

    tabs()[1].focus();
    await user.keyboard("{ArrowLeft}");

    expect(selectedTab()).toBe(screen.getByRole("tab", { name: "Aufgaben" }));
    expect(document.activeElement).toBe(selectedTab());
  });

  it("ArrowRight on the last tab wraps to the first, ArrowLeft on the first wraps to the last", async () => {
    const user = userEvent.setup();
    await renderPage("/projects/p1?tab=secrets");

    tabs()[2].focus();
    await user.keyboard("{ArrowRight}");
    // Mutation-sensitive on the ArrowRight modulo: without wrapping,
    // selection stays on "secrets".
    expect(selectedTab()).toBe(screen.getByRole("tab", { name: "Aufgaben" }));
    expect(document.activeElement).toBe(selectedTab());

    await user.keyboard("{ArrowLeft}");
    // Mutation-sensitive on the ArrowLeft wrap-around: without it,
    // selection stays on "Aufgaben".
    expect(selectedTab()).toBe(screen.getByRole("tab", { name: "Secrets" }));
    expect(document.activeElement).toBe(selectedTab());
  });

  it("Home selects and focuses the first tab, End the last", async () => {
    const user = userEvent.setup();
    await renderPage("/projects/p1?tab=team");

    tabs()[1].focus();
    await user.keyboard("{End}");
    // Mutation-sensitive on the End branch: without it focus stays on Team.
    expect(selectedTab()).toBe(screen.getByRole("tab", { name: "Secrets" }));
    expect(document.activeElement).toBe(selectedTab());

    await user.keyboard("{Home}");
    // Mutation-sensitive on the Home branch.
    expect(selectedTab()).toBe(screen.getByRole("tab", { name: "Aufgaben" }));
    expect(document.activeElement).toBe(selectedTab());
  });

  it("clicking a tab still activates it (mouse behavior unchanged)", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole("tab", { name: "Team" }));
    expect(selectedTab()).toBe(screen.getByRole("tab", { name: "Team" }));
  });
});
