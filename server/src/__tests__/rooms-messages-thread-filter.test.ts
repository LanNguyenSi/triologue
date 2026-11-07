/**
 * GET /api/rooms/:roomId/messages with and without `threadId`.
 *
 * Without the parameter the list is the whole room, thread replies included,
 * oldest first, pinned here so the new filter cannot change it unnoticed.
 * With it, only that thread's messages come back, in the same order; a thread
 * id of another room or an unknown one matches nothing.
 *
 * Mutation guards:
 *   - dropping the `threadId` clause from the where makes the filter tests fail
 *   - applying `threadId: null` when the parameter is absent makes the
 *     "whole room" test fail (the replies would drop out)
 *   - dropping the participation check makes "non-member" fail
 *   - dropping `isDeleted: false` from the filtered where makes the
 *     soft-deleted reply test fail, and adding it to the unfiltered where makes
 *     the "whole room" tests fail (that list is pinned as it was)
 *   - dropping the NUL check on the path segment or on `before` makes that
 *     input reach Prisma, and its test fail
 */

jest.mock("redis", () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    smIsMember: jest.fn().mockResolvedValue([]),
    mGet: jest.fn().mockResolvedValue([]),
    on: jest.fn(),
  })),
}));

jest.mock("../middleware/auth", () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user: unknown }).user = { id: "user-1", username: "alice", isAdmin: false };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock("../services/inboxService", () => ({
  createInboxItems: jest.fn(async () => undefined),
}));

type Row = { id: string; roomId: string; threadId: string | null; createdAt: Date; sender: null; isDeleted: boolean };
let rows: Row[] = [];
let memberRooms = new Set<string>();

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    roomParticipant: {
      findUnique: jest.fn(
        async ({ where }: { where: { userId_roomId: { roomId: string } } }) =>
          memberRooms.has(where.userId_roomId.roomId) ? { userId: "user-1" } : null,
      ),
    },
    message: {
      findMany: jest.fn(
        async ({
          where,
          take,
        }: {
          where: { roomId: string; threadId?: string; isDeleted?: boolean; id?: { lt: string } };
          take: number;
        }) =>
          rows
            .filter((r) => r.roomId === where.roomId)
            .filter((r) => !("threadId" in where) || r.threadId === where.threadId)
            .filter((r) => !("isDeleted" in where) || r.isDeleted === where.isDeleted)
            .filter((r) => !where.id || r.id < where.id.lt)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, take)
            .map((r) => ({ ...r, reactions: [] })),
      ),
    },
  },
}));

import express from "express";
import request from "./helpers/loopbackRequest";
import prisma from "../lib/prisma";
import { roomRoutes } from "../routes/rooms";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/rooms", roomRoutes);
  return app;
}

function row(id: string, roomId: string, threadId: string | null, second: number): Row {
  return { id, roomId, threadId, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, second)), sender: null, isDeleted: false };
}

beforeEach(() => {
  memberRooms = new Set(["room-1"]);
  rows = [
    row("m-01", "room-1", null, 1),
    row("m-02", "room-1", "thread-a", 2),
    row("m-03", "room-1", "thread-b", 3),
    row("m-04", "room-1", "thread-a", 4),
    row("m-05", "room-1", null, 5),
    row("m-06", "room-2", "thread-x", 6),
  ];
  (prisma.message.findMany as jest.Mock).mockClear();
  (prisma.roomParticipant.findUnique as jest.Mock).mockClear();
});

const get = (query = "", roomId = "room-1") => request(buildApp()).get(`/api/rooms/${roomId}/messages${query}`);

describe("GET /api/rooms/:roomId/messages", () => {
  it("without threadId returns the whole room, thread replies included, oldest first", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.map((m: Row) => m.id)).toEqual(["m-01", "m-02", "m-03", "m-04", "m-05"]);
    const where = (prisma.message.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where).toEqual({ roomId: "room-1" });
  });

  it("with threadId returns only that thread's messages, oldest first", async () => {
    const res = await get("?threadId=thread-a");

    expect(res.status).toBe(200);
    expect(res.body.map((m: Row) => m.id)).toEqual(["m-02", "m-04"]);
  });

  it("threadId combines with limit and before like the unfiltered list", async () => {
    rows.push(row("m-07", "room-1", "thread-a", 7), row("m-08", "room-1", "thread-a", 8));

    const newest = await get("?threadId=thread-a&limit=2");
    expect(newest.body.map((m: Row) => m.id)).toEqual(["m-07", "m-08"]);

    const older = await get("?threadId=thread-a&limit=2&before=m-07");
    expect(older.body.map((m: Row) => m.id)).toEqual(["m-02", "m-04"]);
  });

  it("with threadId a soft-deleted reply is left out; without it the room list is unchanged and still has it", async () => {
    rows.find((r) => r.id === "m-04")!.isDeleted = true;

    const filtered = await get("?threadId=thread-a");
    expect(filtered.body.map((m: Row) => m.id)).toEqual(["m-02"]);
    expect((prisma.message.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      roomId: "room-1",
      threadId: "thread-a",
      isDeleted: false,
    });

    const whole = await get();
    expect(whole.body.map((m: Row) => m.id)).toEqual(["m-01", "m-02", "m-03", "m-04", "m-05"]);
    expect((prisma.message.findMany as jest.Mock).mock.calls[1][0].where).toEqual({ roomId: "room-1" });
  });

  it("a thread of another room matches nothing in this room", async () => {
    const res = await get("?threadId=thread-x");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("an unknown thread answers an empty list", async () => {
    const res = await get("?threadId=thread-nope");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("a non-member is refused and no query runs", async () => {
    const res = await get("?threadId=thread-a", "room-2");

    expect(res.status).toBe(403);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ["blank", "?threadId="],
    ["whitespace", "?threadId=%20%20"],
    ["repeated", "?threadId=a&threadId=b"],
    ["with a NUL character", "?threadId=a%00b"],
  ])("a %s threadId is 400 and no query runs", async (_label, query) => {
    const res = await get(query);

    expect(res.status).toBe(400);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  // Postgres refuses a NUL in text, so the two values this route hands to its
  // where clause are refused before any query, whichever room the caller names:
  // the check runs ahead of the membership lookup, so even a member of room-1
  // gets the 400 rather than a 403 or a 500 from Prisma.
  it.each([
    ["the path segment", "room%001", ""],
    ["the before cursor", "room-1", "?before=m-0%002"],
  ])("a NUL character in %s is 400 and no query runs", async (_label, roomId, query) => {
    const res = await get(query, roomId);

    expect(res.status).toBe(400);
    expect(prisma.roomParticipant.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it("a well-formed emoji in before is a normal query, not a refused one", async () => {
    const res = await get("?before=\u{1F600}");

    expect(res.status).toBe(200);
    expect((prisma.message.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      roomId: "room-1",
      id: { lt: "\u{1F600}" },
    });
  });
});
