/**
 * POST /api/agents/message with the optional `threadId` body field.
 *
 * The full app (index.ts) boots redis, sentry, sockets and plugins, so this
 * suite mounts `agentRoutes` on a throwaway express app and mocks the module
 * boundaries the route touches: `../lib/prisma` (token lookup, participation,
 * thread lookup, message write), the audit service, the mention inbox, the
 * plugin bus and the session `authenticate` middleware (unused by this route
 * but imported by the router module).
 *
 * Every test posts into its own room and authenticates with its own token
 * row, so the route's 5-second near-duplicate check (keyed by agent user id
 * and room) and its per-minute limiter (keyed by token row id, module-level
 * state) never couple two tests.
 *
 * Mutation guards:
 *   - dropping the `thread.roomId !== roomId` comparison makes "thread of
 *     another room" fail
 *   - moving the thread lookup in front of the participation check makes
 *     "non-participant" fail (the lookup must not run)
 *   - writing `threadId: null` instead of omitting the key makes the
 *     "top-level" tests fail (the create data must not carry the key)
 */

type AgentTokenRow = {
  id: string;
  userId: string;
  status: "active" | "pending" | "rejected";
  isActive: boolean;
  config: Record<string, unknown>;
  agentUser: { id: string; isActive: boolean; displayName: string };
};

const agentTokens: Record<string, AgentTokenRow> = {};
let threads: Record<string, { id: string; roomId: string }> = {};
let participantKeys = new Set<string>(); // `${userId}:${roomId}`
let createdMessages: Array<Record<string, unknown>> = [];
let threadUpdates: Array<{ where: { id: string }; data: Record<string, unknown>; viaTransaction: boolean }> = [];
let messageCreatedViaTransaction: boolean[] = [];
let failThreadUpdate = false;

jest.mock("../lib/prisma", () => {
  // Only calls made on the client the transaction callback receives count as
  // part of the transaction.
  const txState = { viaTransaction: false };
  const prismaMock: Record<string, unknown> = {
    agentToken: {
      findUnique: jest.fn(async ({ where }: { where: { token?: string } }) =>
        where.token !== undefined ? (agentTokens[where.token] ?? null) : null,
      ),
      // Previous-token (rotation grace) lookup: no row ever has one here.
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
    },
    roomParticipant: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { userId_roomId: { userId: string; roomId: string } };
        }) => {
          const { userId, roomId } = where.userId_roomId;
          return participantKeys.has(`${userId}:${roomId}`)
            ? { userId, roomId }
            : null;
        },
      ),
    },
    // getLinkedProjectStatus: no room here is linked to a project.
    project: { findFirst: jest.fn(async () => null) },
    thread: {
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) => threads[where.id] ?? null,
      ),
      update: jest.fn(
        async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          if (failThreadUpdate) throw new Error("thread update failed");
          threadUpdates.push({ ...args, viaTransaction: txState.viaTransaction });
          return {};
        },
      ),
    },
    message: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        messageCreatedViaTransaction.push(txState.viaTransaction);
        createdMessages.push(data);
        return {
          id: `msg-${createdMessages.length}`,
          ...data,
          threadId: (data.threadId as string | undefined) ?? null,
          sender: {
            id: data.senderId,
            username: "agent_test",
            displayName: "Test Agent",
            userType: "AI_AGENT",
            avatar: null,
          },
          reactions: [],
        };
      }),
    },
    room: { update: jest.fn(async () => ({})) },
  };
  // The interactive transaction hands its callback a separate client whose
  // message.create and thread.update forward to the model mocks above with
  // `txState.viaTransaction` set, so a write made on the plain client inside
  // the callback is told apart from one made through the transaction. A
  // failing callback rolls the insert back, modelled by dropping the messages
  // created since the transaction began.
  const models = prismaMock as {
    message: { create: (a: unknown) => Promise<unknown> };
    thread: { update: (a: unknown) => Promise<unknown> };
  };
  const through = <T,>(run: () => Promise<T>): Promise<T> => {
    txState.viaTransaction = true;
    return run().finally(() => {
      txState.viaTransaction = false;
    });
  };
  prismaMock.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => {
    const created = createdMessages.length;
    try {
      return await fn({
        message: { create: (args: unknown) => through(() => models.message.create(args)) },
        thread: { update: (args: unknown) => through(() => models.thread.update(args)) },
      });
    } catch (err) {
      createdMessages.length = created;
      throw err;
    }
  });
  return { __esModule: true, default: prismaMock };
});

