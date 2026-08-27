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
 *
 * Also covers the review round 2 F2/F3 feedback-banner fix's own missing
 * behavioural test (review round 3, F3): `feedback.text` is a `{ key } |
 * { message }` union (mirrors PluginWorkspacePage's `runError`), not an
 * already-translated string, so the banner re-translates the KEY arm at
 * render time and passes the MESSAGE arm through verbatim. Without a test,
 * mutating `t(feedback.text.key)` back to `feedback.text.key` (rendering
 * the raw key instead of translating it) stayed green.
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

function mockCommonModules(
  fetchAgentConfigMock: ReturnType<typeof vi.fn>,
  updateAgentConfigMock: ReturnType<typeof vi.fn> = vi.fn(),
) {
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
      updateAgentConfig: updateAgentConfigMock,
    };
  });
  vi.doMock("../services/connectorApi", () => ({
    fetchConnectors: vi.fn(async () => []),
    fetchPermissions: vi.fn(async () => []),
    updatePermissions: vi.fn(async () => undefined),
  }));
}

const AGENT_CONFIG_FIXTURE = {
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
};

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

function renderAgentConfigPage() {
  return Promise.all([
    import("./AgentConfigPage"),
    import("../contexts/LanguageContext"),
  ]).then(([{ AgentConfigPage }, languageContextModule]) => {
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
  });
}

describe("AgentConfigPage feedback banner translates the `{ key }` arm at render time (review round 3, F3)", () => {
  it("shows the reset-done key's translation, and re-translates it after a real language switch", async () => {
    const fetchAgentConfigMock = vi.fn(async () => AGENT_CONFIG_FIXTURE);
    mockCommonModules(fetchAgentConfigMock);

    await renderAgentConfigPage();
    await screen.findByRole("heading", { name: /Test Agent/ });

    // handleReset stores `{ key: "agentConfig.resetDone" }`, not an
    // already-translated string; the banner shows German (the default
    // language), proving it translated the key at render time.
    fireEvent.click(screen.getByText("Zurücksetzen"));
    await screen.findByText("Auf Standardwerte zurückgesetzt.");

    fireEvent.click(screen.getByText("real-switch-to-en"));

    // Same stored key, still on screen, re-rendered in English: proves the
    // banner re-translates at render time rather than freezing whatever
    // string was produced when handleReset ran.
    await screen.findByText("Reset to default values.");
    expect(screen.queryByText("Auf Standardwerte zurückgesetzt.")).toBeNull();
  });
});

describe("AgentConfigPage feedback banner renders the `{ message }` arm verbatim (review round 3, F3)", () => {
  it("shows the raw server error message unchanged before and after a real language switch", async () => {
    const fetchAgentConfigMock = vi.fn(async () => AGENT_CONFIG_FIXTURE);
    const updateAgentConfigMock = vi.fn(async () => {
      throw new Error("Server exploded");
    });
    mockCommonModules(fetchAgentConfigMock, updateAgentConfigMock);

    await renderAgentConfigPage();
    await screen.findByRole("heading", { name: /Test Agent/ });

    // handleSave's catch branch stores `{ message: error.message }` for a
    // real Error: a raw, already-resolved server message, not a
    // translation key, so it has nothing to re-translate.
    fireEvent.click(screen.getByText("Speichern"));
    await screen.findByText("Server exploded");

    fireEvent.click(screen.getByText("real-switch-to-en"));
    await act(async () => {
      await Promise.resolve();
    });

    // Still the exact same raw message: a language switch must not alter
    // or blank out the message-arm banner.
    expect(screen.getByText("Server exploded")).toBeTruthy();
  });
});
