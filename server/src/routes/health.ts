/**
 * GET /api/health: a dependency-aware health probe.
 *
 * This route is the compose healthcheck (`docker-compose.yml`, `curl -f`)
 * and the relay deploy health (`.relay.yml`, `health: /api/health`), so its
 * status code decides whether the container is marked unhealthy and whether
 * a deploy proceeds. It used to answer 200 "healthy" unconditionally, even
 * with Postgres or Redis down; it now probes both dependencies:
 *   - Postgres: `SELECT 1` through the existing Prisma client.
 *   - Redis: `PING` through the existing shared client.
 * Each probe gets `timeoutMs` (default 2000 ms), so a dependency that
 * accepts the TCP connection but never answers cannot hang the probe.
 *
 * Status-code decision (see the acceptance discussion):
 *   - Database failure -> 503 "unhealthy". Every authenticated route reads
 *     or writes Postgres, so an api answering 200 here would keep receiving
 *     traffic it can only fail; the healthcheck must mark the container
 *     unhealthy and the deploy must not pass while the database is down.
 *   - Redis failure -> 200 "degraded", NOT 503. The shared client runs with
 *     `disableOfflineQueue: true` (see the decision comment at its
 *     createClient call in index.ts) because every consumer of it is a
 *     fire-and-forget, best-effort side effect (socketService's presence
 *     writes, pluginManager's shared context, the dashboard's online_users
 *     read), never a value the request/response path blocks on. The app
 *     keeps serving real traffic during a Redis outage, degrading to stale
 *     or incomplete presence data. Failing the healthcheck for it would
 *     mark a working container unhealthy (and hold a relay deploy) over an
 *     outage the app is explicitly designed to ride out.
 *   - The body never carries error text, host names or connection strings:
 *     a failed probe only flips its check to "error", because thrown
 *     database/redis errors embed hosts and credentials and this endpoint
 *     is unauthenticated.
 *
 * Exported as a factory with injected clients because importing index.ts
 * boots redis, sentry, sockets and plugins (see the headers of the
 * index-*.test.ts suites), and the handler must be testable without that.
 */

import type { Request, RequestHandler, Response } from "express";

export const HEALTH_PROBE_TIMEOUT_MS = 2000;

export type CheckResult = "ok" | "error";

export type HealthDependencies = {
  /** Structural view of the Prisma client: only the tagged-template `SELECT 1` probe is used. */
  prisma: {
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  };
  /**
   * The shared node-redis client (or a test fake): only `PING` is used.
   * A missing (null/undefined) client counts as a failed check.
   */
  redis: { ping(): Promise<unknown> } | null | undefined;
  /** Per-probe timeout in ms; injectable so tests can drive the hang case fast. */
  timeoutMs?: number;
};

/**
 * Runs one probe and maps it to "ok"/"error". The cause is deliberately
 * swallowed (and never reaches the response): only the verdict is reported.
 */
export async function runProbe(
  probe: () => Promise<unknown>,
  timeoutMs: number,
): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(probe),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("health probe timed out")), timeoutMs);
      }),
    ]);
    return "ok";
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

export function createHealthHandler(dependencies: HealthDependencies): RequestHandler {
  const timeoutMs = dependencies.timeoutMs ?? HEALTH_PROBE_TIMEOUT_MS;

  return async (_req: Request, res: Response): Promise<void> => {
    const { prisma, redis } = dependencies;
    // Both probes run concurrently so the response time is the slowest
    // probe, not their sum, and a dead database still gets Redis reported.
    const [database, redisCheck] = await Promise.all([
      runProbe(() => prisma.$queryRaw`SELECT 1`, timeoutMs),
      redis === null || redis === undefined
        ? Promise.resolve<CheckResult>("error")
        : runProbe(() => redis.ping(), timeoutMs),
    ]);

    const status =
      database === "error" ? "unhealthy" : redisCheck === "error" ? "degraded" : "healthy";
    res.status(database === "error" ? 503 : 200).json({
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "1.0.0",
      checks: { database, redis: redisCheck },
    });
  };
}
