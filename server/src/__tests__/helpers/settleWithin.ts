// Shared hang-guard helper for the redis-offline tests
// (rooms-redis-offline.test.ts, index-redis-offline-queue.test.ts).
//
// Races `promise` against a timeout, WITHOUT letting the timeout's own
// rejection masquerade as a rejection from `promise`. A naive
// `Promise.race` against a timeout would pass either way (a real fast
// rejection and a synthetic timeout rejection both satisfy
// `.ok === false`), so the hang guard stays distinguishable via its own
// sentinel error; only a genuine settlement (resolve or reject) of
// `promise` itself produces a `Settled<T>` result.
//
// Extracted from the two test files' identical copies: both are scripts
// in the same global typecheck scope, so the duplicated top-level
// declarations broke `tsc -p tsconfig.test.json` with
// TS2451/TS2300/TS2393 while jest stayed green (jest isolates per file).

const BOUND_MS = 2000;

export type Settled<T> =
  | { settled: true; ok: true; value: T }
  | { settled: true; ok: false; error: unknown };

export function settleWithin<T>(promise: Promise<T>, label: string): Promise<Settled<T>> {
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
