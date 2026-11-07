/**
 * /api/rooms/:roomId/threads: create, list and resolve.
 *
 * The router is mounted on a throwaway express app and runs behind the real
 * `authenticate` middleware, so a user JWT and a BYOA agent token both go
 * through the same door the app uses. Prisma is an in-memory fake that
 * honours the filters the router sends (room scope, cursor, order, limit);
 * the token lookup behind `byoa_` is mocked at its module boundary.
 *
 * Mutation guards (each makes at least one test below fail):
 *   - dropping the participation check on create, list or resolve
 *   - dropping the `root.roomId !== roomId` comparison (foreign root)
 *   - writing messageCount 0 for a thread with a root message
 *   - widening the resolve rule or dropping one of its four clauses
 *   - reversing or dropping the lastActivity order of the list
 *   - dropping the `roomId` filter in the list, or the cursor
 *   - emitting thread:created twice or not at all
 */

import jwt from "jsonwebtoken";

type ThreadRow = {
  id: string;
  title: string;
  roomId: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  isResolved: boolean;
  messageCount: number;
  lastActivity: Date;
};
type MessageRow = { id: string; roomId: string; threadId: string | null };

let threads: ThreadRow[] = [];
let messages: MessageRow[] = [];
let participants = new Map<string, { userId: string; roomId: string; role: string }>();
let projectStatusByRoom: Record<string, string> = {};
let threadSeq = 0;
let clock = Date.parse("2026-01-01T00:00:00Z");

const USERS: Record<string, { id: string; username: string; isAdmin: boolean }> = {
  owner: { id: "u-owner", username: "owner", isAdmin: false },
  admin: { id: "u-admin", username: "roomadmin", isAdmin: false },
  member: { id: "u-member", username: "member", isAdmin: false },
  creator: { id: "u-creator", username: "creator", isAdmin: false },
  sysadmin: { id: "u-sysadmin", username: "sysadmin", isAdmin: true },
  outsider: { id: "u-outsider", username: "outsider", isAdmin: false },
};
const AGENT = { id: "u-agent", username: "agent_bot", isAdmin: false };
const AGENT_TOKEN = "byoa_threads_router_token";

type Where = {
  id?: string | { lt: string };
  roomId?: string;
  threadId?: string | null;
  OR?: Array<{ lastActivity: Date | { lt: Date }; id?: { lt: string } }>;
};

function matchesCursor(t: ThreadRow, or: NonNullable<Where["OR"]>): boolean {
  return or.some((clause) => {
    const la = clause.lastActivity;
    if (la instanceof Date) {
      return t.lastActivity.getTime() === la.getTime() && t.id < clause.id!.lt;
    }
    return t.lastActivity.getTime() < la.lt.getTime();
  });
}

