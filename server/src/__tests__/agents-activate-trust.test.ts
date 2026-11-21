/**
 * PATCH /api/agents/:id/activate: approving a pending agent clamps a
 * self-chosen "elevated" trust level to "standard". Route mounted on a
 * throwaway express app with mocked prisma.
 */

type Row = { id: string; userId: string; status: string; trustLevel: string };
let row: Row | null = null;
const tokenUpdate = jest.fn();
const userUpdate = jest.fn();

jest.mock("../lib/prisma", () => {
  const prismaMock: Record<string, unknown> = {
    agentToken: {
      findUnique: jest.fn(async () => row),
      update: (args: unknown) => {
        tokenUpdate(args);
        return Promise.resolve({});
      },
    },
    user: {
      update: (args: unknown) => {
        userUpdate(args);
        return Promise.resolve({});
      },
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { __esModule: true, default: prismaMock, prisma: prismaMock };
});

jest.mock("../services/auditService", () => ({ logAuditEvent: jest.fn() }));
jest.mock("../connectors/mcp/mcpBridge", () => ({
  getActiveConnections: jest.fn(),
  callTool: jest.fn(),
}));
jest.mock("../connectors/registry", () => ({
  listEnabledConnectors: jest.fn().mockReturnValue([]),
  initConnectors: jest.fn(),
}));
jest.mock("../middleware/auth", () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: "admin-1", isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from "express";
import request from "./helpers/loopbackRequest";
import { agentRoutes } from "../routes/agents";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentRoutes);
  return app;
}

const act = (action: string) =>
  request(buildApp()).patch("/api/agents/tok-1/activate").send({ action });

beforeEach(() => {
  tokenUpdate.mockClear();
  userUpdate.mockClear();
  row = { id: "tok-1", userId: "u-1", status: "pending", trustLevel: "elevated" };
});

describe("PATCH /api/agents/:id/activate trust clamp", () => {
  it("activating a pending elevated agent sets trust to standard", async () => {
    const res = await act("activate");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "active", trustLevel: "standard" });
    expect(tokenUpdate.mock.calls[0][0].data).toMatchObject({
      status: "active",
      trustLevel: "standard",
    });
  });

  it("activating a pending standard agent keeps standard and writes no trust change", async () => {
    row!.trustLevel = "standard";

    const res = await act("activate");

    expect(res.body).toMatchObject({ status: "active", trustLevel: "standard" });
    expect(tokenUpdate.mock.calls[0][0].data).not.toHaveProperty("trustLevel");
  });

  it("rejecting a pending elevated agent leaves trust untouched", async () => {
    const res = await act("reject");

    expect(res.body).toMatchObject({ status: "rejected", trustLevel: "elevated" });
    expect(tokenUpdate.mock.calls[0][0].data).not.toHaveProperty("trustLevel");
  });

  it("activating a non-pending elevated agent leaves trust untouched", async () => {
    row!.status = "rejected";

    const res = await act("activate");

    expect(res.body).toMatchObject({ status: "active", trustLevel: "elevated" });
    expect(tokenUpdate.mock.calls[0][0].data).not.toHaveProperty("trustLevel");
  });
});
