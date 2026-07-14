/**
 * Decision-pinning test for agent-tasks 60efd603: index.ts's shared redis
 * client (used by socketService's presence writes and pluginManager's
 * runtime context) used node-redis's DEFAULT offline command queue, which
 * buffers every command issued while disconnected/reconnecting and replays
 * them all in one burst on reconnect. During a long Redis outage this let
 * socketService's presence writes (sAdd/setEx/sRem — fire-and-forget,
 * best-effort side effects that nothing in the request/response path blocks
 * on) queue unbounded in memory and later apply as a burst of by-then-stale
 * commands against the "online_users" set (phantom presence entries, plus
 * the memory growth itself).
 *
 * Decision (see the comment at the client's construction in index.ts): set
 * `disableOfflineQueue: true`. A command issued while the client isn't
 * "ready" (disconnected, connecting, or mid-reconnect) now rejects
 * immediately with node-redis's `ClientOfflineError` instead of queuing.
 * `reconnectStrategy` is deliberately left at its default (unlike
 * routes/rooms.ts's short-lived per-request client, which additionally sets
 * `reconnectStrategy: false` — see rooms-redis-offline.test.ts): this client
 * is long-lived, so it keeps retrying with backoff in the background and
 * transparently exits the degraded (queue-free, reject-fast) state once
 * Redis is reachable again, without any caller having to reconnect/retry
 * manually.
 *
 * This drives the real (not mocked) exported client, mirroring
 * rooms-redis-offline.test.ts's approach, so it reproduces the actual
 * node-redis mechanism rather than asserting against a mock's behavior. The
 * call sites that now handle this immediate rejection (services/socketService.ts's
 * sAdd/setEx/sRem) are pinned separately in socketService.test.ts.
 *
 * Mutation-testability: removing `disableOfflineQueue: true` from index.ts's
 * createClient() call makes sAdd's promise never settle within the bound
 * below — it queues instead of rejecting — so `settleWithin` throws its "did
 * not settle" hang error and this test fails.
 */

const BOUND_MS = 2000;

type Settled<T> = { settled: true; ok: true; value: T } | { settled: true; ok: false; error: unknown };

// Races `promise` against a timeout, WITHOUT letting the timeout's own
// rejection masquerade as a rejection from `promise`. Identical helper and
// rationale as rooms-redis-offline.test.ts: a naive `Promise.race` against a
// timeout would pass either way (a real fast rejection and a synthetic
// timeout rejection both satisfy `.ok === false`), so the hang guard is kept
// distinguishable via its own sentinel result shape.
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
  return Promise.race([outcome, hangGuard]).finally(() => clearTimeout(timer));
}

describe('index.ts redis client: disableOfflineQueue rejects fast instead of queuing', () => {
  const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

  afterEach(() => {
    if (ORIGINAL_REDIS_URL === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = ORIGINAL_REDIS_URL;
    }
    jest.resetModules();
  });

  it('rejects a command fast while disconnected/reconnecting instead of queuing forever', async () => {
    // Port 1 is a well-known non-listening TCP port on loopback: connecting
    // never succeeds, giving a deterministic "Redis unreachable" state
    // without depending on a real Redis service being up or down.
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    jest.resetModules();
    // Fresh require (not the top-level `import { redis } from "../index"`
    // used by index-redis-error-listener.test.ts and
    // index-redis-app-wiring.test.ts) so the module picks up the REDIS_URL
    // set above when it constructs its module-level client.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const indexModule = require('../index');
    const redis = indexModule.redis;

    // Kick off connect() but do NOT await it to completion: this client's
    // reconnectStrategy is deliberately left at its default
    // (unbounded retry-with-backoff — see the comment in index.ts), so
    // against an always-unreachable port the connect() promise itself never
    // settles.
    void redis.connect().catch(() => {
      // No-op: this test only cares about the sAdd() rejection below, not
      // connect()'s own eventual outcome (which never settles here anyway).
    });

    // The actual regression: before the fix (node-redis's default offline
    // queue enabled), this call queues forever waiting for a reconnect that
    // will never succeed against port 1, and `settleWithin` throws its "did
    // not settle" hang error below. After the fix (disableOfflineQueue: true)
    // it rejects fast with ClientOfflineError instead, because the client is
    // "open" (connect() was called) but not yet "ready".
    const sAddOutcome = await settleWithin(
      redis.sAdd('online_users', 'test-user-id'),
      'redis.sAdd()',
    );
    expect(sAddOutcome.ok).toBe(false);

    await redis.disconnect().catch(() => {
      // Already in a closing/errored state from the failed connect attempt;
      // fine to ignore here, this is just test cleanup.
    });
  });
});
