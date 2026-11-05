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
 * Every test posts into its own room, so the route's 5-second near-duplicate
 * check (keyed by agent user id and room) never trips between tests.
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

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
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
    },
    message: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
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
  },
}));

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
  agentTokens[TOKEN] = {
    id: "token-row-thread",
    userId: AGENT_USER,
    status: "active",
    isActive: true,
    // Well above the number of sends in this file, so the per-minute
    // limiter (keyed by token row id) never answers 429 here.
    config: { maxMessagesPerMinute: 60 },
    agentUser: { id: AGENT_USER, isActive: true, displayName: "Test Agent" },
  };
  threads = {};
  participantKeys = new Set();
  createdMessages = [];
  mockLogAuditEvent.mockReset();
  (prisma.thread.findUnique as jest.Mock).mockClear();
  (prisma.message.create as jest.Mock).mockClear();
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
  ])("rejects %s as threadId before any lookup", async (_label, threadId) => {
    const { roomId } = freshRoom();

    const res = await post({ roomId, content: "malformed", threadId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("threadId must be a non-empty string when present");
    expect(prisma.thread.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
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
