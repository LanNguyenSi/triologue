/**
 * POST /api/agents with an optional `roomId`: joining a room is an invite.
 *
 * The full app boots redis, sentry, sockets and plugins, so this suite mounts
 * `agentRoutes` on a throwaway express app and mocks the module boundaries the
 * route touches: `../lib/prisma` and the session `authenticate` middleware,
 * which here installs whichever caller the test chose.
 *
 * The route lets a creator add the new agent to a room only as an OWNER or
 * ADMIN of that room (the standing `POST /api/rooms/:roomId/invite` asks for),
 * or as a system admin. The decision happens before anything is written.
 *
 * Mutation guards:
 *   - dropping the OWNER/ADMIN role comparison (any participant passes) makes
 *     "MEMBER" fail
 *   - dropping the participant lookup result check (no row passes) makes
 *     "not a participant" and "nonexistent room" fail
 *   - dropping the `isAdmin` bypass makes "system admin, not a participant" fail
 *   - moving the check after the user create makes the "nothing written"
 *     assertions fail
 */

type Caller = { id: string; isAdmin: boolean; canTriggerAI: boolean };
let caller: Caller;
// `${userId}:${roomId}` -> role of the CREATOR's own participation
let participation = new Map<string, string>();
let rooms = new Set<string>();
const writes: string[] = [];

jest.mock("../lib/prisma", () => {
  const prismaMock: Record<string, unknown> = {
    agentToken: {
      findUnique: jest.fn(async () => null),
    },
    roomParticipant: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { userId_roomId: { userId: string; roomId: string } };
        }) => {
          const { userId, roomId } = where.userId_roomId;
          const role = participation.get(`${userId}:${roomId}`);
          return role ? { userId, roomId, role } : null;
        },
      ),
    },
  };
  const tx = {
    user: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        writes.push("user.create");
        return { id: "agent-user-1", ...data };
      }),
    },
    agentToken: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        writes.push("agentToken.create");
        return { id: "agent-token-1", ...data };
      }),
    },
    room: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        rooms.has(where.id) ? { id: where.id } : null,
      ),
    },
    roomParticipant: {
      // Reads inside the transaction see the same rows as the plain client.
      findUnique: (prismaMock.roomParticipant as { findUnique: unknown }).findUnique,
      upsert: jest.fn(
        async ({
          where,
        }: {
          where: { userId_roomId: { userId: string; roomId: string } };
        }) => {
          writes.push(`roomParticipant.upsert:${where.userId_roomId.roomId}`);
          return {};
        },
      ),
    },
  };
  prismaMock.$transaction = jest.fn(async (fn: (t: unknown) => unknown) => fn(tx));
  return { __esModule: true, default: prismaMock };
});

jest.mock("../services/auditService", () => ({
  logAuditEvent: jest.fn(),
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
  authenticate: (
    req: { user?: Caller },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = caller;
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from "express";
import request from "./helpers/loopbackRequest";
import { agentRoutes } from "../routes/agents";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentRoutes);
  return app;
}

const ROOM = "room-a";
const FORBIDDEN = { error: "Only room owners/admins can invite users" };

const create = (body: Record<string, unknown> = {}) =>
  request(buildApp())
    .post("/api/agents")
    .send({ name: "RoomAuthzProbe", ...body });

beforeEach(() => {
  caller = { id: "creator-1", isAdmin: false, canTriggerAI: true };
  participation = new Map();
  rooms = new Set([ROOM]);
  writes.length = 0;
});

describe("POST /api/agents with a roomId", () => {
  it("OWNER of the room: 201 and the agent is added to the room", async () => {
    participation.set(`creator-1:${ROOM}`, "OWNER");

    const res = await create({ roomId: ROOM });

    expect(res.status).toBe(201);
    expect(writes).toContain(`roomParticipant.upsert:${ROOM}`);
    expect(writes).toContain("roomParticipant.upsert:registration");
  });

  it("ADMIN of the room: 201 and the agent is added to the room", async () => {
    participation.set(`creator-1:${ROOM}`, "ADMIN");

    const res = await create({ roomId: ROOM });

    expect(res.status).toBe(201);
    expect(writes).toContain(`roomParticipant.upsert:${ROOM}`);
  });

  it("MEMBER of the room: 403 with the invite route's body and nothing written", async () => {
    participation.set(`creator-1:${ROOM}`, "MEMBER");

    const res = await create({ roomId: ROOM });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(writes).toEqual([]);
  });

  it("not a participant: 403 and neither user nor agent token is created", async () => {
    const res = await create({ roomId: ROOM });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(writes).toEqual([]);
  });

  it("nonexistent room, not an admin: the same 403 (no room-existence oracle)", async () => {
    const res = await create({ roomId: "no-such-room" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(writes).toEqual([]);
  });

  it("system admin who is not a participant: 201 and the agent is added", async () => {
    caller = { ...caller, isAdmin: true };

    const res = await create({ roomId: ROOM });

    expect(res.status).toBe(201);
    expect(writes).toContain(`roomParticipant.upsert:${ROOM}`);
  });

  it("system admin, nonexistent room: 201 with only the registration room", async () => {
    caller = { ...caller, isAdmin: true };

    const res = await create({ roomId: "no-such-room" });

    expect(res.status).toBe(201);
    expect(writes).toEqual([
      "user.create",
      "agentToken.create",
      "roomParticipant.upsert:registration",
    ]);
  });

  it("system admin who is only a MEMBER of the room: 201 (the admin flag wins over the room role)", async () => {
    caller = { ...caller, isAdmin: true };
    participation.set(`creator-1:${ROOM}`, "MEMBER");

    const res = await create({ roomId: ROOM });

    expect(res.status).toBe(201);
    expect(writes).toContain(`roomParticipant.upsert:${ROOM}`);
  });

  it("the refusal does not depend on canTriggerAI (untrusted MEMBER is 403 as well)", async () => {
    caller = { ...caller, canTriggerAI: false };
    participation.set(`creator-1:${ROOM}`, "MEMBER");

    const res = await create({ roomId: ROOM });

    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
  });

  it("an OWNER of another room only is refused for this room", async () => {
    participation.set("creator-1:room-b", "OWNER");

    const res = await create({ roomId: ROOM });

    expect(res.status).toBe(403);
    expect(writes).toEqual([]);
  });
});

describe("POST /api/agents without a room decision", () => {
  it("no roomId: 201, only the registration room", async () => {
    const res = await create();

    expect(res.status).toBe(201);
    expect(writes).toEqual([
      "user.create",
      "agentToken.create",
      "roomParticipant.upsert:registration",
    ]);
  });

  it('roomId "registration": 201, only the registration room', async () => {
    const res = await create({ roomId: "registration" });

    expect(res.status).toBe(201);
    expect(writes).toEqual([
      "user.create",
      "agentToken.create",
      "roomParticipant.upsert:registration",
    ]);
  });

  it("an empty roomId is still the 400 from the shape guard, not the 403", async () => {
    const res = await create({ roomId: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("roomId must be a non-empty string");
    expect(writes).toEqual([]);
  });
});