jest.mock("../lib/prisma", () => {
  const prismaMock: Record<string, unknown> = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const u = Object.values(USERS).find((x) => x.id === where.id);
        return u
          ? { ...u, userType: "HUMAN", displayName: u.username, isActive: true, canTriggerAI: false }
          : null;
      }),
    },
    roomParticipant: {
      findUnique: jest.fn(
        async ({ where }: { where: { userId_roomId: { userId: string; roomId: string } } }) =>
          participants.get(`${where.userId_roomId.userId}:${where.userId_roomId.roomId}`) ?? null,
      ),
    },
    project: {
      findFirst: jest.fn(async ({ where }: { where: { roomId: string } }) =>
        projectStatusByRoom[where.roomId] ? { status: projectStatusByRoom[where.roomId] } : null,
      ),
    },
    thread: {
      create: jest.fn(async ({ data }: { data: Partial<ThreadRow> & { roomId: string } }) => {
        threadSeq += 1;
        clock += 1000;
        const row: ThreadRow = {
          id: `thread-${String(threadSeq).padStart(3, "0")}`,
          title: data.title!,
          roomId: data.roomId,
          createdBy: data.createdBy!,
          createdAt: new Date(clock),
          updatedAt: new Date(clock),
          isResolved: false,
          messageCount: data.messageCount ?? 0,
          lastActivity: new Date(clock),
        };
        threads.push(row);
        return { ...row };
      }),
      findFirst: jest.fn(async ({ where }: { where: { id: string; roomId: string } }) => {
        const t = threads.find((x) => x.id === where.id && x.roomId === where.roomId);
        return t ? { ...t } : null;
      }),
      findMany: jest.fn(
        async ({
          where,
          orderBy,
          take,
        }: {
          where: Where;
          orderBy: Array<Record<string, "asc" | "desc">>;
          take: number;
        }) => {
          let rows = threads.filter((t) => t.roomId === where.roomId);
          if (where.OR) rows = rows.filter((t) => matchesCursor(t, where.OR!));
          expect(orderBy).toEqual([{ lastActivity: "desc" }, { id: "desc" }]);
          rows = [...rows].sort(
            (a, b) =>
              b.lastActivity.getTime() - a.lastActivity.getTime() || (a.id < b.id ? 1 : -1),
          );
          return rows.slice(0, take).map((t) => ({ ...t }));
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<ThreadRow> }) => {
          const t = threads.find((x) => x.id === where.id)!;
          Object.assign(t, data);
          return { ...t };
        },
      ),
    },
    message: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const m = messages.find((x) => x.id === where.id);
        return m ? { ...m } : null;
      }),
      updateMany: jest.fn(
        async ({ where, data }: { where: Where; data: { threadId: string } }) => {
          const hit = messages.filter(
            (m) => m.id === where.id && m.roomId === where.roomId && m.threadId === where.threadId,
          );
          hit.forEach((m) => (m.threadId = data.threadId));
          return { count: hit.length };
        },
      ),
    },
  };
  // Interactive transaction: on a throw the thread and message tables are
  // restored to their state at the start, as a rollback would.
  prismaMock.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => {
    const savedThreads = threads.map((t) => ({ ...t }));
    const savedMessages = messages.map((m) => ({ ...m }));
    try {
      return await fn(prismaMock);
    } catch (err) {
      threads = savedThreads;
      messages = savedMessages;
      throw err;
    }
  });
  return { __esModule: true, default: prismaMock };
});

jest.mock("../services/agentTokenRotation", () => ({
  findAgentTokenByRawToken: jest.fn(async (raw: string) =>
    raw === "byoa_threads_router_token"
      ? {
          id: "token-row-1",
          isActive: true,
          status: "active",
          agentUser: {
            id: "u-agent",
            username: "agent_bot",
            displayName: "Agent Bot",
            userType: "AI_AGENT",
            isActive: true,
            isAdmin: false,
          },
        }
      : null,
  ),
}));

import express from "express";
import request from "./helpers/loopbackRequest";
import { threadRoutes } from "../routes/threads";

const emit = jest.fn();
const to = jest.fn(() => ({ emit }));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.set("io", { to });
  app.use("/api/rooms/:roomId/threads", threadRoutes);
  return app;
}

function bearer(who: keyof typeof USERS | "agent"): string {
  if (who === "agent") return `Bearer ${AGENT_TOKEN}`;
  return `Bearer ${jwt.sign({ userId: USERS[who].id }, process.env.JWT_SECRET!)}`;
}

const ROOM = "room-1";
const OTHER_ROOM = "room-2";

function join(userId: string, roomId: string, role = "MEMBER") {
  participants.set(`${userId}:${roomId}`, { userId, roomId, role });
}

function seedThread(over: Partial<ThreadRow> & { roomId: string; createdBy: string }): ThreadRow {
  threadSeq += 1;
  clock += 1000;
  const row: ThreadRow = {
    id: `thread-${String(threadSeq).padStart(3, "0")}`,
    title: "seeded",
    createdAt: new Date(clock),
    updatedAt: new Date(clock),
    isResolved: false,
    messageCount: 0,
    lastActivity: new Date(clock),
    ...over,
  };
  threads.push(row);
  return row;
}

beforeEach(() => {
  threads = [];
  messages = [];
  participants = new Map();
  projectStatusByRoom = {};
  threadSeq = 0;
  emit.mockClear();
  to.mockClear();
  join(USERS.owner.id, ROOM, "OWNER");
  join(USERS.admin.id, ROOM, "ADMIN");
  join(USERS.member.id, ROOM);
  join(USERS.creator.id, ROOM);
  join(USERS.sysadmin.id, ROOM);
  join(AGENT.id, ROOM);
  join(USERS.member.id, OTHER_ROOM);
});

