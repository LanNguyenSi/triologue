// @vitest-environment jsdom
/**
 * Render-level a11y guard for AgentConfigPage's Toggle switch (a11y round 2,
 * task 74d695bb, control 7/7 from PR #211's icon-only-button sweep, plus
 * this round's own role=switch/aria-checked fix).
 *
 * PR #211 gave the Toggle an accessible NAME (aria-label). It still had no
 * accessible STATE: a screen reader announced "Toggle" but never on/off.
 * This test guards both: the name (RTL, matching #211's control) and the
 * state (role=switch + aria-checked, this round's fix).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AgentConfigPage } from "../pages/AgentConfigPage";

afterEach(() => {
  cleanup();
});

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

// `t` and `setLanguage` are defined once at module-eval time (not inside the
// hook factory) so they keep a stable identity across re-renders, matching
// real LanguageProvider behavior (its `t` only changes identity when the
// Provider itself re-renders, e.g. on a language switch — not on every
// consumer-local state update). AgentConfigPage's config-load effect lists
// `t` as a dependency; a fresh function on every call would refire that
// effect (and flash back to the loading state) on every toggle click.
vi.mock("../contexts/LanguageContext", () => {
  const t = (key: string) =>
    key === "agentConfig.toggle.canUploadAttachments"
      ? "Can upload attachments"
      : key;
  const setLanguage = () => undefined;
  return {
    useLanguage: () => ({ t, language: "en", setLanguage }),
  };
});

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({ token: "test-token" }),
}));

vi.mock("../services/agentConfigApi", async () => {
  const actual = await vi.importActual<
    typeof import("../services/agentConfigApi")
  >("../services/agentConfigApi");
  return {
    ...actual,
    fetchAgentConfig: vi.fn(async () => ({
      agentTokenId: "agent-1",
      name: "Test Agent",
      config: { ...actual.DEFAULT_AGENT_CONFIG, canUploadAttachments: true },
    })),
    updateAgentConfig: vi.fn(),
  };
});

vi.mock("../services/connectorApi", () => ({
  fetchConnectors: vi.fn(async () => []),
  fetchPermissions: vi.fn(async () => []),
  updatePermissions: vi.fn(async () => undefined),
}));

describe("AgentConfigPage Toggle switch (RTL)", () => {
  it("announces both an accessible name and its checked state via role=switch/aria-checked", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/admin/agents/agent-1/config"]}>
        <Routes>
          <Route
            path="/admin/agents/:agentTokenId/config"
            element={<AgentConfigPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const toggle = await waitFor(() =>
      screen.getByRole("switch", { name: "Can upload attachments" }),
    );

    // canUploadAttachments starts true per the mocked fetchAgentConfig.
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await user.click(toggle);

    // Toggle is a function component redefined on every AgentConfigPage
    // render, so React remounts a fresh DOM node on state change; re-query
    // rather than reuse the stale (now-detached) `toggle` reference.
    await waitFor(() => {
      const toggleAfter = screen.getByRole("switch", {
        name: "Can upload attachments",
      });
      expect(toggleAfter.getAttribute("aria-checked")).toBe("false");
    });
  });
});
