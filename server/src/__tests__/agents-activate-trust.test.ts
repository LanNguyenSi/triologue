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

const act = (body: Record<string, unknown>) =>
  request(buildApp()).patch("/api/agents/tok-1/activate").send(body);

const written = () => tokenUpdate.mock.calls[0][0].data;

beforeEach(() => {
  tokenUpdate.mockClear();
  userUpdate.mockClear();
  row = { id: "tok-1", userId: "u-1", status: "pending", trustLevel: "elevated" };
});

describe("PATCH /api/agents/:id/activate trust level", () => {
  describe("pending agent that requested elevated", () => {
    it("no trustLevel in the body: clamped to standard", async () => {
      const res = await act({ action: "activate" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "active", trustLevel: "standard" });
      expect(written()).toMatchObject({ status: "active", trustLevel: "standard" });
    });

    it("explicit standard: standard", async () => {
      const res = await act({ action: "activate", trustLevel: "standard" });

      expect(res.body.trustLevel).toBe("standard");
      expect(written().trustLevel).toBe("standard");
    });

    it("explicit elevated: the admin's choice wins over the clamp", async () => {
      const res = await act({ action: "activate", trustLevel: "elevated" });

      expect(res.body).toMatchObject({ status: "active", trustLevel: "elevated" });
      expect(written()).not.toHaveProperty("trustLevel");
    });
  });

  describe("pending agent that requested standard", () => {
    beforeEach(() => {
      row!.trustLevel = "standard";
    });

    it("no trustLevel: stays standard, no trust write", async () => {
      const res = await act({ action: "activate" });

      expect(res.body.trustLevel).toBe("standard");
      expect(written()).not.toHaveProperty("trustLevel");
    });

    it("explicit elevated: raised to elevated", async () => {
      const res = await act({ action: "activate", trustLevel: "elevated" });

      expect(res.body.trustLevel).toBe("elevated");
      expect(written().trustLevel).toBe("elevated");
    });
  });

  describe("rejected agent activated again", () => {
    beforeEach(() => {
      row!.status = "rejected";
    });

    it("no trustLevel: clamped to standard", async () => {
      const res = await act({ action: "activate" });

      expect(res.body.trustLevel).toBe("standard");
      expect(written().trustLevel).toBe("standard");
    });

    it("explicit elevated: elevated", async () => {
      const res = await act({ action: "activate", trustLevel: "elevated" });

      expect(res.body.trustLevel).toBe("elevated");
      expect(written()).not.toHaveProperty("trustLevel");
    });
  });

  describe("already active agent", () => {
    beforeEach(() => {
      row!.status = "active";
    });

    it("activate without trustLevel leaves an elevated level alone", async () => {
      const res = await act({ action: "activate" });

      expect(res.body.trustLevel).toBe("elevated");
      expect(written()).not.toHaveProperty("trustLevel");
    });

    it("activate with an explicit standard does not change it either", async () => {
      const res = await act({ action: "activate", trustLevel: "standard" });

      expect(res.body.trustLevel).toBe("elevated");
      expect(written()).not.toHaveProperty("trustLevel");
    });
  });

  describe("reject", () => {
    it("leaves trust untouched, with or without a trustLevel", async () => {
      const plain = await act({ action: "reject" });
      expect(plain.body).toMatchObject({ status: "rejected", trustLevel: "elevated" });
      expect(written()).not.toHaveProperty("trustLevel");

      tokenUpdate.mockClear();
      row!.trustLevel = "standard";
      const withLevel = await act({ action: "reject", trustLevel: "elevated" });
      expect(withLevel.body.trustLevel).toBe("standard");
      expect(written()).not.toHaveProperty("trustLevel");
    });
  });

  describe("invalid trustLevel", () => {
    it.each([["admin"], [""], [1], [null], [true], [["elevated"]]])(
      "%p answers 400 and writes nothing",
      async (value) => {
        const res = await act({ action: "activate", trustLevel: value });

        expect(res.status).toBe(400);
        expect(tokenUpdate).not.toHaveBeenCalled();
        expect(userUpdate).not.toHaveBeenCalled();
      },
    );

    it("is refused on reject too", async () => {
      const res = await act({ action: "reject", trustLevel: "root" });

      expect(res.status).toBe(400);
      expect(tokenUpdate).not.toHaveBeenCalled();
    });
  });
});