const mockLogAuditEvent = jest.fn();
jest.mock("../services/auditService", () => ({
  logAuditEvent: (...args: unknown[]) => mockLogAuditEvent(...args),
}));

jest.mock("../services/inboxService", () => ({
  createMentionInboxItems: jest.fn(async () => undefined),
}));

jest.mock("../plugins/manager", () => ({
  pluginManager: { emit: jest.fn(async () => undefined) },
}));

jest.mock("../connectors/mcp/mcpBridge", () => ({
  getActiveConnections: jest.fn(),
  callTool: jest.fn(),
}));

jest.mock("../connectors/registry", () => ({
  listEnabledConnectors: jest.fn().mockReturnValue([]),
  initConnectors: jest.fn(),
}));

jest.mock("../middleware/auth", () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from "express";
import request from "./helpers/loopbackRequest";
import prisma from "../lib/prisma";
import { agentRoutes } from "../routes/agents";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentRoutes);
  return app;
}

const TOKEN = "byoa_thread_test_token";
const AGENT_USER = "user-agent-thread";

let roomSeq = 0;
let tokenSeq = 0;
/** A fresh room per test: the agent is a participant, the thread lives in it. */
function freshRoom(): { roomId: string; threadId: string } {
  roomSeq += 1;
  const roomId = `room-${roomSeq}`;
  const threadId = `thread-${roomSeq}`;
  participantKeys.add(`${AGENT_USER}:${roomId}`);
  threads[threadId] = { id: threadId, roomId };
  return { roomId, threadId };
}

function post(body: Record<string, unknown>) {
  return request(buildApp())
    .post("/api/agents/message")
    .set("Authorization", `Bearer ${TOKEN}`)
    .send(body);
}

beforeEach(() => {
  for (const k of Object.keys(agentTokens)) delete agentTokens[k];
  tokenSeq += 1;
  agentTokens[TOKEN] = {
    // A fresh row id per test: the per-minute limiter is keyed by it.
    id: `token-row-${tokenSeq}`,
    userId: AGENT_USER,
    status: "active",
    isActive: true,
    config: {},
    agentUser: { id: AGENT_USER, isActive: true, displayName: "Test Agent" },
  };
  threads = {};
  participantKeys = new Set();
  createdMessages = [];
  threadUpdates = [];
  messageCreatedViaTransaction = [];
  failThreadUpdate = false;
  mockLogAuditEvent.mockReset();
  (prisma.thread.findUnique as jest.Mock).mockClear();
  (prisma.roomParticipant.findUnique as jest.Mock).mockClear();
  (prisma.project.findFirst as jest.Mock).mockClear();
  (prisma.message.create as jest.Mock).mockClear();
  (prisma.thread.update as jest.Mock).mockClear();
  (prisma.$transaction as jest.Mock).mockClear();
});

