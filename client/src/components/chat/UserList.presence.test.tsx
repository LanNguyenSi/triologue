// @vitest-environment jsdom
/**
 * UserList shows an agent's live session status: the room load's
 * `presenceStatus`/`presenceMeta` (from GET /api/rooms/:id) and, when newer,
 * the `agent:presence` socket event kept in the socket store. The dot's
 * title is translated through t() and carries host, project and detail.
 *
 * Mutation guards:
 *   - preferring the loaded status over a newer live event makes "a newer
 *     live event wins" fail
 *   - mapping waiting_approval to online makes "waiting" fail
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { buildLanguageSwitchHarness } from "../../test/languageSwitchHarness";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  localStorage.clear();
});

type Live = Record<string, unknown>;

async function mountUserList(participants: unknown[], agentPresence: Live) {
  const apiClientMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ participants }),
  }));
  vi.doMock("../../contexts/ThemeContext", () => ({
    useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
  }));
  vi.doMock("../../stores/authStore", () => ({
    useAuthStore: () => ({ user: { id: "u1", username: "alice", isAdmin: false } }),
  }));
  vi.doMock("../../lib/apiClient", () => ({ apiClient: apiClientMock }));
  vi.doMock("../../stores/notificationStore", () => ({
    useNotificationStore: (selector: (state: { add: () => void }) => unknown) =>
      selector({ add: vi.fn() }),
  }));
  vi.doMock("../../stores/socketStore", () => ({
    useSocketStore: (selector: (state: { agentPresence: Live }) => unknown) =>
      selector({ agentPresence }),
  }));
  vi.doMock("./InvitePopup", () => ({ InvitePopup: () => null }));

  const [{ UserList }, languageContextModule] = await Promise.all([
    import("./UserList"),
    import("../../contexts/LanguageContext"),
  ]);
  const Harness = buildLanguageSwitchHarness(languageContextModule, <UserList roomId="r1" />);
  render(<Harness />);
  await waitFor(() => expect(screen.getByText("Claude")).toBeTruthy());
}

const human = { userId: "u1", username: "alice", displayName: "Alice", userType: "HUMAN", role: "OWNER", isOnline: true, presenceStatus: "online" };
const agentLoaded = {
  userId: "a1", username: "agent_claude_1234abcd", displayName: "Claude", userType: "AI_AGENT", role: "MEMBER", isOnline: false,
  presenceStatus: "working",
  presenceMeta: { host: "mac-studio-01", project: "evidence-api", sessionId: "s1", detail: null, sessions: 1, updatedAt: "2026-11-05T07:00:00.000Z" },
};

describe("UserList agent presence", () => {
  it("shows the loaded session status with host and project in the translated title", async () => {
    await mountUserList([human, agentLoaded], {});

    const dot = screen.getByTitle("Arbeitet · mac-studio-01 · evidence-api");
    expect(dot.getAttribute("data-presence")).toBe("working");
    expect(screen.getByTitle("Online").getAttribute("data-presence")).toBe("online");
  });

  it("a newer live event wins over the loaded status", async () => {
    await mountUserList([agentLoaded], {
      a1: { userId: "a1", status: "waiting_approval", sessionId: "s1", host: "mac-studio-01", project: "evidence-api", detail: "Bash: npm test", sessions: 1, updatedAt: "2026-11-05T07:05:00.000Z" },
    });

    const dot = screen.getByTitle("Wartet auf Freigabe · mac-studio-01 · evidence-api · Bash: npm test");
    expect(dot.getAttribute("data-presence")).toBe("waiting");
  });

  it("an older live event does not override the loaded status", async () => {
    await mountUserList([agentLoaded], {
      a1: { userId: "a1", status: "online", sessionId: "s1", host: "mac-studio-01", project: "evidence-api", detail: null, sessions: 1, updatedAt: "2026-11-05T06:00:00.000Z" },
    });

    expect(screen.getByTitle("Arbeitet · mac-studio-01 · evidence-api").getAttribute("data-presence")).toBe("working");
  });

  it("a live offline event clears the status and its details", async () => {
    await mountUserList([agentLoaded], {
      a1: { userId: "a1", status: "offline", sessionId: null, host: null, project: null, detail: null, sessions: 0, updatedAt: "2026-11-05T07:10:00.000Z" },
    });

    expect(screen.getByTitle("Offline").getAttribute("data-presence")).toBe("offline");
  });

  it("falls back to the socket flag for a participant without any status", async () => {
    await mountUserList([{ ...agentLoaded, presenceStatus: undefined, presenceMeta: undefined, isOnline: false }], {});

    expect(screen.getByTitle("Offline").getAttribute("data-presence")).toBe("offline");
  });
});
