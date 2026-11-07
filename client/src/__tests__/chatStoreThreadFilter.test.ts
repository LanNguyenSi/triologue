// @vitest-environment jsdom
/**
 * The room list shows top-level messages only. GET /api/messages/:roomId
 * returns thread replies as well, and a live reply arrives as a message with a
 * threadId; none of them may end up in chatStore.messages.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiClient = vi.hoisted(() => vi.fn());
vi.mock("../lib/apiClient", () => ({ apiClient }));

import { useChatStore, MAX_PAGES_PER_CALL } from "../stores/chatStore";
import { jsonResponse } from "./helpers/threadFixtures";

const msg = (id: string, threadId?: string | null) => ({
  id,
  content: id,
  senderId: "u1",
  roomId: "r1",
  threadId,
  createdAt: "2026-11-07T10:00:00.000Z",
  sender: { id: "u1", username: "demo", displayName: "Demo", userType: "HUMAN" },
  reactions: [],
});

beforeEach(() => {
  apiClient.mockReset();
  useChatStore.setState({
    messages: [],
    oldestFetchedId: null,
    hasMoreMessages: false,
    isLoadingMore: false,
    currentRoomId: "r1",
  });
});

const shownIds = () => useChatStore.getState().messages.map((m) => m.id);

describe("thread replies stay out of the room list", () => {
  it("loadMessages drops replies from the loaded page", async () => {
    apiClient.mockResolvedValueOnce(
      jsonResponse({ messages: [msg("a"), msg("r1", "t1"), msg("b", null), msg("r2", "t1")], hasMore: false }),
    );
    await useChatStore.getState().loadMessages("r1");
    expect(shownIds()).toEqual(["a", "b"]);
  });

  it("addMessage drops a live reply and keeps a top-level message", () => {
    useChatStore.getState().addMessage(msg("live-reply", "t1") as never);
    useChatStore.getState().addMessage(msg("live-top") as never);
    expect(shownIds()).toEqual(["live-top"]);
  });

  it("loadMoreMessages drops replies from the older page", async () => {
    useChatStore.setState({
      messages: [msg("m5") as never],
      oldestFetchedId: "m5",
      hasMoreMessages: true,
    });
    apiClient.mockResolvedValueOnce(
      jsonResponse({ messages: [msg("m3"), msg("r4", "t1"), msg("m4")], hasMore: false }),
    );
    await useChatStore.getState().loadMoreMessages("r1");
    expect(shownIds()).toEqual(["m3", "m4", "m5"]);
  });

  it("pages from the oldest fetched message even when a page held only replies", async () => {
    apiClient.mockResolvedValueOnce(
      jsonResponse({ messages: [msg("m5"), msg("m6")], hasMore: true }),
    );
    await useChatStore.getState().loadMessages("r1");

    // One call keeps going through a page of replies: the second request asks
    // from the oldest reply of the first, not from m5.
    apiClient
      .mockResolvedValueOnce(
        jsonResponse({ messages: [msg("r1", "t1"), msg("r2", "t1")], hasMore: true }),
      )
      .mockResolvedValueOnce(jsonResponse({ messages: [msg("m1")], hasMore: false }));
    await useChatStore.getState().loadMoreMessages("r1");
    expect(apiClient.mock.calls[1][0]).toBe("/api/messages/r1?limit=50&before=m5");
    expect(apiClient.mock.calls[2][0]).toBe("/api/messages/r1?limit=50&before=r1");
    expect(shownIds()).toEqual(["m1", "m5", "m6"]);
    expect(useChatStore.getState().hasMoreMessages).toBe(false);
  });
});

describe("a newest page made only of thread replies", () => {
  const repliesPage = (n: number, hasMore = true) =>
    jsonResponse({
      messages: [msg(`r${n}a`, "t1"), msg(`r${n}b`, "t1")],
      hasMore,
    });

  it("the first load fetches on until a top-level message arrives", async () => {
    apiClient
      .mockResolvedValueOnce(repliesPage(1))
      .mockResolvedValueOnce(repliesPage(2))
      .mockResolvedValueOnce(jsonResponse({ messages: [msg("m1")], hasMore: true }));
    await useChatStore.getState().loadMessages("r1");
    expect(apiClient).toHaveBeenCalledTimes(3);
    expect(apiClient.mock.calls[1][0]).toBe("/api/messages/r1?limit=50&before=r1a");
    expect(apiClient.mock.calls[2][0]).toBe("/api/messages/r1?limit=50&before=r2a");
    expect(shownIds()).toEqual(["m1"]);
    expect(useChatStore.getState().hasMoreMessages).toBe(true);
    expect(useChatStore.getState().isLoading).toBe(false);
  });

  it("stops at the page bound and leaves hasMore true for the next call", async () => {
    for (let i = 1; i <= MAX_PAGES_PER_CALL * 2; i += 1) apiClient.mockResolvedValueOnce(repliesPage(i));
    await useChatStore.getState().loadMessages("r1");
    expect(apiClient).toHaveBeenCalledTimes(MAX_PAGES_PER_CALL);
    expect(shownIds()).toEqual([]);
    expect(useChatStore.getState().hasMoreMessages).toBe(true);
    expect(useChatStore.getState().messagesError).toBe(false);

    // The next call continues from the oldest reply fetched so far.
    await useChatStore.getState().loadMoreMessages("r1");
    expect(apiClient).toHaveBeenCalledTimes(MAX_PAGES_PER_CALL * 2);
    expect(apiClient.mock.calls[MAX_PAGES_PER_CALL][0]).toBe(
      `/api/messages/r1?limit=50&before=r${MAX_PAGES_PER_CALL}a`,
    );
  });

  it("stops when the server has no more, with nothing to show", async () => {
    apiClient.mockResolvedValueOnce(repliesPage(1)).mockResolvedValueOnce(repliesPage(2, false));
    await useChatStore.getState().loadMessages("r1");
    expect(apiClient).toHaveBeenCalledTimes(2);
    expect(shownIds()).toEqual([]);
    expect(useChatStore.getState().hasMoreMessages).toBe(false);
  });

  it("a later page that fails ends the call with hasMore true, not with an error", async () => {
    apiClient
      .mockResolvedValueOnce(repliesPage(1))
      .mockResolvedValueOnce(jsonResponse({ error: "x" }, 500));
    await useChatStore.getState().loadMessages("r1");
    expect(useChatStore.getState().messagesError).toBe(false);
    expect(useChatStore.getState().hasMoreMessages).toBe(true);
  });

  it("drops the answer of a room that is no longer the open one", async () => {
    let release: (r: Response) => void = () => undefined;
    apiClient.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const pending = useChatStore.getState().loadMessages("r1");
    useChatStore.setState({ currentRoomId: "r2", messages: [] });
    release(jsonResponse({ messages: [msg("stale")], hasMore: false }));
    await pending;
    expect(shownIds()).toEqual([]);
  });
});