describe("POST /api/agents/message without a thread", () => {
  it("omitted threadId posts a top-level message and answers threadId null", async () => {
    const { roomId } = freshRoom();

    const res = await post({ roomId, content: "top level" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, messageId: "msg-1", threadId: null });
    expect(createdMessages).toHaveLength(1);
    expect(createdMessages[0]).not.toHaveProperty("threadId");
    expect(prisma.thread.findUnique).not.toHaveBeenCalled();
    expect(prisma.thread.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockLogAuditEvent.mock.calls[0][0].details).not.toHaveProperty("threadId");
  });

  it("threadId null is the same as omitted", async () => {
    const { roomId } = freshRoom();

    const res = await post({ roomId, content: "top level", threadId: null });

    expect(res.status).toBe(201);
    expect(res.body.threadId).toBeNull();
    expect(createdMessages[0]).not.toHaveProperty("threadId");
    expect(prisma.thread.findUnique).not.toHaveBeenCalled();
    expect(prisma.thread.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/agents/message thread counters", () => {
  it("increments the thread's messageCount and sets lastActivity in the same transaction as the insert", async () => {
    const { roomId, threadId } = freshRoom();

    const res = await post({ roomId, content: "counted", threadId });

    expect(res.status).toBe(201);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(messageCreatedViaTransaction).toEqual([true]);
    expect(threadUpdates).toHaveLength(1);
    expect(threadUpdates[0]).toEqual({
      where: { id: threadId },
      data: { messageCount: { increment: 1 }, lastActivity: expect.any(Date) },
      viaTransaction: true,
    });
  });

  it("two replies increment twice", async () => {
    const { roomId, threadId } = freshRoom();

    expect((await post({ roomId, content: "first reply", threadId })).status).toBe(201);
    expect((await post({ roomId, content: "second, different words entirely", threadId })).status).toBe(201);

    expect(threadUpdates.map((u) => u.where.id)).toEqual([threadId, threadId]);
  });

  it("a refused thread (foreign room) updates no counter", async () => {
    const { roomId } = freshRoom();
    const other = freshRoom();

    const res = await post({ roomId, content: "wrong room", threadId: other.threadId });

    expect(res.status).toBe(400);
    expect(threadUpdates).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("a failing counter update rolls the insert back and answers 500", async () => {
    const { roomId, threadId } = freshRoom();
    failThreadUpdate = true;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await post({ roomId, content: "will not stick", threadId });
    errorSpy.mockRestore();

    expect(res.status).toBe(500);
    expect(createdMessages).toHaveLength(0);
  });
});

describe("POST /api/agents/message into a thread", () => {
  it("stores the message in a thread of the room and reports it", async () => {
    const { roomId, threadId } = freshRoom();

    const res = await post({ roomId, content: "in thread", threadId });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, messageId: "msg-1", threadId });
    expect(createdMessages[0]).toMatchObject({ roomId, threadId, messageType: "AI_RESPONSE" });
    expect(prisma.thread.findUnique).toHaveBeenCalledWith({
      where: { id: threadId },
      select: { id: true, roomId: true },
    });
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "message.send",
        roomId,
        details: expect.objectContaining({ threadId }),
      }),
    );
  });

  it("trims surrounding whitespace off threadId before the lookup", async () => {
    const { roomId, threadId } = freshRoom();

    const res = await post({ roomId, content: "in thread", threadId: `  ${threadId}  ` });

    expect(res.status).toBe(201);
    expect(res.body.threadId).toBe(threadId);
    expect(createdMessages[0]).toMatchObject({ threadId });
  });

  it("rejects a thread that belongs to another room and writes nothing", async () => {
    const { roomId } = freshRoom();
    const other = freshRoom();

    const res = await post({ roomId, content: "wrong room", threadId: other.threadId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("threadId must name a thread in roomId");
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an unknown thread id and writes nothing", async () => {
    const { roomId } = freshRoom();

    const res = await post({ roomId, content: "unknown", threadId: "thread-nope" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("threadId must name a thread in roomId");
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty string", ""],
    ["a blank string", "   "],
    ["a number", 42],
    ["an object", { id: "thread-1" }],
    ["a string with a NUL character", "thread\u0000x"],
    ["a string with a lone surrogate", "thread\ud800x"],
  ])("rejects %s as threadId before any lookup", async (_label, threadId) => {
    const { roomId } = freshRoom();

    const res = await post({ roomId, content: "malformed", threadId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("threadId must be a non-empty string when present");
    expect(prisma.thread.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("a refused thread id does not seed the duplicate check, so the corrected retry succeeds", async () => {
    const { roomId, threadId } = freshRoom();

    const refused = await post({ roomId, content: "same text twice", threadId: "thread-nope" });
    expect(refused.status).toBe(400);

    const retried = await post({ roomId, content: "same text twice", threadId });

    // Before the fix the first (refused) send recorded the text and this
    // retry got 429 "Duplicate message detected within 5 seconds".
    expect(retried.status).toBe(201);
    expect(retried.body.threadId).toBe(threadId);
  });

  it("a stored message still seeds the duplicate check", async () => {
    const { roomId } = freshRoom();

    const first = await post({ roomId, content: "repeat after me" });
    expect(first.status).toBe(201);

    const second = await post({ roomId, content: "repeat after me" });

    expect(second.status).toBe(429);
    expect(second.body.error).toBe("Duplicate message detected within 5 seconds");
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
  });

  it("checks participation before it looks the thread up", async () => {
    const { roomId, threadId } = freshRoom();
    participantKeys.delete(`${AGENT_USER}:${roomId}`);

    const res = await post({ roomId, content: "not a member", threadId });

    expect(res.status).toBe(403);
    expect(prisma.thread.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});

// Postgres refuses a NUL in text and Prisma cannot serialise a lone surrogate
// (which a JSON body can carry), so a send naming either is answered 400 here
// instead of reaching a query and failing with 500.
describe("POST /api/agents/message with characters Postgres cannot store", () => {
  it.each([
    ["a NUL character in content", { content: "hello\u0000world" }],
    ["a lone surrogate in content", { content: "hello\ud800world" }],
    ["a NUL character in roomId", { roomId: "room\u00001" }],
    ["a lone surrogate in roomId", { roomId: "room\ud8001" }],
  ])("%s is 400 and no query runs", async (_label, override) => {
    const { roomId } = freshRoom();

    const res = await post({ roomId, content: "fine", ...override });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "roomId and content must not contain characters Postgres cannot store",
    );
    expect(prisma.roomParticipant.findUnique).not.toHaveBeenCalled();
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
    expect(prisma.thread.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("a well-formed emoji (a surrogate pair) in content is stored", async () => {
    const { roomId } = freshRoom();

    const res = await post({ roomId, content: "shipped \u{1F680} today" });

    expect(res.status).toBe(201);
    expect(createdMessages[0]).toMatchObject({
      content: "shipped \u{1F680} today",
      roomId,
    });
  });
});

// The other agents route that hands a body `roomId` to a where clause is the
// admin's PUT /api/agents/:id/rooms; the same characters are refused there with
// 400 before its first query (findUnique below returns null for an id lookup,
// so a passed guard would show up as a 404, not this 400).
describe("PUT /api/agents/:id/rooms with characters Postgres cannot store", () => {
  const putRooms = (body: Record<string, unknown>) =>
    request(buildApp()).put("/api/agents/agent-1/rooms").send(body);

  it.each([
    ["a NUL character", "room\u00001"],
    ["a lone surrogate", "room\ud8001"],
  ])("a %s in roomId is 400 and no query runs", async (_label, roomId) => {
    (prisma.agentToken.findUnique as jest.Mock).mockClear();

    const res = await putRooms({ roomId, action: "add" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      "roomId must not contain characters Postgres cannot store",
    );
    expect(prisma.agentToken.findUnique).not.toHaveBeenCalled();
  });

  it("a well-formed roomId is not refused by the guard", async () => {
    const res = await putRooms({ roomId: "room-1", action: "add" });

    // The mocked findUnique answers no agent for an id lookup: the request got
    // past the character guard and died at the 404, as it did before it.
    expect(res.status).toBe(404);
  });
});
