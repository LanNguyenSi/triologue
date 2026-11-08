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
 *   - dropping the `root.roomId !== roomId` comparison (foreign root), the
 *     isDeleted refusal or the top-level (threadId) refusal on the root
 *   - writing the root message (the thread must only point at it)
 *   - mapping the unique-violation of a second thread on one root to a 500
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
  createdBy: string | null;
  rootMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
  isResolved: boolean;
  messageCount: number;
  lastActivity: Date;
};
type MessageRow = { id: string; roomId: string; threadId: string | null; isDeleted: boolean };

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
        // The unique index on rootMessageId: one message roots one thread.
        if (data.rootMessageId && threads.some((t) => t.rootMessageId === data.rootMessageId)) {
          const { Prisma } = jest.requireActual("@prisma/client");
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        threadSeq += 1;
        clock += 1000;
        const row: ThreadRow = {
          id: `thread-${String(threadSeq).padStart(3, "0")}`,
          title: data.title!,
          roomId: data.roomId,
          createdBy: data.createdBy ?? null,
          rootMessageId: data.rootMessageId ?? null,
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
    },
  };
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
import { logger } from "../utils/logger";

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

function seedThread(over: Partial<ThreadRow> & { roomId: string }): ThreadRow {
  threadSeq += 1;
  clock += 1000;
  const row: ThreadRow = {
    id: `thread-${String(threadSeq).padStart(3, "0")}`,
    title: "seeded",
    rootMessageId: null,
    createdBy: null,
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

  it("a rootMessageId of a top-level message of the room is stored on the thread and the message is left alone", async () => {
    messages.push({ id: "msg-root", roomId: ROOM, threadId: null, isDeleted: false });

    const res = await create("member", { title: "About that", rootMessageId: "  msg-root  " });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ rootMessageId: "msg-root", messageCount: 0, createdBy: USERS.member.id });
    expect(messages).toEqual([{ id: "msg-root", roomId: ROOM, threadId: null, isDeleted: false }]);
    expect(emit).toHaveBeenCalledWith("thread:created", expect.objectContaining({ rootMessageId: "msg-root" }));
  });

  it("a thread without a root answers rootMessageId null", async () => {
    const res = await create("member", { title: "No root" });

    expect(res.status).toBe(201);
    expect(res.body.rootMessageId).toBeNull();
  });

  it("a rootMessageId of another room is 400 and nothing is written", async () => {
    messages.push({ id: "msg-foreign", roomId: OTHER_ROOM, threadId: null, isDeleted: false });

    const res = await create("member", { title: "Wrong room", rootMessageId: "msg-foreign" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("rootMessageId must name a message in this room");
    expect(threads).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("an unknown rootMessageId is 400 and nothing is written", async () => {
    const res = await create("member", { title: "Ghost", rootMessageId: "msg-nope" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("rootMessageId must name a message in this room");
    expect(threads).toHaveLength(0);
  });

  it("a rootMessageId that is a reply inside a thread is 400 and stays where it is", async () => {
    messages.push({ id: "msg-reply", roomId: ROOM, threadId: "thread-existing", isDeleted: false });

    const res = await create("member", { title: "Reply as root", rootMessageId: "msg-reply" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("rootMessageId must be a top-level message, not a reply in a thread");
    expect(threads).toHaveLength(0);
    expect(messages[0].threadId).toBe("thread-existing");
  });

  it("a soft-deleted rootMessageId is 400 and nothing is written", async () => {
    messages.push({ id: "msg-deleted", roomId: ROOM, threadId: null, isDeleted: true });

    const res = await create("member", { title: "Deleted root", rootMessageId: "msg-deleted" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("rootMessageId names a deleted message");
    expect(threads).toHaveLength(0);
  });

  it("a second thread on a root that already roots one is 400 and the first thread stays the only one", async () => {
    messages.push({ id: "msg-once", roomId: ROOM, threadId: null, isDeleted: false });
    const first = await create("member", { title: "First", rootMessageId: "msg-once" });
    expect(first.status).toBe(201);
    emit.mockClear();

    const second = await create("creator", { title: "Second", rootMessageId: "msg-once" });

    expect(second.status).toBe(400);
    expect(second.body.error).toBe("rootMessageId is no longer available");
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe(first.body.id);
    expect(emit).not.toHaveBeenCalled();
  });

  it("a root claimed between the check and the insert ends in the unique violation: 400, no second thread, no event", async () => {
    // The pre-check sees a free root; by the time the insert runs, another
    // request's thread has taken it.
    messages.push({ id: "msg-race", roomId: ROOM, threadId: null, isDeleted: false });
    const prisma = (await import("../lib/prisma")).default as unknown as {
      message: { findUnique: jest.Mock };
    };
    prisma.message.findUnique.mockImplementationOnce(async () => {
      seedThread({ roomId: ROOM, createdBy: USERS.creator.id, rootMessageId: "msg-race" });
      return { id: "msg-race", roomId: ROOM, threadId: null, isDeleted: false };
    });

    const res = await create("member", { title: "Race", rootMessageId: "msg-race" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("rootMessageId is no longer available");
    expect(threads).toHaveLength(1);
    expect(threads[0].createdBy).toBe(USERS.creator.id);
    expect(emit).not.toHaveBeenCalled();
  });

  it("an insert failure that is not the unique violation stays a 500", async () => {
    const prisma = (await import("../lib/prisma")).default as unknown as {
      thread: { create: jest.Mock };
    };
    prisma.thread.create.mockRejectedValueOnce(new Error("connection lost"));
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => logger);
    messages.push({ id: "msg-500", roomId: ROOM, threadId: null, isDeleted: false });

    const res = await create("member", { title: "Boom", rootMessageId: "msg-500" });
    errorSpy.mockRestore();

    expect(res.status).toBe(500);
  });

  it.each([
    ["a number", 12],
    ["blank", "   "],
    ["with a NUL character", "msg\u0000root"],
  ])("a rootMessageId that is %s is 400 before any message lookup and nothing is written", async (_label, rootMessageId) => {
    const prisma = (await import("../lib/prisma")).default as unknown as {
      message: { findUnique: jest.Mock };
    };
    prisma.message.findUnique.mockClear();

    const res = await create("member", { title: "Bad root", rootMessageId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("rootMessageId must be a non-empty well-formed string without NUL when present");
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
    expect(threads).toHaveLength(0);
  });

  it("a lone surrogate in the title is 400, a well-formed surrogate pair is stored", async () => {
    const bad = await create("member", { title: "x\ud800y" });
    const badLow = await create("member", { title: "x\udc00y" });
    expect(bad.status).toBe(400);
    expect(badLow.status).toBe(400);
    expect(threads).toHaveLength(0);

    const pair = await create("member", { title: "launch \ud83d\ude80" });
    expect(pair.status).toBe(201);
    expect(pair.body.title).toBe("launch \ud83d\ude80");
  });

  it("a lone surrogate in rootMessageId is 400 before any message lookup", async () => {
    const prisma = (await import("../lib/prisma")).default as unknown as {
      message: { findUnique: jest.Mock };
    };
    prisma.message.findUnique.mockClear();

    const res = await create("member", { title: "ok", rootMessageId: "msg\ud800" });

    expect(res.status).toBe(400);
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
    expect(threads).toHaveLength(0);
  });

  it("a NUL character in the title is 400 and nothing is written", async () => {
    const res = await create("member", { title: "bad\u0000title" });

    expect(res.status).toBe(400);
    expect(threads).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("a null rootMessageId is the same as none", async () => {
    const res = await create("member", { title: "No root", rootMessageId: null });

    expect(res.status).toBe(201);
    expect(res.body.rootMessageId).toBeNull();
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

  it("pages with limit and before, newest first, with no gaps when nothing changes between the requests", async () => {
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

  it("caps limit at 100", async () => {
    for (let i = 0; i < 120; i += 1) seedThread({ roomId: ROOM, createdBy: USERS.member.id });

    const res = await list("member", "?limit=1000");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(100);
  });

  it("returns rootMessageId and a null createdBy as they are stored", async () => {
    seedThread({ roomId: ROOM, createdBy: null, rootMessageId: "msg-x", title: "orphan" });

    const res = await list("member");

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ createdBy: null, rootMessageId: "msg-x" });
  });

  it("a cursor thread that got a reply moves to the front and the next page can repeat threads, which clients dedupe by id", async () => {
    const a = seedThread({ roomId: ROOM, createdBy: USERS.member.id, title: "a" });
    seedThread({ roomId: ROOM, createdBy: USERS.member.id, title: "b" });
    seedThread({ roomId: ROOM, createdBy: USERS.member.id, title: "c" });

    const page1 = await list("member", "?limit=2");
    expect(page1.body.map((t: ThreadRow) => t.title)).toEqual(["c", "b"]);
    // A reply lands on the cursor thread between the two requests.
    threads.find((t) => t.title === "b")!.lastActivity = new Date(a.lastActivity.getTime() + 60_000);
    const page2 = await list("member", `?limit=2&before=${page1.body[1].id}`);

    expect(page2.body.map((t: ThreadRow) => t.title)).toEqual(["c", "a"]);
    const seen = new Map<string, ThreadRow>();
    [...page1.body, ...page2.body].forEach((t: ThreadRow) => seen.set(t.id, t));
    expect([...seen.values()].map((t) => t.title).sort()).toEqual(["a", "b", "c"]);
  });

  it("a before cursor with a NUL character is 400 and no thread is looked up", async () => {
    const prisma = (await import("../lib/prisma")).default as unknown as {
      thread: { findFirst: jest.Mock };
    };
    prisma.thread.findFirst.mockClear();

    const res = await list("member", `?before=${encodeURIComponent("bad\u0000cursor")}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("before must be a thread id");
    expect(prisma.thread.findFirst).not.toHaveBeenCalled();
  });

  it.each([["0"], ["-3"], ["abc"], [""]])("limit=%s falls back to the default page size", async (limit) => {
    for (let i = 0; i < 3; i += 1) seedThread({ roomId: ROOM, createdBy: USERS.member.id });

    const res = await list("member", `?limit=${limit}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
  });
});

const getOne = (who: keyof typeof USERS | "agent", threadId: string, roomId = ROOM) =>
  request(buildApp())
    .get(`/api/rooms/${roomId}/threads/${threadId}`)
    .set("Authorization", bearer(who));

describe("GET /api/rooms/:roomId/threads/:threadId", () => {
  it("a member reads a thread of the room by id", async () => {
    const t = seedThread({ roomId: ROOM, createdBy: USERS.creator.id, title: "found" });

    const res = await getOne("member", t.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.id, title: "found", roomId: ROOM });
  });

  it("works for a byoa agent that is a member", async () => {
    const t = seedThread({ roomId: ROOM });
    expect((await getOne("agent", t.id)).status).toBe(200);
  });

  it("a non-member is 403, and an unknown thread gives the same answer", async () => {
    const t = seedThread({ roomId: ROOM });

    const known = await getOne("outsider", t.id);
    const unknown = await getOne("outsider", "nope");

    expect(known.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(known.body).toEqual(unknown.body);
  });

  it("an unknown thread is 404 for a member", async () => {
    expect((await getOne("member", "nope")).status).toBe(404);
  });

  it("a thread of another room is 404 through this room's path", async () => {
    const t = seedThread({ roomId: OTHER_ROOM });
    expect((await getOne("member", t.id)).status).toBe(404);
  });

  it("a thread id with a NUL character is 404 and nothing is looked up", async () => {
    const prisma = (await import("../lib/prisma")).default as unknown as {
      thread: { findFirst: jest.Mock };
    };
    prisma.thread.findFirst.mockClear();

    const res = await getOne("member", "thread%00x");

    expect(res.status).toBe(404);
    expect(prisma.thread.findFirst).not.toHaveBeenCalled();
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

  it.each([
    ["a plain member", "member", 403],
    ["the room owner", "owner", 200],
    ["a room admin", "admin", 200],
    ["a system admin", "sysadmin", 200],
  ] as const)("a thread whose creator deleted their account (null creator): %s gets %i", async (_label, who, status) => {
    const t = seedThread({ roomId: ROOM, createdBy: null });

    const res = await resolve(who, t.id, { isResolved: true });

    expect(res.status).toBe(status);
    expect(threads[0].isResolved).toBe(status === 200);
  });

  it("a thread id with a NUL character is 404 and nothing is looked up", async () => {
    const prisma = (await import("../lib/prisma")).default as unknown as {
      thread: { findFirst: jest.Mock };
    };
    prisma.thread.findFirst.mockClear();

    const res = await resolve("creator", "thread%00x", { isResolved: true });

    expect(res.status).toBe(404);
    expect(prisma.thread.findFirst).not.toHaveBeenCalled();
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
