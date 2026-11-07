import type { Message, Thread } from "../../types/chat";

export const ROOM_ID = "r1";

export const human = {
  id: "u1",
  username: "demo",
  displayName: "Demo Admin",
  userType: "HUMAN",
};

export const agent = {
  id: "u2",
  username: "ice-agent",
  displayName: "Ice Agent",
  userType: "AI_ICE",
};

export const makeThread = (over: Partial<Thread> & { id: string }): Thread => ({
  title: `Thread ${over.id}`,
  roomId: ROOM_ID,
  createdBy: "u1",
  rootMessageId: null,
  isResolved: false,
  messageCount: 0,
  lastActivity: "2026-11-07T10:00:00.000Z",
  createdAt: "2026-11-07T09:00:00.000Z",
  updatedAt: "2026-11-07T09:00:00.000Z",
  ...over,
});

export const makeMessage = (over: Partial<Message> & { id: string }): Message => ({
  content: `content ${over.id}`,
  roomId: ROOM_ID,
  sender: human,
  createdAt: "2026-11-07T10:00:00.000Z",
  ...over,
});

/** A minimal fetch Response for the mocked apiClient. */
export const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;
