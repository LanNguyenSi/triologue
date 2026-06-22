// @vitest-environment jsdom
// (imports the useRoomList module, which transitively loads chatStore -> authStore,
//  and authStore reads localStorage at module load)
/**
 * Unit tests for the pure room-list helpers extracted from AppShell into
 * useRoomList.ts. These carry the real behavioral risk of the AppShell
 * decomposition (sort order, search filtering, preview + activity-time
 * formatting), so they are guarded directly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatRoomActivityTime,
  getRoomPreview,
  sortRooms,
  selectVisibleRooms,
  type RoomLike,
} from "../hooks/useRoomList";

const room = (over: Partial<RoomLike> & { id: string; name: string }): RoomLike => ({ ...over });

describe("getRoomPreview", () => {
  it("formats 'sender: content' and collapses whitespace", () => {
    expect(
      getRoomPreview(room({ id: "1", name: "A", lastMessage: { content: "hello   world", sender: { displayName: "Ann" } } })),
    ).toBe("Ann: hello world");
  });

  it("uses username when displayName is missing", () => {
    expect(
      getRoomPreview(room({ id: "1", name: "A", lastMessage: { content: "hi", sender: { username: "bob" } } })),
    ).toBe("bob: hi");
  });

  it("omits the prefix when there is no sender", () => {
    expect(getRoomPreview(room({ id: "1", name: "A", lastMessage: { content: "hi" } }))).toBe("hi");
  });

  it("falls back to the description when there is no last message", () => {
    expect(getRoomPreview(room({ id: "1", name: "A", description: "desc" }))).toBe("desc");
  });

  it("returns '' when nothing is available", () => {
    expect(getRoomPreview(room({ id: "1", name: "A" }))).toBe("");
  });
});

describe("formatRoomActivityTime", () => {
  it("returns '' for missing or invalid timestamps", () => {
    expect(formatRoomActivityTime(undefined)).toBe("");
    expect(formatRoomActivityTime("not-a-date")).toBe("");
  });

  it("returns a non-empty string for a valid timestamp (same-day branch)", () => {
    expect(formatRoomActivityTime(new Date().toISOString()).length).toBeGreaterThan(0);
  });

  it("distinguishes same-year from older (older carries a year suffix)", () => {
    // Locale-robust: mid-year dates never cross a year boundary under any TZ
    // offset, and the older format adds a 2-digit year so it is strictly longer.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    const sameYear = formatRoomActivityTime("2026-03-10T12:00:00Z");
    const older = formatRoomActivityTime("2024-03-10T12:00:00Z");
    expect(sameYear).not.toBe("");
    expect(older).not.toBe(sameYear);
    expect(older.length).toBeGreaterThan(sameYear.length);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe("sortRooms", () => {
  it("sorts by last-message time desc, then name asc; missing timestamps last", () => {
    const a = room({ id: "a", name: "Beta", lastMessage: { timestamp: "2026-01-01T10:00:00Z" } });
    const b = room({ id: "b", name: "Alpha", lastMessage: { timestamp: "2026-01-01T12:00:00Z" } });
    const c = room({ id: "c", name: "Gamma" });
    const d = room({ id: "d", name: "Delta" });
    expect(sortRooms([a, b, c, d]).map((r) => r.id)).toEqual(["b", "a", "d", "c"]);
  });

  it("does not mutate the input array", () => {
    const input = [room({ id: "1", name: "B" }), room({ id: "2", name: "A" })];
    const snapshot = [...input];
    sortRooms(input);
    expect(input).toEqual(snapshot);
  });
});

describe("selectVisibleRooms", () => {
  const rooms = [
    room({ id: "1", name: "General", lastMessage: { timestamp: "2026-01-02T00:00:00Z", content: "hi" } }),
    room({ id: "2", name: "Random", description: "memes", lastMessage: { timestamp: "2026-01-01T00:00:00Z" } }),
  ];

  it("returns all rooms sorted when the query is empty", () => {
    expect(selectVisibleRooms(rooms, "").map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("filters by name", () => {
    expect(selectVisibleRooms(rooms, "rand").map((r) => r.id)).toEqual(["2"]);
  });

  it("filters by description", () => {
    expect(selectVisibleRooms(rooms, "meme").map((r) => r.id)).toEqual(["2"]);
  });

  it("filters by preview content", () => {
    expect(selectVisibleRooms(rooms, "hi").map((r) => r.id)).toEqual(["1"]);
  });
});
