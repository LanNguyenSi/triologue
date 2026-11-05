/**
 * GET /api/rooms/:roomId: agent participants carry the live session status
 * the gateway reported through POST /api/agents/me/presence
 * (`agent_presence:<userId>` in Redis), with `presenceMeta`; without a
 * stored status the socket/activity presence applies as before, and a Redis
 * failure on the lookup degrades the same way.
 *
 * The 'redis' package is mocked (the route's module-level client) and the
 * session `authenticate` middleware is replaced so the request runs as a
 * room member; Prisma is mocked with one room of a human and an agent.
 *
 * Mutation guards:
 *   - letting the socket presence win over the stored status makes
 *     "reports the stored status" fail (the agent is socket-online there,
 *     so the guess would say online, the stored status says waiting)
 *   - dropping the catch around mGet makes "degrades when Redis fails" fail
 *     (the route would answer 500)
 */

const mGet = jest.fn();
jest.mock("redis", () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    // Both participants are socket-online, so a stored agent status that
    // shows up proves it beat the online_users guess, not just filled a gap.
    smIsMember: jest.fn().mockResolvedValue([true, true]),
    mGet: (...args: unknown[]) => mGet(...args),
    on: jest.fn(),
  })),
}));

jest.mock("../middleware/auth", () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user: unknown }).user = { id: "user-human", username: "alice", isAdmin: false };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock("../services/inboxService", () => ({
  createInboxItems: jest.fn(async () => undefined),
}));

const room = {
  id: "room-1",
  name: "Room One",
  description: null,
  roomType: "GROUP",
  isPrivate: false,
  _count: { participants: 2, messages: 0 },
  participants: [
    {
      role: "OWNER",
      joinedAt: new Date("2026-01-01T00:00:00Z"),
      user: { id: "user-human", username: "alice", displayName: "Alice", userType: "HUMAN", avatar: null },
    },
    {
      role: "MEMBER",
      joinedAt: new Date("2026-01-01T00:00:00Z"),
      user: { id: "user-agent", username: "agent_claude_1234abcd", displayName: "Claude", userType: "AI_AGENT", avatar: null },
    },
  ],
};

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    roomParticipant: {
      findUnique: jest.fn(async () => ({ userId: "user-human", roomId: "room-1" })),
    },
    room: {
      findUnique: jest.fn(async () => room),
    },
    project: {
      findFirst: jest.fn(async () => null),
    },
    agentToken: {
      findMany: jest.fn(async () => []),
    },
  },
}));

import express from "express";
import request from "./helpers/loopbackRequest";
import { roomRoutes } from "../routes/rooms";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/rooms", roomRoutes);
  return app;
}

function agentOf(body: { participants: Array<{ userId: string }> }) {
  return body.participants.find((p) => p.userId === "user-agent") as Record<string, unknown>;
}

beforeEach(() => {
  mGet.mockReset();
});

describe("GET /api/rooms/:roomId agent presence", () => {
  it("reports the stored status and its metadata for the agent", async () => {
    mGet.mockResolvedValue([
      JSON.stringify({ status: "waiting_approval", host: "mac-studio-01", project: "evidence-api", sessionId: "sess-1", detail: "Bash", sessions: 1, updatedAt: "2026-11-05T07:00:00.000Z" }),
    ]);

    const res = await request(buildApp()).get("/api/rooms/room-1");

    expect(res.status).toBe(200);
    expect(mGet).toHaveBeenCalledWith(["agent_presence:user-agent"]);
    expect(agentOf(res.body)).toMatchObject({
      presenceStatus: "waiting",
      presenceMeta: { host: "mac-studio-01", project: "evidence-api", sessionId: "sess-1", detail: "Bash", sessions: 1, updatedAt: "2026-11-05T07:00:00.000Z", expiresAt: "2026-11-05T07:00:00.000Z" },
    });
    // The human keeps the socket presence and gets no presenceMeta.
    const human = res.body.participants.find((p: { userId: string }) => p.userId === "user-human");
    expect(human.presenceStatus).toBe("online");
    expect(human.presenceMeta).toBeUndefined();
  });

  it.each([
    ["online", "online"],
    ["working", "working"],
    ["error", "error"],
  ])("maps the stored status %s to presenceStatus %s", async (stored, expected) => {
    mGet.mockResolvedValue([JSON.stringify({ status: stored, updatedAt: "2026-11-05T07:00:00.000Z" })]);
    const res = await request(buildApp()).get("/api/rooms/room-1");
    expect(agentOf(res.body).presenceStatus).toBe(expected);
  });

  it("does not look presence up for a room excluded from presence", async () => {
    mGet.mockResolvedValue([JSON.stringify({ status: "working", updatedAt: "2026-11-05T07:00:00.000Z" })]);
    const res = await request(buildApp()).get("/api/rooms/onboarding");
    expect(res.status).toBe(200);
    expect(mGet).not.toHaveBeenCalled();
    expect(agentOf(res.body).presenceStatus).toBe("online");
    expect(agentOf(res.body).presenceMeta).toBeUndefined();
  });

  it("falls back to the activity presence without a stored status or with a malformed one", async () => {
    mGet.mockResolvedValue([null]);
    let res = await request(buildApp()).get("/api/rooms/room-1");
    // Socket-online agent without a stored status: the ordinary presence.
    expect(agentOf(res.body)).toMatchObject({ presenceStatus: "online" });
    expect(agentOf(res.body).presenceMeta).toBeUndefined();

    mGet.mockResolvedValue(["{not json"]);
    res = await request(buildApp()).get("/api/rooms/room-1");
    expect(agentOf(res.body).presenceStatus).toBe("online");
  });

  it("degrades when Redis fails on the presence lookup or answers nonsense", async () => {
    mGet.mockRejectedValue(new Error("ECONNRESET"));
    let res = await request(buildApp()).get("/api/rooms/room-1");
    expect(res.status).toBe(200);
    expect(agentOf(res.body).presenceStatus).toBe("online");

    mGet.mockResolvedValue(undefined);
    res = await request(buildApp()).get("/api/rooms/room-1");
    expect(res.status).toBe(200);
    expect(agentOf(res.body).presenceMeta).toBeUndefined();
  });
});
