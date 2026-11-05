/**
 * POST /api/agents/me/presence (server/src/routes/agentPresence.ts).
 *
 * Mounts the router on a throwaway express app with the shared Redis client
 * and the Socket.io server replaced by fakes (`app.set("redis")`,
 * `app.set("io")`), the Prisma client mocked for byoaAuth's token lookup and
 * the room memberships, and no real network.
 *
 * Mutation guards:
 *   - deriving the Redis key from the body instead of the token makes
 *     "writes under the token's user" fail
 *   - dropping the EX option makes "stores with the TTL" fail
 *   - broadcasting to excluded rooms makes "skips excluded rooms" fail
 *   - answering 204 on a Redis failure makes "503 when the store fails" fail
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
let memberships: Array<{ roomId: string }> = [];

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    agentToken: {
      findUnique: jest.fn(async ({ where }: { where: { token?: string } }) =>
        where.token !== undefined ? (agentTokens[where.token] ?? null) : null,
      ),
      findFirst: jest.fn(async () => null),
    },
    roomParticipant: {
      findMany: jest.fn(async () => memberships),
    },
  },
}));

import express from "express";
import request from "./helpers/loopbackRequest";
import { agentPresenceRoutes } from "../routes/agentPresence";

const TOKEN = "byoa_presence_token";
const AGENT_USER = "user-agent-presence";

const redisFake = {
  set: jest.fn(async () => "OK"),
  del: jest.fn(async () => 1),
};
const emit = jest.fn();
const ioFake = { to: jest.fn((_room: string) => ({ emit })) };

function buildApp(options: { redis?: typeof redisFake | null; io?: typeof ioFake | null } = {}) {
  const app = express();
  app.use(express.json());
  if (options.redis !== null) app.set("redis", options.redis ?? redisFake);
  if (options.io !== null) app.set("io", options.io ?? ioFake);
  app.use("/api/agents/me/presence", agentPresenceRoutes);
  return app;
}

function post(body: unknown, app = buildApp(), token: string | null = TOKEN) {
  const req = request(app).post("/api/agents/me/presence");
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req.send(body as object);
}

beforeEach(() => {
  for (const k of Object.keys(agentTokens)) delete agentTokens[k];
  agentTokens[TOKEN] = {
    id: "token-row-presence",
    userId: AGENT_USER,
    status: "active",
    isActive: true,
    config: {},
    agentUser: { id: AGENT_USER, isActive: true, displayName: "Presence Agent" },
  };
  memberships = [{ roomId: "room-1" }, { roomId: "registration" }, { roomId: "room-2" }];
  redisFake.set.mockClear().mockResolvedValue("OK");
  redisFake.del.mockClear().mockResolvedValue(1);
  emit.mockClear();
  ioFake.to.mockClear();
});

describe("auth", () => {
  it("answers 401 without a byoa bearer and 403 for a pending agent", async () => {
    expect((await post({ status: "online" }, buildApp(), null)).status).toBe(401);
    agentTokens["byoa_pending"] = { ...agentTokens[TOKEN], status: "pending" };
    expect((await post({ status: "online" }, buildApp(), "byoa_pending")).status).toBe(403);
    expect(redisFake.set).not.toHaveBeenCalled();
  });
});

describe("validation", () => {
  it.each([
    ["an unknown status", { status: "sleeping" }, "status must be one of online, working, waiting_approval, error, offline"],
    ["a missing status", {}, "status must be one of online, working, waiting_approval, error, offline"],
    ["an empty host", { status: "online", host: "" }, "host must be a non-empty string of at most 255 characters"],
    ["a too long detail", { status: "working", detail: "x".repeat(501) }, "detail must be a non-empty string of at most 500 characters"],
    ["a ttl below 30", { status: "online", ttlSeconds: 10 }, "ttlSeconds must be an integer between 30 and 300"],
    ["a fractional sessions count", { status: "online", sessions: 1.5 }, "sessions must be an integer between 0 and 100"],
  ])("answers 400 for %s and writes nothing", async (_label, body, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(error);
    expect(redisFake.set).not.toHaveBeenCalled();
    expect(redisFake.del).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("storing presence", () => {
  it("writes under the token's user with the default TTL and broadcasts to the agent's rooms", async () => {
    const res = await post({ status: "working", host: "mac-studio-01", project: "evidence-api", sessionId: "sess-1", detail: "npm test", userId: "someone-else" });

    expect(res.status).toBe(204);
    expect(redisFake.set).toHaveBeenCalledTimes(1);
    const [key, value, opts] = redisFake.set.mock.calls[0] as unknown as [string, string, { EX: number }];
    expect(key).toBe(`agent_presence:${AGENT_USER}`);
    expect(opts).toEqual({ EX: 120 });
    const stored = JSON.parse(value);
    expect(stored).toMatchObject({ status: "working", host: "mac-studio-01", project: "evidence-api", sessionId: "sess-1", detail: "npm test", sessions: 1 });
    expect(typeof stored.updatedAt).toBe("string");

    // Broadcast to room-1 and room-2, never to the excluded registration room.
    expect(ioFake.to.mock.calls.map(([room]) => room)).toEqual(["room-1", "room-2"]);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith("agent:presence", expect.objectContaining({ userId: AGENT_USER, status: "working", host: "mac-studio-01" }));
  });

  it("stores with the TTL the caller asks for", async () => {
    await post({ status: "online", ttlSeconds: 45, sessions: 2 });
    const [, value, opts] = redisFake.set.mock.calls[0] as unknown as [string, string, { EX: number }];
    expect(opts).toEqual({ EX: 45 });
    expect(JSON.parse(value).sessions).toBe(2);
  });

  it("offline deletes the key and broadcasts offline", async () => {
    const res = await post({ status: "offline" });

    expect(res.status).toBe(204);
    expect(redisFake.del).toHaveBeenCalledWith(`agent_presence:${AGENT_USER}`);
    expect(redisFake.set).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("agent:presence", expect.objectContaining({ userId: AGENT_USER, status: "offline" }));
  });

  it("answers 503 when the store fails and broadcasts nothing", async () => {
    redisFake.set.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await post({ status: "online" });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("Presence store unavailable");
    expect(emit).not.toHaveBeenCalled();
  });

  it("answers 503 when no store is configured", async () => {
    const res = await post({ status: "online" }, buildApp({ redis: null }));
    expect(res.status).toBe(503);
  });

  it("still answers 204 without a Socket.io server", async () => {
    const res = await post({ status: "online" }, buildApp({ io: null }));
    expect(res.status).toBe(204);
    expect(redisFake.set).toHaveBeenCalledTimes(1);
  });
});
