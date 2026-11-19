/**
 * GET /api/agents/info is behind `authenticate` (finding: unauthenticated
 * agent roster).
 *
 * Two groups, mirroring two changes:
 *   1. Route group: `agentRoutes` on a throwaway express app with the REAL
 *      `authenticate` middleware (not mocked): no token -> 401, garbage
 *      token -> 401, an unresolvable byoa token -> 401, a valid user JWT
 *      -> 200, a valid byoa token -> 200 (the Agent Gateway SDK authenticates
 *      with agent tokens), both 200s with the identical body shape.
 *      The I/O boundary is `../lib/prisma` (the roster read, the JWT branch's
 *      user lookup and the byoa branch's token lookup through
 *      `findAgentTokenByRawToken`); no live Postgres needed.
 *   2. Limiter group: `../index` required with GLOBAL_RATE_LIMIT_MAX=1 so a
 *      single counted request per window exhausts the global limiter.
 *      `/agents/info` must be counted now (401 then 429); `/health` stays
 *      exempt from the skip list (two requests, both 503, never 429).
 *
 * Mutation intent:
 *   - Drop `authenticate` from the route -> the 401 tests go red (the
 *     limiter group's first info request then answers 200, so its 401
 *     expectation fails too).
 *   - Re-add `req.path === "/agents/info"` to the skip list -> the limiter
 *     group's second info request answers 401, not 429, and fails.
 */

type AgentTokenRow = {
  isActive: boolean;
  status: string;
  agentUser: {
    id: string;
    username: string;
    displayName: string | null;
    userType: string;
    isActive: boolean;
    isAdmin: boolean;
  };
};

const mockRosterRows = [
  {
    mentionKey: "ice",
    emoji: "🧊",
    color: "#7dd3fc",
    trustLevel: 2,
    agentUser: {
      id: "user-agent-1",
      username: "ice",
      displayName: "Ice",
      userType: "AI_AGENT",
    },
  },
  {
    // Pins the fallback defaults (🤖 / #888888) of the existing handler.
    mentionKey: "lava",
    emoji: null,
    color: null,
    trustLevel: 0,
    agentUser: {
      id: "user-agent-2",
      username: "lava",
      displayName: null,
      userType: "AI_AGENT",
    },
  },
];

const EXPECTED_ROSTER = {
  "user-agent-1": {
    username: "ice",
    displayName: "Ice",
    mentionKey: "ice",
    emoji: "🧊",
    color: "#7dd3fc",
    trustLevel: 2,
  },
  "user-agent-2": {
    username: "lava",
    displayName: null,
    mentionKey: "lava",
    emoji: "🤖",
    color: "#888888",
    trustLevel: 0,
  },
};

const mockUsersById: Record<string, Record<string, unknown>> = {
  "user-human-1": {
    id: "user-human-1",
    username: "human",
    userType: "HUMAN",
    displayName: "Human",
    isActive: true,
    isAdmin: false,
    tokenVersion: 0,
  },
};

const mockAgentTokensByToken: Record<string, AgentTokenRow> = {
  byoa_valid_roster_token: {
    isActive: true,
    status: "active",
    agentUser: {
      id: "user-agent-1",
      username: "ice",
      displayName: "Ice",
      userType: "AI_AGENT",
      isActive: true,
      isAdmin: false,
    },
  },
};

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    agentToken: {
      // byoa branch of `authenticate` (via findAgentTokenByRawToken).
      findUnique: jest.fn(
        async ({ where }: { where: { token?: string } }) =>
          where.token === undefined
            ? null
            : mockAgentTokensByToken[where.token] ?? null,
      ),
      findFirst: jest.fn(async () => null),
      // The roster read of the route handler itself.
      findMany: jest.fn(async () => mockRosterRows),
    },
    // JWT branch of `authenticate`.
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { id?: string } }) =>
          where.id === undefined ? null : mockUsersById[where.id] ?? null,
      ),
    },
    // index.ts wires the health probe with this client; make it fail
    // deterministically so /api/health answers 503 without a database.
    $queryRaw: jest.fn(async () => {
      throw new Error("no database in unit tests");
    }),
  },
}));

import express from "express";
import jwt from "jsonwebtoken";
import request from "./helpers/loopbackRequest";
import prisma from "../lib/prisma";
import { agentRoutes } from "../routes/agents";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentRoutes);
  return app;
}

const humanJwt = () =>
  jwt.sign(
    { userId: "user-human-1", tokenVersion: 0 },
    process.env.JWT_SECRET!,
    { expiresIn: "1h" },
  );

describe("GET /api/agents/info requires authenticate", () => {
  it("401 without an Authorization header, and the roster is never read", async () => {
    (prisma.agentToken.findMany as jest.Mock).mockClear();
    const res = await request(buildApp()).get("/api/agents/info");
    expect(res.status).toBe(401);
    expect(prisma.agentToken.findMany as jest.Mock).not.toHaveBeenCalled();
  });

  it("401 for a garbage bearer token", async () => {
    const res = await request(buildApp())
      .get("/api/agents/info")
      .set("Authorization", "Bearer not-a-jwt-and-not-byoa");
    expect(res.status).toBe(401);
  });

  it("401 for a byoa_ token that resolves to no row", async () => {
    const res = await request(buildApp())
      .get("/api/agents/info")
      .set("Authorization", "Bearer byoa_unknown_token_0000");
    expect(res.status).toBe(401);
  });

  it("200 with a valid user JWT and the existing body shape", async () => {
    const res = await request(buildApp())
      .get("/api/agents/info")
      .set("Authorization", `Bearer ${humanJwt()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(EXPECTED_ROSTER);
  });

  it("200 with a valid byoa agent token and the same body shape", async () => {
    const res = await request(buildApp())
      .get("/api/agents/info")
      .set("Authorization", "Bearer byoa_valid_roster_token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(EXPECTED_ROSTER);
  });
});

describe("global rate limiter no longer skips /agents/info", () => {
  // GLOBAL_RATE_LIMIT_MAX=1 is read at index.ts module scope, so the module
  // is required inside jest.isolateModules with the override in place.
  // Skipped requests (the skip list) never consume the budget, which is what
  // makes the two groups below distinguishable under a limit of 1.
  it("counts /agents/info but still exempts /health", async () => {
    const previousMax = process.env.GLOBAL_RATE_LIMIT_MAX;
    process.env.GLOBAL_RATE_LIMIT_MAX = "1";
    let app: express.Express;
    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports -- deferred load so the limiter max override is set before the module executes
        app = require("../index").app;
      });
    } finally {
      if (previousMax === undefined) delete process.env.GLOBAL_RATE_LIMIT_MAX;
      else process.env.GLOBAL_RATE_LIMIT_MAX = previousMax;
    }

    // /health stays exempt: two requests, the budget of 1 untouched.
    // (503: the mocked prisma probe fails without a database.)
    const health1 = await request(app!).get("/api/health");
    const health2 = await request(app!).get("/api/health");
    expect([health1.status, health2.status]).toEqual([503, 503]);

    // /agents/info is counted now: the first request passes the limiter and
    // is refused by `authenticate`; the second is the limiter's 429. If the
    // skip exemption came back, the second would be 401 again.
    const info1 = await request(app!).get("/api/agents/info");
    const info2 = await request(app!).get("/api/agents/info");
    expect(info1.status).toBe(401);
    expect(info2.status).toBe(429);
  });
});
