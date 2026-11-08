/**
 * GET /api/messages/:roomId/search returns `threadId` on each hit: the thread
 * id for a reply, null for a room message. The client needs it to open the
 * thread instead of paging the room list for a reply that is never in it.
 *
 * Mutation guard: dropping `threadId: true` from the select makes both tests
 * fail (the key is absent from every item).
 */

const findMany = jest.fn();
const membership = jest.fn();

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    roomParticipant: { findUnique: (...a: unknown[]) => membership(...a) },
    message: { findMany: (...a: unknown[]) => findMany(...a) },
  },
}));

jest.mock("../middleware/auth", () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: "u1" };
    next();
  },
}));

import express from "express";
import request from "./helpers/loopbackRequest";
import { messageRoutes } from "../routes/messages";

function buildApp() {
  const app = express();
  app.use("/api/messages", messageRoutes);
  return app;
}

const sender = { id: "u1", username: "demo", displayName: "Demo", userType: "HUMAN" };

beforeEach(() => {
  findMany.mockReset();
  membership.mockReset();
  membership.mockResolvedValue({ userId: "u1", roomId: "r1" });
});

describe("GET /api/messages/:roomId/search", () => {
  it("asks for threadId in the select and passes it through: a reply carries its thread, a room message null", async () => {
    findMany.mockResolvedValue([
      { id: "m2", content: "hello reply", createdAt: "2026-11-07T10:00:00.000Z", threadId: "t1", sender },
      { id: "m1", content: "hello root", createdAt: "2026-11-07T09:00:00.000Z", threadId: null, sender },
    ]);

    const res = await request(buildApp()).get("/api/messages/r1/search?q=hello");

    expect(res.status).toBe(200);
    expect(findMany.mock.calls[0][0].select.threadId).toBe(true);
    expect(res.body.items.map((i: { id: string; threadId: string | null }) => [i.id, i.threadId])).toEqual([
      ["m2", "t1"],
      ["m1", null],
    ]);
  });

  it("a non-member is 403 and nothing is searched", async () => {
    membership.mockResolvedValue(null);

    const res = await request(buildApp()).get("/api/messages/r1/search?q=hello");

    expect(res.status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });
});
