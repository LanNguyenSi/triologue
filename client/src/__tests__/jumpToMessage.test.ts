// @vitest-environment jsdom
/**
 * "Jump to message" for a target that is a thread reply: it opens the thread
 * instead of paging the room list for a message that is never in it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiClient = vi.hoisted(() => vi.fn());
vi.mock("../lib/apiClient", () => ({ apiClient }));

import { jumpToMessageTarget, MAX_JUMP_PAGES } from "../components/layout/jumpToMessage";
import { useChatStore } from "../stores/chatStore";
import { useThreadStore } from "../stores/threadStore";
import { jsonResponse, makeMessage, makeThread, ROOM_ID } from "./helpers/threadFixtures";

let loadMore: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiClient.mockReset();
  apiClient.mockResolvedValue(jsonResponse([]));
  loadMore = vi.fn(async () => undefined);
  useChatStore.setState({
    messages: [makeMessage({ id: "m1" }) as never],
    hasMoreMessages: true,
    loadMoreMessages: loadMore,
  });
  useThreadStore.setState({ roomId: null });
  useThreadStore.getState().setRoom(ROOM_ID);
  useThreadStore.setState({ threads: [makeThread({ id: "t1" })] });
});

describe("jumpToMessageTarget", () => {
  it("opens the thread of a target that carries a threadId, without paging", async () => {
    const result = await jumpToMessageTarget(ROOM_ID, "reply-1", "t1");
    expect(result).toEqual({ kind: "thread", threadId: "t1" });
    expect(loadMore).not.toHaveBeenCalled();
    expect(useThreadStore.getState().view).toBe("thread");
    expect(useThreadStore.getState().activeThreadId).toBe("t1");
  });

  it("opens the thread of a target the open thread already holds", async () => {
    useThreadStore.setState({
      activeThreadId: "t1",
      view: "thread",
      replies: [makeMessage({ id: "known", threadId: "t1" })],
    });
    const result = await jumpToMessageTarget(ROOM_ID, "known");
    expect(result).toEqual({ kind: "thread", threadId: "t1" });
    expect(loadMore).not.toHaveBeenCalled();
  });

  it("finds a top-level message that is already loaded without paging", async () => {
    expect(await jumpToMessageTarget(ROOM_ID, "m1")).toEqual({ kind: "message" });
    expect(loadMore).not.toHaveBeenCalled();
  });

  it("pages for an unknown target until it shows up", async () => {
    loadMore.mockImplementationOnce(async () => {
      useChatStore.setState({ messages: [makeMessage({ id: "older" }) as never, makeMessage({ id: "m1" }) as never] });
    });
    expect(await jumpToMessageTarget(ROOM_ID, "older")).toEqual({ kind: "message" });
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("gives up after the page budget for a target that is nowhere (a search hit that is a reply)", async () => {
    expect(await jumpToMessageTarget(ROOM_ID, "unknown-reply")).toEqual({ kind: "missing" });
    expect(loadMore).toHaveBeenCalledTimes(MAX_JUMP_PAGES);
  });

  it("stops paging when there is nothing more", async () => {
    useChatStore.setState({ hasMoreMessages: false });
    expect(await jumpToMessageTarget(ROOM_ID, "unknown")).toEqual({ kind: "missing" });
    expect(loadMore).not.toHaveBeenCalled();
  });
});
