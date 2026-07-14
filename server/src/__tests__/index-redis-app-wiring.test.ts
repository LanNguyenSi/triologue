/**
 * Regression test for agent-tasks be5580dd: routes/batch.ts's GET
 * /me/dashboard reads `req.app.get('redis')` to look up the "online_users"
 * Redis set, but nothing ever called `app.set('redis', ...)`. The lookup
 * therefore always resolved to `undefined`, and the route's `if (redis)`
 * guard silently short-circuited to `[]` — the dashboard reported everyone
 * offline regardless of actual presence.
 *
 * Decision (recorded per orchestrator guidance on be5580dd): WIRE IT UP,
 * reusing the existing shared client from index.ts rather than creating a
 * new one. That client already has an `.on('error', ...)` listener since
 * commit 7a2060e (see index-redis-error-listener.test.ts), so wiring it in
 * does not reintroduce the crash-on-error gap fixed there. Semantics line
 * up: socketService.ts's sAdd/sRem write user ids into the SAME
 * "online_users" Redis set (see services/socketService.ts) that
 * batch.ts's sMembers('online_users') reads and rooms.ts's
 * smIsMember('online_users', ...) checks — one shared key, one shared
 * client, consistent reader/writer contract.
 *
 * This test pins the wiring itself: `app.get('redis')` must return the
 * exact exported client instance (not a lookalike, not a new client).
 * routes/batch.ts's own read-path behavior (using whatever `app.get('redis')`
 * returns) is pinned separately and DB-independently in
 * batch-dashboard-online-users.test.ts, which mocks the app.get('redis')
 * value directly instead of importing the full index.ts app.
 *
 * Mutation-testability: removing index.ts's `app.set("redis", redis);` line
 * makes `app.get('redis')` return `undefined`, failing the `toBe(redis)`
 * assertion. Wiring in a *different* client (e.g. `createClient({...})`
 * instead of the shared `redis` export) also fails `toBe(redis)`, since
 * that assertion checks reference identity, not just truthiness.
 */
import { app, redis } from "../index";

describe("index.ts: app.set('redis', ...) wiring", () => {
  it("exposes the shared redis client (the one with the error listener) via app.get('redis')", () => {
    expect(app.get("redis")).toBe(redis);
  });
});
