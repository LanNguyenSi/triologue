/**
 * Regression tests for agent-tasks 780744fd: rooms.ts must not hang
 * indefinitely on the online-presence Redis path when Redis is unreachable,
 * and must not crash the process when an established presence connection
 * later errors out.
 *
 * Test 1 root cause (confirmed against the real 'redis' package, not a
 * mock, by instrumenting node_modules/@redis/client's connect/reconnect
 * internals): node-redis's default `reconnectStrategy` never gives up, and
 * the socket's internal `isOpen` flag is only ever reset to `false` when a
 * reconnect strategy explicitly gives up. Without that, `isOpen` stays
 * `true` forever after a failed connect, so the subsequent
 * `redis.smIsMember()` call in the route handler does not hit node-redis's
 * fast-fail path (`!socket.isOpen` -> reject) and instead queues on the
 * offline command queue waiting for a reconnect that nothing is driving
 * anymore: it never settles.
 *
 * Fix: rooms.ts's client sets `socket.reconnectStrategy: false`, so on the
 * first failed connect attempt the client's reconnect strategy explicitly
 * gives up, which sets `isOpen = false` before anything else. `smIsMember()`
 * then hits the `!socket.isOpen` fast-fail branch and rejects immediately
 * instead of queuing forever.
 *
 * Test 2 root cause (found during review of this task): node-redis's client
 * is an EventEmitter, and Node's default behavior for an unlistened 'error'
 * event is to throw, which crashes the whole process rather than failing
 * just one request. rooms.ts's client had no `.on('error', ...)` listener,
 * so any post-connect error (Redis restarts, connection reset) after an
 * established presence connection would crash the server. Fix: rooms.ts's
 * client now registers a listener that logs via the existing `logger.warn`
 * convention instead of leaving the event unlistened.
 *
 * Both tests drive the real 'redis' package (not mocked) exported by
 * rooms.ts, so they reproduce the actual mechanisms rather than asserting
 * against a mock's behavior.
 *
 * GET /:roomId only reaches this Redis path when the room has participants,
 * which requires Postgres-backed fixtures (see the DB-gated
 * rooms-project-openTasks.test.ts, which mocks 'redis' entirely to sidestep
 * this exact issue). Testing the redis client mechanism directly here keeps
 * this regression coverage DB-independent, deterministic, and fast, and it
 * runs unconditionally (no RUN_DB_TESTS gate needed).
 *
 * Mutation-testability: reverting rooms.ts's `reconnectStrategy: false`
 * makes test 1's second assertion fail: `smIsMember()` no longer rejects,
 * it hangs, and `settleWithin` throws its own "did not settle" error
 * instead of observing a real rejection from the redis client. The sentinel
 * wrapping in `settleWithin` is what makes that distinction possible: a
 * naive `Promise.race` against a timeout would pass either way, because
 * both a fast real rejection and a synthetic timeout rejection satisfy
 * `.rejects.toBeDefined()`. Reverting rooms.ts's `redis.on('error', ...)`
 * listener makes test 2 fail: `listenerCount('error')` drops to 0 and the
 * `emit('error', ...)` call throws.
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

  it('has an error listener so a post-connect client error does not crash the process', () => {
    // Separate regression, found during review of this task: node-redis's
    // client is an EventEmitter, and Node's default behavior for an
    // unlistened 'error' event is to throw. Without a listener, that throw
    // is an uncaughtException that crashes the whole server process, not
    // just this request, whenever an already-established presence
    // connection later drops (Redis restart, connection reset). This is
    // distinct from the offline-queue hang above, which is about the
    // *initial* failed connect; this is about *any* connect, succeeding or
    // not, ever emitting an unlistened error afterward.
    //
    // A full end-to-end repro would open a real TCP connection, complete
    // node-redis's RESP handshake to reach a "ready" state, then drop the
    // raw socket to exercise node-redis's internal socket-error relay
    // end-to-end (this is how the reviewer verified it empirically, with an
    // in-process TCP server that accepts a connection and then destroys
    // it). That is disproportionate infra to add here for what is a
    // one-line `.on('error', ...)` listener fix; instead this asserts the
    // listener contract directly on the real (not mocked) exported client:
    // an 'error' listener is registered, and emitting 'error' on the client
    // is handled rather than throwing, which is exactly what would
    // otherwise crash the process.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const roomsModule = require('../routes/rooms');
    const redis = roomsModule._redisForTesting;

    expect(redis.listenerCount('error')).toBeGreaterThan(0);
    expect(() => redis.emit('error', new Error('simulated post-connect redis error'))).not.toThrow();
  });
});
