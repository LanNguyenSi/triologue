/**
 * Regression test for agent-tasks 780744fd: rooms.ts must not hang
 * indefinitely on the online-presence Redis path when Redis is unreachable.
 *
 * Root cause (confirmed against the real 'redis' package, not a mock, by
 * instrumenting node_modules/@redis/client's connect/reconnect internals):
 * `ensureRedisConnected()`'s `redis.connect()` call does reject reasonably
 * fast even without any fix here (node-redis's client is an EventEmitter and
 * rooms.ts never registers a `.on('error', ...)` listener on it, so the
 * internal reconnect loop's `emit('error', ...)` throws on the very first
 * failed attempt because it has zero listeners, and that exception is what
 * actually ends the loop, not `connectTimeout`. The real bug is in what
 * happens *after*: node-redis's default `reconnectStrategy` never gives up,
 * so the socket's internal `isOpen` flag is only ever reset to `false` when
 * a reconnect strategy explicitly gives up. Without that, `isOpen` stays
 * `true` forever after the failed connect, so the subsequent
 * `redis.smIsMember()` call in the route handler does not hit node-redis's
 * fast-fail path (`!socket.isOpen` -> reject) and instead queues on the
 * offline command queue waiting for a reconnect that nothing is driving
 * anymore: it never settles.
 *
 * Fix: rooms.ts's client now sets `socket.reconnectStrategy: false`, so on
 * the first failed connect attempt the client's reconnect strategy
 * explicitly gives up, which sets `isOpen = false` before anything else.
 * `smIsMember()` then hits the `!socket.isOpen` fast-fail branch and rejects
 * immediately instead of queuing forever.
 *
 * This test drives the real 'redis' package (not mocked) exported by
 * rooms.ts, pointed at a closed local port, so it reproduces the actual
 * queuing mechanism rather than asserting against a mock's behavior.
 *
 * GET /:roomId only reaches this Redis path when the room has participants,
 * which requires Postgres-backed fixtures (see the DB-gated
 * rooms-project-openTasks.test.ts, which mocks 'redis' entirely to sidestep
 * this exact issue). Testing the redis client mechanism directly here keeps
 * this regression coverage DB-independent, deterministic, and fast, and it
 * runs unconditionally (no RUN_DB_TESTS gate needed).
 *
 * Mutation-testability: reverting rooms.ts's `reconnectStrategy: false` back
 * out makes the second assertion below fail: `smIsMember()` no longer
 * rejects, it hangs, and `settleWithin` throws its own "did not settle"
 * error instead of observing a real rejection from the redis client. The
 * sentinel wrapping below is what makes that distinction possible: a naive
 * `Promise.race` against a timeout would pass either way, because both a
 * fast real rejection and a synthetic timeout rejection satisfy
 * `.rejects.toBeDefined()`.
 */

const BOUND_MS = 2000;

type Settled<T> = { settled: true; ok: true; value: T } | { settled: true; ok: false; error: unknown };

// Races `promise` against a timeout, WITHOUT letting the timeout's own
// rejection masquerade as a rejection from `promise`. If the timeout wins,
// this throws a distinct "did not settle" error; only a genuine settlement
// (resolve or reject) of `promise` itself produces a `Settled<T>` result.
function settleWithin<T>(promise: Promise<T>, label: string): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout>;
  const outcome: Promise<Settled<T>> = promise.then(
    value => ({ settled: true, ok: true, value }),
    error => ({ settled: true, ok: false, error }),
  );
  const hangGuard = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not settle within ${BOUND_MS}ms (hang)`)),
      BOUND_MS,
    );
  });
  // Clear the guard timer once either side settles, so a fast real
  // settlement doesn't leave a dangling timer/open handle behind.
  return Promise.race([outcome, hangGuard]).finally(() => clearTimeout(timer));
}

describe('rooms.ts redis client: unreachable Redis does not hang', () => {
  const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

  afterEach(() => {
    if (ORIGINAL_REDIS_URL === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = ORIGINAL_REDIS_URL;
    }
    jest.resetModules();
  });

  it('smIsMember() rejects fast after a failed connect instead of hanging on the offline queue', async () => {
    // Port 1 is a well-known non-listening TCP port on loopback: connecting
    // yields an immediate ECONNREFUSED, giving a fast, deterministic repro
    // of "Redis unreachable" without depending on any real Redis service.
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    jest.resetModules();
    // Fresh require (not a top-level import) so the module picks up the
    // REDIS_URL set above when it constructs its module-level client.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const roomsModule = require('../routes/rooms');
    const redis = roomsModule._redisForTesting;
    const ensureRedisConnected = roomsModule._ensureRedisConnectedForTesting;

    // This settles quickly regardless of the fix (see file-level comment for
    // why); it is exercised here because the route handler always awaits it
    // before smIsMember(), and it must not itself hang either.
    const connectOutcome = await settleWithin(ensureRedisConnected(), 'ensureRedisConnected()');
    expect(connectOutcome.settled).toBe(true);

    // The actual regression: before the fix this call queues forever on the
    // offline command queue and `settleWithin` throws its "did not settle"
    // hang error here instead of returning. After the fix it rejects fast.
    const smIsMemberOutcome = await settleWithin(
      redis.smIsMember('online_users', ['some-user-id']),
      'smIsMember()',
    );
    expect(smIsMemberOutcome.ok).toBe(false);

    await redis.disconnect().catch(() => {
      // Already closed by the failed connect attempt, fine to ignore.
    });
  });
});
