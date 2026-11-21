/**
 * GET and PATCH /api/agents/:agentTokenId/config: one handler each, open to a
 * system admin or the agent's creator.
 *
 * `agentRoutes` runs on a throwaway express app with the REAL `authenticate`
 * middleware; the I/O boundary is `../lib/prisma` (no live Postgres needed).
 *
 * Mutation intent:
 *   - Drop the creator clause of `canManageAgentConfig` -> the creator cases go red.
 *   - Drop the admin clause -> the admin cases go red.
 *   - Make it always true -> the other-user and agent-token 403 cases go red.
 *   - Put an admin-only duplicate handler back before the effective one (or
 *     replace the effective PATCH) -> the creator cases and the merged-result
 *     validation case go red.
 */

const mockTokens: Record<string, Record<string, unknown>> = {
  "agent-1": {
    id: "agent-1",
    createdById: "user-creator",
    config: { maxMessagesPerMinute: 10 },
  },
  "agent-bad": {
    id: "agent-bad",
    createdById: "user-creator",
    // Stored out of range: only the merged-result check can notice this.
    config: { maxMessagesPerMinute: 500 },
  },
};

const mockUsersById: Record<string, Record<string, unknown>> = {
  "user-admin": {
    id: "user-admin",
    username: "admin",
    userType: "HUMAN",
    displayName: "Admin",
    isActive: true,
    isAdmin: true,
    tokenVersion: 0,
  },
  "user-creator": {
    id: "user-creator",
    username: "creator",
    userType: "HUMAN",
    displayName: "Creator",
    isActive: true,
    isAdmin: false,
    tokenVersion: 0,
  },
  "user-other": {
    id: "user-other",
    username: "other",
    userType: "HUMAN",
    displayName: "Other",
    isActive: true,
    isAdmin: false,
    tokenVersion: 0,
  },
};

const mockByoaTokens: Record<string, Record<string, unknown>> = {
  byoa_nonadmin_agent_token: {
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
      // `where.token`: byoa branch of `authenticate`; `where.id`: the handlers.
      findUnique: jest.fn(
        async ({ where }: { where: { token?: string; id?: string } }) => {
          if (where.token !== undefined) return mockByoaTokens[where.token] ?? null;
          if (where.id !== undefined) return mockTokens[where.id] ?? null;
          return null;
        },
      ),
      findFirst: jest.fn(async () => null),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { config: unknown };
        }) => ({ id: where.id, config: data.config }),
      ),
    },
    user: {
      findUnique: jest.fn(
        async ({ where }: { where: { id?: string } }) =>
          where.id === undefined ? null : mockUsersById[where.id] ?? null,
      ),
    },
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

const jwtFor = (userId: string) =>
  jwt.sign({ userId, tokenVersion: 0 }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
  });

const update = prisma.agentToken.update as jest.Mock;

beforeEach(() => {
  update.mockClear();
});

describe.each([
  ["GET", (app: express.Express, id: string) => request(app).get(`/api/agents/${id}/config`)],
  [
    "PATCH",
    (app: express.Express, id: string) =>
      request(app).patch(`/api/agents/${id}/config`).send({ maxMessagesPerMinute: 20 }),
  ],
] as const)("%s /api/agents/:agentTokenId/config access", (_method, call) => {
  it("401 without credentials", async () => {
    const res = await call(buildApp(), "agent-1");
    expect(res.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it("200 for a system admin who did not create the agent", async () => {
    const res = await call(buildApp(), "agent-1").set(
      "Authorization",
      `Bearer ${jwtFor("user-admin")}`,
    );
    expect(res.status).toBe(200);
  });

  it("200 for the creator", async () => {
    const res = await call(buildApp(), "agent-1").set(
      "Authorization",
      `Bearer ${jwtFor("user-creator")}`,
    );
    expect(res.status).toBe(200);
  });

  it("403 for another human", async () => {
    const res = await call(buildApp(), "agent-1").set(
      "Authorization",
      `Bearer ${jwtFor("user-other")}`,
    );
    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("403 for the byoa token of a non-admin agent", async () => {
    const res = await call(buildApp(), "agent-1").set(
      "Authorization",
      "Bearer byoa_nonadmin_agent_token",
    );
    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it("404 for an unknown agent id", async () => {
    const res = await call(buildApp(), "agent-missing").set(
      "Authorization",
      `Bearer ${jwtFor("user-admin")}`,
    );
    expect(res.status).toBe(404);
  });
});

describe("GET config body", () => {
  it("merges the stored config over the defaults", async () => {
    const res = await request(buildApp())
      .get("/api/agents/agent-1/config")
      .set("Authorization", `Bearer ${jwtFor("user-creator")}`);
    expect(res.status).toBe(200);
    expect(res.body.agentTokenId).toBe("agent-1");
    expect(res.body.config.maxMessagesPerMinute).toBe(10);
    expect(res.body.config).toHaveProperty("maxResponseLength");
  });
});

describe("PATCH config validation and persistence", () => {
  const auth = () => ({ Authorization: `Bearer ${jwtFor("user-creator")}` });

  it("400 for maxMessagesPerMinute out of range", async () => {
    for (const value of [0, 61]) {
      const res = await request(buildApp())
        .patch("/api/agents/agent-1/config")
        .set(auth())
        .send({ maxMessagesPerMinute: value });
      expect(res.status).toBe(400);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("400 for maxResponseLength out of range", async () => {
    for (const value of [99, 10001]) {
      const res = await request(buildApp())
        .patch("/api/agents/agent-1/config")
        .set(auth())
        .send({ maxResponseLength: value });
      expect(res.status).toBe(400);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("persists a valid patch through agentToken.update", async () => {
    const res = await request(buildApp())
      .patch("/api/agents/agent-1/config")
      .set(auth())
      .send({ maxMessagesPerMinute: 20 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "agent-1" });
    expect(arg.data.config.maxMessagesPerMinute).toBe(20);
    expect(res.body.config.maxMessagesPerMinute).toBe(20);
  });

  it("route order: the handler that validates the merged result answers", async () => {
    // The patch carries no numeric field, but the stored value is out of
    // range. Only the effective handler checks the merged result.
    const res = await request(buildApp())
      .patch("/api/agents/agent-bad/config")
      .set(auth())
      .send({ color: "red" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("maxMessagesPerMinute must be between 1 and 60");
    expect(update).not.toHaveBeenCalled();
  });
});
