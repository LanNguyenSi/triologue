/**
 * Regression test for agent-tasks 04f67762: the redis client created in
 * index.ts (shared by socketService and pluginManager) had no
 * `.on('error', ...)` listener.
 *
 * node-redis's client is an EventEmitter, and Node's default behavior for an
 * unlistened 'error' event is to throw, which becomes an uncaughtException
 * and crashes the whole server process rather than failing just one
 * operation. node-redis emits 'error' on the client whenever an established
 * connection drops (Redis restart, failover, ECONNRESET) — this was
 * verified empirically on PR #186 against real redis 4.7.1. The same gap
 * was fixed for routes/rooms.ts's presence client in PR #186 (commit
 * 8ed681f); index.ts was deliberately left out of that PR and is the
 * subject of this fix.
 *
 * This asserts the listener contract directly on the real (not mocked)
 * exported client, mirroring the pattern in
 * __tests__/rooms-redis-offline.test.ts: an 'error' listener is registered,
 * and emitting 'error' on the client is handled rather than throwing, which
 * is exactly what would otherwise crash the process.
 *
 * Mutation-testability: removing index.ts's `redis.on('error', ...)`
 * listener makes `listenerCount('error')` drop to 0 and the
 * `emit('error', ...)` call throw, failing this test.
 */
import { redis } from "../index";

describe("index.ts redis client: has an error listener", () => {
  it("registers an error listener so a post-connect client error does not crash the process", () => {
    expect(redis.listenerCount("error")).toBeGreaterThan(0);
    expect(() =>
      redis.emit("error", new Error("simulated post-connect redis error")),
    ).not.toThrow();
  });
});
