// @vitest-environment jsdom
/**
 * threadStore: list ordering, create/open from a message, replies, the
 * resolve toggle and its refusal. The network is the mocked apiClient.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiClient = vi.hoisted(() => vi.fn());
vi.mock("../lib/apiClient", () => ({ apiClient }));

import { useThreadStore, sortThreads } from "../stores/threadStore";
import { jsonResponse, makeMessage, makeThread, ROOM_ID } from "./helpers/threadFixtures";

const reset = () => {
  useThreadStore.setState({ roomId: null });
  useThreadStore.getState().setRoom(ROOM_ID);
};

beforeEach(() => {
  apiClient.mockReset();
  reset();
});

const ids = () => useThreadStore.getState().threads.map((t) => t.id);

describe("list ordering", () => {
  it("sorts by lastActivity descending and breaks ties by id descending", () => {
    const sorted = sortThreads([
      makeThread({ id: "a", lastActivity: "2026-11-07T10:00:00.000Z" }),
      makeThread({ id: "c", lastActivity: "2026-11-07T12:00:00.000Z" }),
      makeThread({ id: "b", lastActivity: "2026-11-07T12:00:00.000Z" }),
      makeThread({ id: "d", lastActivity: "2026-11-07T11:00:00.000Z" }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("loadThreads stores the page in that order whatever order the server sent", async () => {
    apiClient.mockResolvedValueOnce(
      jsonResponse([
        makeThread({ id: "old", lastActivity: "2026-11-07T08:00:00.000Z" }),
        makeThread({ id: "new", lastActivity: "2026-11-07T12:00:00.000Z" }),
      ]),
    );
    await useThreadStore.getState().loadThreads(ROOM_ID);
    expect(ids()).toEqual(["new", "old"]);
    expect(apiClient).toHaveBeenCalledWith(`/api/rooms/${ROOM_ID}/threads?limit=50`);
  });

  it("a reply moves its thread to the top and bumps count and activity", () => {
    useThreadStore.setState({
      threads: [
        makeThread({ id: "t-new", lastActivity: "2026-11-07T12:00:00.000Z", messageCount: 3 }),
        makeThread({ id: "t-old", lastActivity: "2026-11-07T08:00:00.000Z", messageCount: 1 }),
      ],
    });
    useThreadStore
      .getState()
      .applyReply(makeMessage({ id: "m9", threadId: "t-old", createdAt: "2026-11-07T13:00:00.000Z" }));
    const [first, second] = useThreadStore.getState().threads;
    expect(first.id).toBe("t-old");
    expect(first.messageCount).toBe(2);
    expect(first.lastActivity).toBe("2026-11-07T13:00:00.000Z");
    expect(second.id).toBe("t-new");
  });
});

describe("live replies", () => {
  beforeEach(() => {
    useThreadStore.setState({
      threads: [makeThread({ id: "t1", messageCount: 1 })],
      activeThreadId: "t1",
      view: "thread",
      replies: [makeMessage({ id: "r0", threadId: "t1" })],
    });
  });

  it("appends a reply of the open thread once, also when the event arrives twice", () => {
    const reply = makeMessage({ id: "r1", threadId: "t1", createdAt: "2026-11-07T10:05:00.000Z" });
    useThreadStore.getState().applyReply(reply);
    useThreadStore.getState().applyReply(reply);
    const state = useThreadStore.getState();
    expect(state.replies.map((r) => r.id)).toEqual(["r0", "r1"]);
    expect(state.threads[0].messageCount).toBe(2);
  });

  it("counts a reply of another thread without touching the open replies", () => {
    useThreadStore.setState({
      threads: [makeThread({ id: "t1" }), makeThread({ id: "t2", messageCount: 4 })],
    });
    useThreadStore.getState().applyReply(makeMessage({ id: "x", threadId: "t2" }));
    const state = useThreadStore.getState();
    expect(state.replies.map((r) => r.id)).toEqual(["r0"]);
    expect(state.threads.find((t) => t.id === "t2")?.messageCount).toBe(5);
  });

  it("ignores a reply of another room and a message without a threadId", () => {
    useThreadStore.getState().applyReply(makeMessage({ id: "o", threadId: "t1", roomId: "other" }));
    useThreadStore.getState().applyReply(makeMessage({ id: "p" }));
    const state = useThreadStore.getState();
    expect(state.replies.map((r) => r.id)).toEqual(["r0"]);
    expect(state.threads[0].messageCount).toBe(1);
  });

  it("keeps a reply that arrived while the replies were loading", async () => {
    useThreadStore.setState({ replies: [], activeThreadId: "t1" });
    apiClient.mockImplementationOnce(async () => {
      useThreadStore
        .getState()
        .applyReply(makeMessage({ id: "live", threadId: "t1", createdAt: "2026-11-07T10:09:00.000Z" }));
      return jsonResponse([makeMessage({ id: "old", threadId: "t1" })]);
    });
    await useThreadStore.getState().loadReplies("t1");
    expect(useThreadStore.getState().replies.map((r) => r.id)).toEqual(["old", "live"]);
  });
});

describe("start a thread from a message", () => {
  const root = makeMessage({ id: "m1", content: "Release branch is green" });

  it("posts title and rootMessageId, adds the thread and opens it", async () => {
    useThreadStore.getState().replyInThread(root);
    expect(useThreadStore.getState().view).toBe("draft");

    const created = makeThread({ id: "t9", title: "Release", rootMessageId: "m1" });
    apiClient
      .mockResolvedValueOnce(jsonResponse(created, 201))
      .mockResolvedValueOnce(jsonResponse([]));
    await useThreadStore.getState().createThread("  Release  ");

    const [path, init] = apiClient.mock.calls[0];
    expect(path).toBe(`/api/rooms/${ROOM_ID}/threads`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ title: "Release", rootMessageId: "m1" });
    const state = useThreadStore.getState();
    expect(state.view).toBe("thread");
    expect(state.activeThreadId).toBe("t9");
    expect(ids()).toEqual(["t9"]);
    expect(apiClient.mock.calls[1][0]).toBe(
      `/api/rooms/${ROOM_ID}/messages?threadId=t9&limit=100`,
    );
  });

  it("opens the existing thread instead of a draft when the message already roots one", () => {
    useThreadStore.setState({ threads: [makeThread({ id: "t5", rootMessageId: "m1" })] });
    apiClient.mockResolvedValue(jsonResponse([]));
    useThreadStore.getState().replyInThread(root);
    const state = useThreadStore.getState();
    expect(state.view).toBe("thread");
    expect(state.activeThreadId).toBe("t5");
  });

  it("opens the thread another session just started on the same message", async () => {
    useThreadStore.getState().replyInThread(root);
    apiClient
      .mockResolvedValueOnce(jsonResponse({ error: "rootMessageId is no longer available" }, 400))
      .mockResolvedValueOnce(jsonResponse([makeThread({ id: "t7", rootMessageId: "m1" })]))
      .mockResolvedValueOnce(jsonResponse([]));
    await useThreadStore.getState().createThread("Release");
    expect(useThreadStore.getState().activeThreadId).toBe("t7");
    expect(useThreadStore.getState().createError).toBeNull();
  });

  it("reports a failed create and stays on the draft", async () => {
    useThreadStore.getState().replyInThread(root);
    apiClient
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500))
      .mockResolvedValueOnce(jsonResponse([]));
    await useThreadStore.getState().createThread("Release");
    const state = useThreadStore.getState();
    expect(state.view).toBe("draft");
    expect(state.createError).toBe("threads.createFailed");
  });

  it("does not post an empty title", async () => {
    useThreadStore.getState().replyInThread(root);
    await useThreadStore.getState().createThread("   ");
    expect(apiClient).not.toHaveBeenCalled();
  });
});

describe("resolve and reopen", () => {
  beforeEach(() => {
    useThreadStore.setState({ threads: [makeThread({ id: "t1", isResolved: false })] });
  });

  it("sends isResolved and stores the thread the server returns", async () => {
    apiClient.mockResolvedValueOnce(jsonResponse(makeThread({ id: "t1", isResolved: true })));
    await useThreadStore.getState().setResolved("t1", true);
    const [path, init] = apiClient.mock.calls[0];
    expect(path).toBe(`/api/rooms/${ROOM_ID}/threads/t1`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ isResolved: true });
    expect(useThreadStore.getState().threads[0].isResolved).toBe(true);
  });

  it("keeps the state and names the reason when the server refuses (403)", async () => {
    apiClient.mockResolvedValueOnce(jsonResponse({ error: "Only the creator" }, 403));
    await useThreadStore.getState().setResolved("t1", true);
    const state = useThreadStore.getState();
    expect(state.threads[0].isResolved).toBe(false);
    expect(state.resolveError).toBe("threads.resolveForbidden");
    expect(state.resolving).toBe(false);
  });

  it("keeps the state on any other failure, with the generic reason", async () => {
    apiClient.mockResolvedValueOnce(jsonResponse({ error: "x" }, 500));
    await useThreadStore.getState().setResolved("t1", true);
    expect(useThreadStore.getState().threads[0].isResolved).toBe(false);
    expect(useThreadStore.getState().resolveError).toBe("threads.resolveFailed");
  });

  it("keeps the state when the request fails outright", async () => {
    apiClient.mockRejectedValueOnce(new Error("offline"));
    await useThreadStore.getState().setResolved("t1", true);
    expect(useThreadStore.getState().threads[0].isResolved).toBe(false);
    expect(useThreadStore.getState().resolveError).toBe("threads.resolveFailed");
  });

  it("reopens a resolved thread", async () => {
    useThreadStore.setState({ threads: [makeThread({ id: "t1", isResolved: true })] });
    apiClient.mockResolvedValueOnce(jsonResponse(makeThread({ id: "t1", isResolved: false })));
    await useThreadStore.getState().setResolved("t1", false);
    expect(JSON.parse(apiClient.mock.calls[0][1].body)).toEqual({ isResolved: false });
    expect(useThreadStore.getState().threads[0].isResolved).toBe(false);
  });
});

describe("room switch", () => {
  it("drops the list and the open thread and ignores a late answer for the old room", async () => {
    let release: (r: Response) => void = () => undefined;
    apiClient.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    const pending = useThreadStore.getState().loadThreads(ROOM_ID);
    useThreadStore.getState().setRoom("r2");
    release(jsonResponse([makeThread({ id: "stale" })]));
    await pending;
    expect(useThreadStore.getState().roomId).toBe("r2");
    expect(ids()).toEqual([]);
  });

  it("adds a thread:created thread of the open room only", () => {
    useThreadStore.getState().applyThreadCreated(makeThread({ id: "here" }));
    useThreadStore.getState().applyThreadCreated(makeThread({ id: "there", roomId: "r2" }));
    expect(ids()).toEqual(["here"]);
  });
});

describe("older replies", () => {
  const page = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => {
      const n = from + i;
      return makeMessage({
        id: `r${String(n).padStart(3, "0")}`,
        threadId: "t1",
        createdAt: new Date(Date.UTC(2026, 10, 7, 10, 0, n)).toISOString(),
      });
    });

  beforeEach(() => {
    useThreadStore.setState({
      threads: [makeThread({ id: "t1", messageCount: 150 })],
      view: "thread",
      activeThreadId: "t1",
    });
  });

  it("a full page (exactly 100) offers older replies", async () => {
    apiClient.mockResolvedValueOnce(jsonResponse(page(51, 150)));
    await useThreadStore.getState().loadReplies("t1");
    const state = useThreadStore.getState();
    expect(state.replies).toHaveLength(100);
    expect(state.hasMoreReplies).toBe(true);
    expect(state.oldestReplyId).toBe("r051");
  });

  it("a page under 100 offers nothing", async () => {
    apiClient.mockResolvedValueOnce(jsonResponse(page(1, 99)));
    await useThreadStore.getState().loadReplies("t1");
    expect(useThreadStore.getState().hasMoreReplies).toBe(false);
  });

  it("pages with before, prepends in order, dedupes and hides the control on a short page", async () => {
    apiClient.mockResolvedValueOnce(jsonResponse(page(51, 150)));
    await useThreadStore.getState().loadReplies("t1");

    // The older page overlaps by one reply: it appears once.
    apiClient.mockResolvedValueOnce(jsonResponse(page(2, 51)));
    await useThreadStore.getState().loadOlderReplies();
    expect(apiClient.mock.calls[1][0]).toBe(
      `/api/rooms/${ROOM_ID}/messages?threadId=t1&limit=100&before=r051`,
    );
    const state = useThreadStore.getState();
    expect(state.replies).toHaveLength(149);
    expect(state.replies[0].id).toBe("r002");
    expect(state.replies[148].id).toBe("r150");
    expect(new Set(state.replies.map((r) => r.id)).size).toBe(149);
    expect(state.hasMoreReplies).toBe(false);
    expect(state.oldestReplyId).toBe("r002");

    // Nothing left: another call does not fetch.
    apiClient.mockClear();
    await useThreadStore.getState().loadOlderReplies();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it("a full older page keeps the control", async () => {
    apiClient.mockResolvedValueOnce(jsonResponse(page(101, 200)));
    await useThreadStore.getState().loadReplies("t1");
    apiClient.mockResolvedValueOnce(jsonResponse(page(1, 100)));
    await useThreadStore.getState().loadOlderReplies();
    expect(useThreadStore.getState().hasMoreReplies).toBe(true);
    expect(useThreadStore.getState().replies).toHaveLength(200);
  });

  it("a failed older page keeps the replies and reports the error", async () => {
    apiClient.mockResolvedValueOnce(jsonResponse(page(51, 150)));
    await useThreadStore.getState().loadReplies("t1");
    apiClient.mockResolvedValueOnce(jsonResponse({ error: "x" }, 500));
    await useThreadStore.getState().loadOlderReplies();
    const state = useThreadStore.getState();
    expect(state.replies).toHaveLength(100);
    expect(state.olderRepliesError).toBe(true);
    expect(state.hasMoreReplies).toBe(true);
    expect(state.loadingOlderReplies).toBe(false);
  });

  it("discards an older page that arrives after a thread switch", async () => {
    apiClient.mockResolvedValueOnce(jsonResponse(page(51, 150)));
    await useThreadStore.getState().loadReplies("t1");
    let release: (r: Response) => void = () => undefined;
    apiClient.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const pending = useThreadStore.getState().loadOlderReplies();
    apiClient.mockResolvedValue(jsonResponse([]));
    useThreadStore.setState({ threads: [makeThread({ id: "t1" }), makeThread({ id: "t2" })] });
    await useThreadStore.getState().openThread("t2");
    release(jsonResponse(page(1, 50)));
    await pending;
    const state = useThreadStore.getState();
    expect(state.activeThreadId).toBe("t2");
    expect(state.replies).toEqual([]);
    expect(state.hasMoreReplies).toBe(false);
  });

  it("discards an older page that arrives after a room switch", async () => {
    apiClient.mockResolvedValueOnce(jsonResponse(page(51, 150)));
    await useThreadStore.getState().loadReplies("t1");
    let release: (r: Response) => void = () => undefined;
    apiClient.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const pending = useThreadStore.getState().loadOlderReplies();
    useThreadStore.getState().setRoom("r2");
    release(jsonResponse(page(1, 50)));
    await pending;
    expect(useThreadStore.getState().replies).toEqual([]);
    expect(useThreadStore.getState().roomId).toBe("r2");
  });

  it("discards a first page of replies that arrives after a thread switch", async () => {
    let release: (r: Response) => void = () => undefined;
    apiClient.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const pending = useThreadStore.getState().loadReplies("t1");
    useThreadStore.setState({ activeThreadId: "t2" });
    release(jsonResponse(page(1, 100)));
    await pending;
    expect(useThreadStore.getState().replies).toEqual([]);
    expect(useThreadStore.getState().hasMoreReplies).toBe(false);
  });
});

describe("a reply counts once", () => {
  it("also while its thread is closed, however often it is delivered", () => {
    useThreadStore.setState({
      threads: [makeThread({ id: "t1", messageCount: 2 })],
      view: "closed",
      activeThreadId: null,
    });
    const reply = makeMessage({ id: "dup", threadId: "t1", createdAt: "2026-11-07T10:30:00.000Z" });
    useThreadStore.getState().applyReply(reply);
    useThreadStore.getState().applyReply(reply);
    expect(useThreadStore.getState().threads[0].messageCount).toBe(3);
    useThreadStore.getState().applyReply(makeMessage({ id: "other", threadId: "t1" }));
    expect(useThreadStore.getState().threads[0].messageCount).toBe(4);
  });

  it("a reply counted while closed fills the panel without counting again once it opens", () => {
    useThreadStore.setState({ threads: [makeThread({ id: "t1", messageCount: 0 })], view: "closed" });
    const reply = makeMessage({ id: "early", threadId: "t1" });
    useThreadStore.getState().applyReply(reply);
    useThreadStore.setState({ view: "thread", activeThreadId: "t1", replies: [] });
    useThreadStore.getState().applyReply(reply);
    const state = useThreadStore.getState();
    expect(state.threads[0].messageCount).toBe(1);
    expect(state.replies.map((r) => r.id)).toEqual(["early"]);
  });

  it("forgets the counted ids when the room changes", () => {
    useThreadStore.setState({ threads: [makeThread({ id: "t1" })] });
    useThreadStore.getState().applyReply(makeMessage({ id: "x", threadId: "t1" }));
    expect(Object.keys(useThreadStore.getState().countedReplyIds)).toEqual(["x"]);
    useThreadStore.getState().setRoom("r2");
    expect(useThreadStore.getState().countedReplyIds).toEqual({});
  });
});
