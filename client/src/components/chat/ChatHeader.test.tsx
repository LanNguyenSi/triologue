// @vitest-environment jsdom
/**
 * ChatHeader's invite network-error path used to call
 * `setInviteStatus({ type: "err", msg: t("chat.invite.networkError") })`:
 * `t(key)` bakes in the language active when the invite request rejected,
 * so a later language switch never retranslates it while the message is
 * still on screen (i18n-freeze guard, Klasse 2; see README's i18n
 * section). The fix (agent-tasks 4b75a2d7, slice 1) stores the KEY instead
 * (`{ type: "err", key: "chat.invite.networkError" }`) and translates it
 * at render time (`"key" in inviteStatus ? t(inviteStatus.key) : ...`),
 * mirroring FilesPage's `runtimeError` state / the shared `RunError`
 * union in `src/lib/runError.ts`.
 *
 * This test drives the invite form to the network-error branch (apiClient
 * rejects), asserts the German fallback text renders, then performs a
 * REAL language switch and asserts the SAME still-visible error re-renders
 * in English (no stale closure), following the harness pattern used by
 * the other a34078b6-family page/component tests
 * (`src/test/languageSwitchHarness.tsx`).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { buildLanguageSwitchHarness } from "../../test/languageSwitchHarness";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  localStorage.clear();
});

function mountChatHeader(apiClientMock: ReturnType<typeof vi.fn>) {
  vi.doMock("../../contexts/ThemeContext", () => ({
    useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
  }));
  vi.doMock("../../stores/authStore", () => ({
    useAuthStore: () => ({ user: { id: "u1", username: "alice", isAdmin: true } }),
  }));
  vi.doMock("../../lib/apiClient", () => ({ apiClient: apiClientMock }));
  vi.doMock("../../stores/notificationStore", () => ({
    useNotificationStore: (selector: (state: { add: () => void }) => unknown) =>
      selector({ add: vi.fn() }),
  }));
  vi.doMock("../../stores/chatStore", () => ({
    useChatStore: (selector: (state: { messages: unknown[] }) => unknown) =>
      selector({ messages: [] }),
  }));
  vi.doMock("../../stores/socketStore", () => ({
    useSocketStore: (selector: (state: { isConnected: boolean }) => unknown) =>
      selector({ isConnected: true }),
  }));
  vi.doMock("../ui/NotificationCenter", () => ({
    NotificationCenter: () => null,
  }));
  vi.doMock("./InvitePopup", () => ({ InvitePopup: () => null }));

  return Promise.all([
    import("./ChatHeader"),
    import("../../contexts/LanguageContext"),
  ]).then(([{ ChatHeader }, languageContextModule]) => {
    const Harness = buildLanguageSwitchHarness(
      languageContextModule,
      <ChatHeader
        room={{ id: "r1", name: "Room One" }}
        onToggleUserList={() => undefined}
        onJumpToMessage={() => undefined}
      />,
    );
    render(<Harness />);
  });
}

describe("ChatHeader invite network error re-renders in the current language (agent-tasks 4b75a2d7)", () => {
  it("shows the German fallback first, then re-renders in English after a real language switch, no stale closure", async () => {
    // /api/messages/:id/pinned and /api/rooms/:id (role check) resolve ok
    // with empty/neutral payloads; the invite POST rejects, driving the
    // catch branch this test targets.
    const apiClientMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/pinned")) {
        return { ok: true, status: 200, json: async () => ({ messages: [], count: 0 }) };
      }
      if (url.endsWith("/api/rooms/r1")) {
        return { ok: true, status: 200, json: async () => ({ participants: [] }) };
      }
      if (url.includes("/invite") && init?.method === "POST") {
        throw new Error("network down");
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    await mountChatHeader(apiClientMock);

    fireEvent.click(screen.getByTitle("Einladen"));
    const input = await screen.findByPlaceholderText("Benutzername…");
    fireEvent.change(input, { target: { value: "bob" } });
    const form = input.closest("form");
    if (!form) throw new Error("invite form not found");
    fireEvent.submit(form);

    await screen.findByText("Netzwerkfehler");

    fireEvent.click(screen.getByText("real-switch-to-en"));

    await waitFor(() => expect(screen.getByText("Network error")).toBeTruthy());
    expect(screen.queryByText("Netzwerkfehler")).toBeNull();
  });
});
