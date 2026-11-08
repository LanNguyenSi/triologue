/**
 * GET /api/health (server/src/routes/health.ts).
 *
 * Mounts the factory-built handler on a throwaway express app with fake
 * prisma and redis clients (`createHealthHandler({ prisma, redis })`), never
 * importing index.ts, which boots redis, sentry, sockets and plugins at
 * import time (see the headers of the index-*.test.ts suites).
 *
 * Status decision under test: a failed database probe answers 503
 * "unhealthy" (nothing works without Postgres), a failed Redis probe answers
 * 200 "degraded" (every Redis consumer is best-effort, see the
 * disableOfflineQueue decision comment in index.ts), and no response ever
 * echoes a probe error.
 *
 * Mutation guards:
 *   - ignoring the database result makes "answers 503 unhealthy when the
 *     database throws" fail
 *   - ignoring the redis result makes "answers 200 degraded when Redis is
 *     down" fail
 *   - stretching the probe timeout makes the two hang tests hit their own
 *     2000 ms test timeout (a hung probe must not hang the endpoint)
 *   - changing the 503 answer to 200 makes both database-failure tests fail
 */

import express from "express";
import request from "./helpers/loopbackRequest";
import { createHealthHandler, type HealthDependencies } from "../routes/health";

// Markers shaped like real driver errors (hosts, ports, credentials): none
// of them may ever appear in a response body.
const DB_ERROR_MARKERS = ["ECONNREFUSED", "postgres://", "hunter2", "db.internal"];
const REDIS_ERROR_MARKERS = ["ClientOfflineError", "redis://", "s3cret", "cache.internal"];

function hanging<T>(): Promise<T> {
  // A promise that never settles: a dependency that accepts the connection
  // but never answers.
  return new Promise<T>((resolve) => void resolve);
}

function okPrisma() {
  return { $queryRaw: jest.fn(async (_query: TemplateStringsArray) => [{ "?column?": 1 }]) };
}

function throwingPrisma() {
  return {
    $queryRaw: jest.fn(async (_query: TemplateStringsArray) => {
      throw new Error("connect ECONNREFUSED postgres://triologue:hunter2@db.internal:5432");
    }),
  };
}

function hangingPrisma() {
  return { $queryRaw: jest.fn(async (_query: TemplateStringsArray) => hanging<unknown>()) };
}

function okRedis() {
  return { ping: jest.fn(async () => "PONG") };
}

function downRedis() {
  return {
    ping: jest.fn(async () => {
      throw new Error("ClientOfflineError: redis://default:s3cret@cache.internal:6379");
    }),
  };
}

function hangingRedis() {
  return { ping: jest.fn(async () => hanging<string>()) };
}

function buildApp(deps: HealthDependencies) {
  const app = express();
  app.get("/api/health", createHealthHandler(deps));
  return app;
}

function expectNoProbeErrors(res: { text: string; body: Record<string, unknown> }) {
  for (const marker of [...DB_ERROR_MARKERS, ...REDIS_ERROR_MARKERS]) {
    expect(res.text).not.toContain(marker);
  }
  // The body is exactly the four documented fields: no error field, no
  // extra detail that could carry a message.
  expect(Object.keys(res.body).sort()).toEqual(["checks", "status", "timestamp", "version"]);
}

describe("GET /api/health", () => {
  it("answers 200 healthy with both probes ok and runs each check", async () => {
    const prisma = okPrisma();
    const redis = okRedis();
    const res = await request(buildApp({ prisma, redis })).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "healthy",
      timestamp: expect.any(String),
      version: expect.any(String),
      checks: { database: "ok", redis: "ok" },
    });
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw.mock.calls[0][0][0]).toBe("SELECT 1");
    expect(redis.ping).toHaveBeenCalledTimes(1);
    expectNoProbeErrors(res);
  });

  it("answers 503 unhealthy when the database check throws", async () => {
    const prisma = throwingPrisma();
    const res = await request(buildApp({ prisma, redis: okRedis() })).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unhealthy");
    expect(res.body.checks).toEqual({ database: "error", redis: "ok" });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expectNoProbeErrors(res);
  });

  it("answers 503 when the database hangs past the timeout instead of hanging", async () => {
    const res = await request(
      buildApp({ prisma: hangingPrisma(), redis: okRedis(), timeoutMs: 50 }),
    ).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unhealthy");
    expect(res.body.checks).toEqual({ database: "error", redis: "ok" });
    expectNoProbeErrors(res);
  }, 2000);

  it("answers 200 degraded (not 503) when Redis is down", async () => {
    const redis = downRedis();
    const res = await request(buildApp({ prisma: okPrisma(), redis })).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks).toEqual({ database: "ok", redis: "error" });
    expect(redis.ping).toHaveBeenCalledTimes(1);
    expectNoProbeErrors(res);
  });

  it("answers 200 degraded when Redis hangs past the timeout instead of hanging", async () => {
    const res = await request(
      buildApp({ prisma: okPrisma(), redis: hangingRedis(), timeoutMs: 50 }),
    ).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks).toEqual({ database: "ok", redis: "error" });
    expectNoProbeErrors(res);
  }, 2000);

  it("answers 200 degraded when no Redis client is set at all", async () => {
    const res = await request(buildApp({ prisma: okPrisma(), redis: null })).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks).toEqual({ database: "ok", redis: "error" });
    expectNoProbeErrors(res);
  });

  it("answers 503 with both checks failed when database throws and Redis is down", async () => {
    const res = await request(
      buildApp({ prisma: throwingPrisma(), redis: downRedis(), timeoutMs: 50 }),
    ).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unhealthy");
    expect(res.body.checks).toEqual({ database: "error", redis: "error" });
    expectNoProbeErrors(res);
  });
});