const create = (who: keyof typeof USERS | "agent", body: unknown, roomId = ROOM) =>
  request(buildApp())
    .post(`/api/rooms/${roomId}/threads`)
    .set("Authorization", bearer(who))
    .send(body as object);

describe("POST /api/rooms/:roomId/threads", () => {
  it("a member creates a thread, gets the row back and the room hears thread:created once", async () => {
    const res = await create("member", { title: "  Release plan  " });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "Release plan",
      roomId: ROOM,
      createdBy: USERS.member.id,
      isResolved: false,
      messageCount: 0,
    });
    expect(threads).toHaveLength(1);
    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith(ROOM);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("thread:created", expect.objectContaining({ id: res.body.id, roomId: ROOM }));
  });

  it("a byoa agent that is a member creates a thread", async () => {
    const res = await create("agent", { title: "From the agent" });

    expect(res.status).toBe(201);
    expect(res.body.createdBy).toBe(AGENT.id);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("a non-member is refused with 403 and nothing is written or emitted", async () => {
    const res = await create("outsider", { title: "nope" });

    expect(res.status).toBe(403);
    expect(threads).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("an unknown room answers exactly like a room the caller is not in", async () => {
    const outsider = await create("outsider", { title: "nope" });
    const unknown = await create("member", { title: "nope" }, "room-does-not-exist");

    expect(unknown.status).toBe(outsider.status);
    expect(unknown.body).toEqual(outsider.body);
  });

  it("a non-member agent token is refused too", async () => {
    participants.delete(`${AGENT.id}:${ROOM}`);

    const res = await create("agent", { title: "nope" });

    expect(res.status).toBe(403);
    expect(threads).toHaveLength(0);
  });

  it("a request without credentials is 401", async () => {
    const res = await request(buildApp()).post(`/api/rooms/${ROOM}/threads`).send({ title: "x" });
    expect(res.status).toBe(401);
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["a number", 7],
    ["longer than 200 characters", "x".repeat(201)],
  ])("title %s is 400 and nothing is written", async (_label, title) => {
    const res = await create("member", { title });

    expect(res.status).toBe(400);
    expect(threads).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("a rootMessageId of a message in the room becomes the thread's first message", async () => {
    messages.push({ id: "msg-root", roomId: ROOM, threadId: null });

    const res = await create("member", { title: "About that", rootMessageId: "msg-root" });

    expect(res.status).toBe(201);
    expect(res.body.messageCount).toBe(1);
    expect(messages[0].threadId).toBe(res.body.id);
  });

  it("a rootMessageId of another room is 400 and nothing is written", async () => {
    messages.push({ id: "msg-foreign", roomId: OTHER_ROOM, threadId: null });

    const res = await create("member", { title: "Wrong room", rootMessageId: "msg-foreign" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("rootMessageId must name a message in this room");
    expect(threads).toHaveLength(0);
    expect(messages[0].threadId).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });

  it("an unknown rootMessageId is 400 and nothing is written", async () => {
    const res = await create("member", { title: "Ghost", rootMessageId: "msg-nope" });

    expect(res.status).toBe(400);
    expect(threads).toHaveLength(0);
  });

  it("a rootMessageId that is already in a thread is 400 and stays where it is", async () => {
    messages.push({ id: "msg-reply", roomId: ROOM, threadId: "thread-existing" });

    const res = await create("member", { title: "Steal", rootMessageId: "msg-reply" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("rootMessageId is already part of a thread");
    expect(threads).toHaveLength(0);
    expect(messages[0].threadId).toBe("thread-existing");
  });

  it("a root claimed between the check and the link rolls the new thread back", async () => {
    // The pre-check sees a free root; by the time the transaction links it,
    // another thread has taken it.
    messages.push({ id: "msg-race", roomId: ROOM, threadId: null });
    const prisma = (await import("../lib/prisma")).default as unknown as {
      message: { findUnique: jest.Mock };
    };
    prisma.message.findUnique.mockImplementationOnce(async () => {
      const seen = { id: "msg-race", roomId: ROOM, threadId: null };
      messages[0].threadId = "thread-other";
      return seen;
    });

    const res = await create("member", { title: "Race", rootMessageId: "msg-race" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("rootMessageId is no longer available");
    expect(threads).toHaveLength(0);
    expect(messages[0].threadId).toBe("thread-other");
    expect(emit).not.toHaveBeenCalled();
  });

  it("a non-string rootMessageId is 400", async () => {
    const res = await create("member", { title: "Bad root", rootMessageId: 12 });

    expect(res.status).toBe(400);
    expect(threads).toHaveLength(0);
  });

  it("a null rootMessageId is the same as none", async () => {
    const res = await create("member", { title: "No root", rootMessageId: null });

    expect(res.status).toBe(201);
    expect(res.body.messageCount).toBe(0);
  });

  it("a room whose project is closed refuses new threads", async () => {
    projectStatusByRoom[ROOM] = "closed";

    const res = await create("member", { title: "Late" });

    expect(res.status).toBe(403);
    expect(threads).toHaveLength(0);
  });
});

const list = (who: keyof typeof USERS | "agent", query = "", roomId = ROOM) =>
  request(buildApp())
    .get(`/api/rooms/${roomId}/threads${query}`)
    .set("Authorization", bearer(who));

describe("GET /api/rooms/:roomId/threads", () => {
  it("lists the room's threads with the newest activity first", async () => {
    const oldest = seedThread({ roomId: ROOM, createdBy: USERS.member.id, title: "oldest" });
    const newest = seedThread({ roomId: ROOM, createdBy: USERS.member.id, title: "newest" });
    const middle = seedThread({ roomId: ROOM, createdBy: USERS.member.id, title: "middle" });
    // A reply bumps lastActivity: the oldest thread is now the freshest.
    oldest.lastActivity = new Date(middle.lastActivity.getTime() + 5000);

    const res = await list("member");

    expect(res.status).toBe(200);
    expect(res.body.map((t: ThreadRow) => t.title)).toEqual(["oldest", "middle", "newest"]);
    expect(res.body.map((t: ThreadRow) => t.id)).toEqual([oldest.id, middle.id, newest.id]);
  });

  it("leaves out the threads of other rooms", async () => {
    seedThread({ roomId: ROOM, createdBy: USERS.member.id, title: "mine" });
    seedThread({ roomId: OTHER_ROOM, createdBy: USERS.member.id, title: "theirs" });

    const res = await list("member");

    expect(res.body.map((t: ThreadRow) => t.title)).toEqual(["mine"]);
  });

  it("works for a byoa agent that is a member", async () => {
    seedThread({ roomId: ROOM, createdBy: USERS.member.id, title: "visible" });

    const res = await list("agent");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("a non-member is refused with 403", async () => {
    seedThread({ roomId: ROOM, createdBy: USERS.member.id });

    const res = await list("outsider");

    expect(res.status).toBe(403);
    expect(res.body).not.toBeInstanceOf(Array);
  });

  it("pages with limit and before, newest first, without gaps or repeats", async () => {
    const made = [1, 2, 3, 4, 5].map((n) =>
      seedThread({ roomId: ROOM, createdBy: USERS.member.id, title: `t${n}` }),
    );

    const page1 = await list("member", "?limit=2");
    expect(page1.body.map((t: ThreadRow) => t.title)).toEqual(["t5", "t4"]);

    const page2 = await list("member", `?limit=2&before=${page1.body[1].id}`);
    expect(page2.body.map((t: ThreadRow) => t.title)).toEqual(["t3", "t2"]);

    const page3 = await list("member", `?limit=2&before=${page2.body[1].id}`);
    expect(page3.body.map((t: ThreadRow) => t.title)).toEqual(["t1"]);
    expect(made).toHaveLength(5);
  });

  it("threads with the same lastActivity page by id", async () => {
    const a = seedThread({ roomId: ROOM, createdBy: USERS.member.id, title: "a" });
    const b = seedThread({ roomId: ROOM, createdBy: USERS.member.id, title: "b" });
    b.lastActivity = a.lastActivity;

    const page1 = await list("member", "?limit=1");
    expect(page1.body.map((t: ThreadRow) => t.title)).toEqual(["b"]);
    const page2 = await list("member", `?limit=1&before=${page1.body[0].id}`);
    expect(page2.body.map((t: ThreadRow) => t.title)).toEqual(["a"]);
  });

  it("a before cursor from another room is 400", async () => {
    const foreign = seedThread({ roomId: OTHER_ROOM, createdBy: USERS.member.id });

    const res = await list("member", `?before=${foreign.id}`);

    expect(res.status).toBe(400);
  });

  it.each([["0"], ["-3"], ["abc"], [""]])("limit=%s falls back to the default page size", async (limit) => {
    for (let i = 0; i < 3; i += 1) seedThread({ roomId: ROOM, createdBy: USERS.member.id });

    const res = await list("member", `?limit=${limit}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });
});

const resolve = (who: keyof typeof USERS | "agent", threadId: string, body: unknown, roomId = ROOM) =>
  request(buildApp())
    .patch(`/api/rooms/${roomId}/threads/${threadId}`)
    .set("Authorization", bearer(who))
    .send(body as object);

describe("PATCH /api/rooms/:roomId/threads/:threadId", () => {
  it.each([
    ["the creator", "creator"],
    ["a room admin", "admin"],
    ["the room owner", "owner"],
    ["a system admin who is a member", "sysadmin"],
  ] as const)("%s can resolve a thread", async (_label, who) => {
    const t = seedThread({ roomId: ROOM, createdBy: USERS.creator.id });

    const res = await resolve(who, t.id, { isResolved: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.id, isResolved: true });
    expect(threads[0].isResolved).toBe(true);
  });

  it("the byoa agent that created the thread can resolve it", async () => {
    const t = seedThread({ roomId: ROOM, createdBy: AGENT.id });

    const res = await resolve("agent", t.id, { isResolved: true });

    expect(res.status).toBe(200);
    expect(threads[0].isResolved).toBe(true);
  });

  it("a plain member who did not create the thread is refused and nothing changes", async () => {
    const t = seedThread({ roomId: ROOM, createdBy: USERS.creator.id });

    const res = await resolve("member", t.id, { isResolved: true });

    expect(res.status).toBe(403);
    expect(threads[0].isResolved).toBe(false);
  });

  it("a plain member agent that did not create the thread is refused", async () => {
    const t = seedThread({ roomId: ROOM, createdBy: USERS.creator.id });

    const res = await resolve("agent", t.id, { isResolved: true });

    expect(res.status).toBe(403);
    expect(threads[0].isResolved).toBe(false);
  });

  it("reopens a resolved thread", async () => {
    const t = seedThread({ roomId: ROOM, createdBy: USERS.creator.id, isResolved: true });

    const res = await resolve("creator", t.id, { isResolved: false });

    expect(res.status).toBe(200);
    expect(threads[0].isResolved).toBe(false);
  });

  it("a non-member is refused with 403 even for an existing thread, and an unknown thread gives the same answer", async () => {
    const t = seedThread({ roomId: ROOM, createdBy: USERS.creator.id });

    const existing = await resolve("outsider", t.id, { isResolved: true });
    const unknown = await resolve("outsider", "thread-nope", { isResolved: true });

    expect(existing.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(unknown.body).toEqual(existing.body);
    expect(threads[0].isResolved).toBe(false);
  });

  it("an unknown thread is 404 for a member", async () => {
    const res = await resolve("creator", "thread-nope", { isResolved: true });
    expect(res.status).toBe(404);
  });

  it("a thread of another room is 404 through this room's path, even for a room admin", async () => {
    const t = seedThread({ roomId: OTHER_ROOM, createdBy: USERS.member.id });

    const res = await resolve("admin", t.id, { isResolved: true });

    expect(res.status).toBe(404);
    expect(threads[0].isResolved).toBe(false);
  });

  it.each([
    ["missing", {}],
    ["a string", { isResolved: "true" }],
    ["a number", { isResolved: 1 }],
  ])("isResolved %s is 400", async (_label, body) => {
    const t = seedThread({ roomId: ROOM, createdBy: USERS.creator.id });

    const res = await resolve("creator", t.id, body);

    expect(res.status).toBe(400);
    expect(threads[0].isResolved).toBe(false);
  });

  it("a room whose project is closed refuses the change", async () => {
    const t = seedThread({ roomId: ROOM, createdBy: USERS.creator.id });
    projectStatusByRoom[ROOM] = "closed";

    const res = await resolve("creator", t.id, { isResolved: true });

    expect(res.status).toBe(403);
    expect(threads[0].isResolved).toBe(false);
  });
});
