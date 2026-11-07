// @vitest-environment jsdom
/**
 * socketStore routing of thread traffic: `message:new` with a threadId goes to
 * the thread store and never into the room list; `thread:created` adds the
 * thread; `message:send` carries the threadId only for a reply.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sockets = vi.hoisted(() => {
  const handlers: Record<string, (payload: unknown) => void> = {};
  const socket = {
    connected: true,
    on: (event: string, handler: (payload: unknown) => void) => {
      handlers[event] = handler;
    },
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  return { handlers, socket };
});
vi.mock("socket.io-client", () => ({ io: () => sockets.socket }));
vi.mock("../lib/apiClient", () => ({ apiClient: vi.fn() }));

import { useSocketStore } from "../stores/socketStore";
import { useChatStore } from "../stores/chatStore";
import { useThreadStore } from "../stores/threadStore";
import { useAuthStore } from "../stores/authStore";
import { agent, makeThread, ROOM_ID } from "./helpers/threadFixtures";

const incoming = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  content: `content ${id}`,
  senderId: "u2",
  roomId: ROOM_ID,
  createdAt: "2026-11-07T11:00:00.000Z",
  sender: agent,
  reactions: [],
  ...over,
});

beforeEach(() => {
  sockets.socket.emit.mockReset();
  useAuthStore.setState({ token: "t", user: null });
  useSocketStore.setState({ socket: null, isConnected: false });
  useSocketStore.getState().connect();
  useChatStore.setState({ messages: [], currentRoomId: ROOM_ID, currentRoom: null, rooms: [], unreadCounts: {} });
  useThreadStore.setState({ roomId: null });
  useThreadStore.getState().setRoom(ROOM_ID);
  useThreadStore.setState({
    threads: [makeThread({ id: "t1", messageCount: 2 })],
    activeThreadId: "t1",
    view: "thread",
    replies: [],
  });
});

describe("message:new with a threadId", () => {
  it("lands in the thread, not in the room list (an agent reply included)", () => {
    sockets.handlers["message:new"](incoming("agent-reply", { threadId: "t1" }));
    expect(useChatStore.getState().messages).toEqual([]);
    const threads = useThreadStore.getState();
    expect(threads.replies.map((r) => r.id)).toEqual(["agent-reply"]);
    expect(threads.replies[0].sender.userType).toBe("AI_ICE");
    expect(threads.threads[0].messageCount).toBe(3);
  });

  it("still updates the count of a thread whose panel is closed", () => {
    useThreadStore.setState({ view: "closed", activeThreadId: null });
    sockets.handlers["message:new"](incoming("r", { threadId: "t1" }));
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useThreadStore.getState().threads[0].messageCount).toBe(3);
    expect(useThreadStore.getState().replies).toEqual([]);
  });

  it("a top-level message goes to the room list and leaves the threads alone", () => {
    sockets.handlers["message:new"](incoming("top"));
    expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(["top"]);
    expect(useThreadStore.getState().threads[0].messageCount).toBe(2);
    expect(useThreadStore.getState().replies).toEqual([]);
  });

  it("a reply for a room that is not open changes neither list", () => {
    sockets.handlers["message:new"](incoming("other", { threadId: "t1", roomId: "r2" }));
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useThreadStore.getState().threads[0].messageCount).toBe(2);
  });
});

describe("thread events", () => {
  it("thread:created adds the thread to the list", () => {
    sockets.handlers["thread:created"](makeThread({ id: "t2", title: "Fresh" }));
    expect(useThreadStore.getState().threads.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  it("message:deleted removes the reply from the open thread", () => {
    useThreadStore.setState({
      replies: [
        { id: "x", content: "x", sender: agent, createdAt: "2026-11-07T11:00:00.000Z", threadId: "t1" },
      ],
    });
    sockets.handlers["message:deleted"]({ messageId: "x", roomId: ROOM_ID });
    expect(useThreadStore.getState().replies).toEqual([]);
  });
});

describe("sendMessage", () => {
  it("adds the threadId to the payload of a reply only", () => {
    useSocketStore.getState().sendMessage(ROOM_ID, "hi", "t1");
    useSocketStore.getState().sendMessage(ROOM_ID, "top");
    expect(sockets.socket.emit).toHaveBeenNthCalledWith(1, "message:send", {
      roomId: ROOM_ID,
      content: "hi",
      threadId: "t1",
    });
    expect(sockets.socket.emit).toHaveBeenNthCalledWith(2, "message:send", {
      roomId: ROOM_ID,
      content: "top",
    });
  });
});
