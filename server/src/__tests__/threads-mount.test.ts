/**
 * The thread routes are mounted on the real app.
 *
 * threads-router.test.ts mounts the router on a throwaway express app, so it
 * cannot tell whether `src/index.ts` mounts it at all. This suite goes through
 * the app that index.ts exports. Without credentials the shared `authenticate`
 * middleware answers 401 before any database access, so no database is needed;
 * with the mount gone the paths match no route and the app answers 404.
 *
 * Mutation guard: removing (or replacing with a no-op) the
 * `app.use("/api/rooms/:roomId/threads", threadRoutes)` line in index.ts makes
 * every case here fail with 404.
 */
import request from "./helpers/loopbackRequest";
import { app } from "../index";

describe("thread routes on the real app", () => {
  it.each([
    ["GET", "/api/rooms/room-1/threads"],
    ["POST", "/api/rooms/room-1/threads"],
    ["PATCH", "/api/rooms/room-1/threads/thread-1"],
  ] as const)("%s %s without credentials is 401, not 404", async (method, path) => {
    const req = request(app);
    const res =
      method === "GET" ? await req.get(path) : method === "POST" ? await req.post(path).send({}) : await req.patch(path).send({});

    expect(res.status).toBe(401);
  });
});
