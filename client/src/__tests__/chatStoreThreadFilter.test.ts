// @vitest-environment jsdom
/**
 * The room list shows top-level messages only. GET /api/messages/:roomId
 * returns thread replies as well, and a live reply arrives as a message with a
 * threadId; none of them may end up in chatStore.messages.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiClient = vi.hoisted(() => vi.fn());
vi.mock("../lib/apiClient", () => ({ apiClient }));

import { useChatStore } from "../stores/chatStore";
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

    // The next page is all replies: nothing new is shown ...
    apiClient.mockResolvedValueOnce(
      jsonResponse({ messages: [msg("r1", "t1"), msg("r2", "t1")], hasMore: true }),
    );
    await useChatStore.getState().loadMoreMessages("r1");
    expect(shownIds()).toEqual(["m5", "m6"]);

    // ... and the following request asks from the oldest reply, not from m5.
    apiClient.mockResolvedValueOnce(jsonResponse({ messages: [msg("m1")], hasMore: false }));
    await useChatStore.getState().loadMoreMessages("r1");
    expect(apiClient.mock.calls[2][0]).toBe("/api/messages/r1?limit=50&before=r1");
    expect(shownIds()).toEqual(["m1", "m5", "m6"]);
  });
});
