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
 *   - dropping the expiry timer, its clamp, its unparsable-value guard or its
 *     cleanup makes the fake-timer cases below fail
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import { buildLanguageSwitchHarness } from "../../test/languageSwitchHarness";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetModules();
  vi.restoreAllMocks();
  localStorage.clear();
});

type Live = Record<string, unknown>;

/**
 * The live map and the participants the mocked room load returns are held in
 * module-scope variables so a test can hand the component a newer event and
 * then re-render it (the participant-list refresh re-reads both).
 */
let livePresence: Live = {};
let loadedParticipants: unknown[] = [];

async function mountUserList(participants: unknown[], agentPresence: Live, faked = false) {
  loadedParticipants = participants;
  livePresence = agentPresence;
  const apiClientMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ participants: [...loadedParticipants] }),
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
      selector({ agentPresence: livePresence }),
  }));
  vi.doMock("./InvitePopup", () => ({ InvitePopup: () => null }));

  const [{ UserList }, languageContextModule] = await Promise.all([
    import("./UserList"),
    import("../../contexts/LanguageContext"),
  ]);
  const Harness = buildLanguageSwitchHarness(languageContextModule, <UserList roomId="r1" />);
  render(<Harness />);
  if (faked) {
    // waitFor polls with timers, which are faked here; the mocked load needs
    // only its two awaits, so flush them inside act instead.
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(screen.getByText("Claude")).toBeTruthy();
  } else {
    await waitFor(() => expect(screen.getByText("Claude")).toBeTruthy());
  }
}

const human = { userId: "u1", username: "alice", displayName: "Alice", userType: "HUMAN", role: "OWNER", isOnline: true, presenceStatus: "online" };
const agentLoaded = {
  userId: "a1", username: "agent_claude_1234abcd", displayName: "Claude", userType: "AI_AGENT", role: "MEMBER", isOnline: false,
  presenceStatus: "working",
  presenceMeta: { host: "mac-studio-01", project: "evidence-api", sessionId: "s1", detail: null, sessions: 1, updatedAt: "2026-11-05T07:00:00.000Z", expiresAt: "2026-11-05T07:02:00.000Z" },
};
const FUTURE = "2999-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";

describe("UserList agent presence", () => {
  it("shows the loaded session status with host and project in the translated title", async () => {
    await mountUserList([human, agentLoaded], {});

    const dot = screen.getByTitle("Arbeitet · mac-studio-01 · evidence-api");
    expect(dot.getAttribute("data-presence")).toBe("working");
    expect(screen.getByTitle("Online").getAttribute("data-presence")).toBe("online");
  });

  it("a newer live event wins over the loaded status", async () => {
    await mountUserList([agentLoaded], {
      a1: { userId: "a1", status: "waiting_approval", sessionId: "s1", host: "mac-studio-01", project: "evidence-api", detail: "Bash: npm test", sessions: 1, updatedAt: "2026-11-05T07:05:00.000Z", expiresAt: PAST },
    });

    const dot = screen.getByTitle("Wartet auf Freigabe · mac-studio-01 · evidence-api · Bash: npm test");
    expect(dot.getAttribute("data-presence")).toBe("waiting");
  });

  it("an older live event does not override the loaded status", async () => {
    await mountUserList([agentLoaded], {
      a1: { userId: "a1", status: "online", sessionId: "s1", host: "mac-studio-01", project: "evidence-api", detail: null, sessions: 1, updatedAt: "2026-11-05T06:00:00.000Z", expiresAt: FUTURE },
    });

    expect(screen.getByTitle("Arbeitet · mac-studio-01 · evidence-api").getAttribute("data-presence")).toBe("working");
  });

  it("a live offline event clears the status and its details", async () => {
    await mountUserList([agentLoaded], {
      a1: { userId: "a1", status: "offline", sessionId: null, host: null, project: null, detail: null, sessions: 0, updatedAt: "2026-11-05T07:10:00.000Z", expiresAt: "2026-11-05T07:10:00.000Z" },
    });

    expect(screen.getByTitle("Offline").getAttribute("data-presence")).toBe("offline");
  });

  it("without loaded details a live event counts only while it is within its TTL", async () => {
    const bare = { ...agentLoaded, presenceStatus: "offline", presenceMeta: undefined };
    const live = (expiresAt: string) => ({
      a1: { userId: "a1", status: "working", sessionId: "s1", host: "mac-studio-01", project: "evidence-api", detail: null, sessions: 1, updatedAt: "2026-11-05T07:05:00.000Z", expiresAt },
    });

    await mountUserList([bare], live(FUTURE));
    expect(screen.getByTitle("Arbeitet · mac-studio-01 · evidence-api").getAttribute("data-presence")).toBe("working");
    cleanup();
    vi.resetModules();

    // MUTATION GUARD: letting any live event win without loaded details
    // keeps "Arbeitet" on screen after the server dropped the status; fails.
    await mountUserList([bare], live(PAST));
    expect(screen.getByTitle("Offline").getAttribute("data-presence")).toBe("offline");
  });

  it("falls back to the socket flag for a participant without any status", async () => {
    await mountUserList([{ ...agentLoaded, presenceStatus: undefined, presenceMeta: undefined, isOnline: false }], {});

    expect(screen.getByTitle("Offline").getAttribute("data-presence")).toBe("offline");
  });
});

