// @vitest-environment jsdom
/**
 * AgentConfigPage's config-load effect carried `t` in its useEffect
 * dependency array (fixed as part of task a34078b6 Slice 3, review round 2,
 * finding F1) even though the effect body no longer calls `t` directly (the
 * catch branch now uses toastT.error, which reads the current language
 * itself at render time; see client/src/lib/i18nToast.tsx). LanguageProvider
 * memoises `t` per language (#222), so its identity legitimately changes on
 * a real language switch; leaving it in the deps re-fires the loader and
 * refetches the agent config for no reason. See PR #223 (commit a7377d6)
 * for the pattern this mirrors.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { buildLanguageSwitchHarness } from "../test/languageSwitchHarness";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  localStorage.clear();
});

function mockCommonModules(fetchAgentConfigMock: ReturnType<typeof vi.fn>) {
  vi.doMock("../contexts/ThemeContext", () => ({
    useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
  }));
  vi.doMock("../stores/authStore", () => ({
    useAuthStore: () => ({ token: "test-token" }),
  }));
  vi.doMock("../services/agentConfigApi", async () => {
    const actual = await vi.importActual<
      typeof import("../services/agentConfigApi")
    >("../services/agentConfigApi");
    return {
      ...actual,
      fetchAgentConfig: fetchAgentConfigMock,
      updateAgentConfig: vi.fn(),
    };
  });
  vi.doMock("../services/connectorApi", () => ({
    fetchConnectors: vi.fn(async () => []),
    fetchPermissions: vi.fn(async () => []),
    updatePermissions: vi.fn(async () => undefined),
  }));
}

describe("AgentConfigPage does not refetch its config on a real language switch (a34078b6 F1)", () => {
  it("keeps fetchAgentConfig at 1 call after a real setLanguage", async () => {
    const fetchAgentConfigMock = vi.fn(async () => ({
      agentTokenId: "agent-1",
      name: "Test Agent",
      config: {
        messageFrequency: "medium" as const,
        proactivity: "reactive" as const,
        maxMessagesPerMinute: 5,
        canUploadAttachments: true,
        canCreateTasks: false,
        canUpdateTaskStatus: true,
        canDeleteMessages: false,
        suppressMetaReflections: true,
        maxResponseLength: 4000,
        language: "de" as const,
      },
    }));
    mockCommonModules(fetchAgentConfigMock);

    const { AgentConfigPage } = await import("./AgentConfigPage");
    const languageContextModule = await import("../contexts/LanguageContext");

    const Harness = buildLanguageSwitchHarness(
      languageContextModule,
      <MemoryRouter initialEntries={["/admin/agents/agent-1/config"]}>
        <Routes>
          <Route
            path="/admin/agents/:agentTokenId/config"
            element={<AgentConfigPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    render(<Harness />);

    await screen.findByRole("heading", { name: /Test Agent/ });
    expect(fetchAgentConfigMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchAgentConfigMock).toHaveBeenCalledTimes(1);
  });
});
