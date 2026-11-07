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