/**
 * A live status without loaded details is shown only while it is within its
 * TTL, and nothing else re-renders the list, so UserList arms one timer at the
 * earliest expiry it has to show: the status of a writer that died then falls
 * back on its own. Fake timers drive the whole clock here, so no event arrives.
 *
 * The harness and React arm 0 ms timers of their own, so the assertions look at
 * the delays UserList asked for rather than at a raw timer count.
 */
const T0 = Date.UTC(2026, 10, 5, 7, 0, 0); // 2026-11-05T07:00:00.000Z
const at = (msFromT0: number) => new Date(T0 + msFromT0).toISOString();
const bareAgent = { userId: "a1", username: "agent_claude_1234abcd", displayName: "Claude", userType: "AI_AGENT", role: "MEMBER", isOnline: false, presenceStatus: "offline" };
/** A working event that expires `expiresInMs` after the (faked) mount instant. */
const working = (expiresInMs: number, updatedAtMs = -1000) => ({
  a1: { userId: "a1", status: "working", sessionId: "s1", host: "mac-studio-01", project: "evidence-api", detail: null, sessions: 1, updatedAt: at(updatedAtMs), expiresAt: at(expiresInMs) },
});
const shownPresence = () =>
  (document.querySelector("[data-presence]") as HTMLElement).getAttribute("data-presence");
/** The delays UserList armed: a past expiry would be negative, an unparsable one NaN. */
const armedDelays = (calls: unknown[][]) =>
  calls.map((call) => call[1]).filter((delay): delay is number => typeof delay === "number" && delay !== 0);
const flushLoads = async () => {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

describe("UserList live presence expiry", () => {
  it("drops the live status when its expiry passes and no event arrives", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const scheduled = vi.spyOn(globalThis, "setTimeout");
    await mountUserList([bareAgent], working(60_000), true);

    expect(shownPresence()).toBe("working");
    expect(armedDelays(scheduled.mock.calls)).toEqual([60_000]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(shownPresence()).toBe("working");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(shownPresence()).toBe("offline");
    // Nothing is left to wait for, so no further timer is armed: the fallback
    // must not turn into a re-arming loop.
    expect(armedDelays(scheduled.mock.calls)).toEqual([60_000]);
  });

  it("keeps the status past the first expiry when a newer event arrives before it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const scheduled = vi.spyOn(globalThis, "setTimeout");
    await mountUserList([bareAgent], working(60_000), true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(shownPresence()).toBe("working");

    // A newer event with a later expiry arrives in the store; the refresh that
    // re-renders the list must replace its timer, not leave both running.
    livePresence = working(165_000, 45_000);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Aktualisieren" }));
    });
    await flushLoads();
    expect(armedDelays(scheduled.mock.calls)).toEqual([60_000, 120_000]);

    // 30 s more is past the first event's expiry but inside the new one's.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(shownPresence()).toBe("working");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(95_000);
    });
    expect(shownPresence()).toBe("offline");
  });

  it("clears its timer on unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const scheduled = vi.spyOn(globalThis, "setTimeout");
    const cancelled = vi.spyOn(globalThis, "clearTimeout");
    await mountUserList([bareAgent], working(60_000), true);

    const armed = scheduled.mock.calls.findIndex(
      (call) => typeof call[1] === "number" && call[1] > 0,
    );
    expect(armed).toBeGreaterThanOrEqual(0);
    const timerId = scheduled.mock.results[armed].value;

    cleanup();

    expect(cancelled.mock.calls.map((call) => call[0])).toContain(timerId);
  });

  it("arms no timer for an expiry that is already past", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const scheduled = vi.spyOn(globalThis, "setTimeout");
    await mountUserList([bareAgent], working(-1), true);

    expect(shownPresence()).toBe("offline");
    expect(armedDelays(scheduled.mock.calls)).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(shownPresence()).toBe("offline");
    expect(armedDelays(scheduled.mock.calls)).toEqual([]);
  });

  it("arms no timer for an unparsable expiresAt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const scheduled = vi.spyOn(globalThis, "setTimeout");
    await mountUserList([bareAgent], { a1: { ...working(60_000).a1, expiresAt: "not a date" } }, true);

    // resolvePresence treats an unparsable expiry as expired, so the fallback is
    // what shows and a timer would only spin: no delay armed, NaN or otherwise.
    expect(shownPresence()).toBe("offline");
    expect(armedDelays(scheduled.mock.calls)).toEqual([]);
  });

  it("clamps a far-future expiry to one timer at the setTimeout ceiling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const scheduled = vi.spyOn(globalThis, "setTimeout");
    await mountUserList([bareAgent], working(2 ** 31 + 60_000), true);

    // Above 2^31-1 ms a browser fires the timer at once, which would re-arm it
    // in a loop; the ceiling keeps it pending and the status on screen.
    expect(armedDelays(scheduled.mock.calls)).toEqual([2 ** 31 - 1]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000);
    });
    expect(shownPresence()).toBe("working");

    // The clamped timer fires 2^31-1 ms after mount, well before the real
    // expiry, so the list must re-evaluate and re-arm for the rest; without
    // that second arming the status would sit on screen past its TTL forever.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 ** 31 - 1 - 3_600_000);
    });
    expect(shownPresence()).toBe("working");
    expect(armedDelays(scheduled.mock.calls)).toEqual([2 ** 31 - 1, 60_001]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_002);
    });
    expect(shownPresence()).toBe("offline");
  });
});
