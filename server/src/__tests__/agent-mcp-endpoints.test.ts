/**
 * Integration tests for the BYOA agent MCP endpoints:
 *   - GET  /api/agents/mcp/tools
 *   - POST /api/agents/mcp/call
 *   - GET  /api/agents/connectors/catalog (MCP entries)
 *
 * The full app (index.ts) boots redis, sentry, sockets and plugins,
 * so these tests mount `agentRoutes` on a throwaway express app and
 * mock the two I/O-heavy module boundaries:
 *   - `../lib/prisma`                (agentToken auth lookup)
 *   - `../connectors/mcp/mcpBridge`  (discovered tools + tool call)
 * plus the audit service so we can assert that POST /mcp/call is
 * audited (follow-up from PR #62 review).
 */

type AgentTokenRow = {
  userId: string;
  status: "active" | "pending" | "rejected";
  isActive: boolean;
  agentUser: { id: string; isActive: boolean; displayName: string };
};

type ConnectorPermissionRow = {
  connectorId: string;
  userId: string;
  allowedActions: string[];
};

const agentTokens: Record<string, AgentTokenRow> = {};
let connectorPermissions: ConnectorPermissionRow[] = [];

// PUT /:agentTokenId/permissions fixtures: the handler looks the agent up by
// id (not token), and the new check resolves McpConnection ownership. Kept
// separate from the byoa-token registry above.
type AgentTokenByIdRow = { id: string; userId: string; createdById: string };
const agentTokensById: Record<string, AgentTokenByIdRow> = {};
type McpConnectionRow = { id: string; createdBy: string };
let mcpConnectionRows: McpConnectionRow[] = [];
let permIdSeq = 0;

// Session user injected by the mocked `authenticate` middleware; reassigned
// per-test to exercise admin / connection-owner / non-owner scenarios.
let currentSessionUser: { id: string; isAdmin: boolean } = {
  id: "user-human-1",
  isAdmin: false,
};

jest.mock("../lib/prisma", () => {
  // Build connectorPermission mock once so the same jest.fn instances are
  // shared between the default export and the tx client passed to $transaction.
  const connectorPermissionMock = {
    findUnique: jest.fn(
      async ({
        where,
      }: {
        where: { connectorId_userId: { connectorId: string; userId: string } };
      }) => {
        return (
          connectorPermissions.find(
            (r) =>
              r.connectorId === where.connectorId_userId.connectorId &&
              r.userId === where.connectorId_userId.userId,
          ) ?? null
        );
      },
    ),
    findMany: jest.fn(
      async ({
        where,
      }: {
        where: { userId: string; connectorId: { in: string[] } };
      }) => {
        return connectorPermissions.filter(
          (r) =>
            r.userId === where.userId &&
            where.connectorId.in.includes(r.connectorId),
        );
      },
    ),
    deleteMany: jest.fn(async ({ where }: { where: { userId: string } }) => {
      const before = connectorPermissions.length;
      connectorPermissions = connectorPermissions.filter(
        (r) => r.userId !== where.userId,
      );
      return { count: before - connectorPermissions.length };
    }),
    create: jest.fn(
      async ({
        data,
      }: {
        data: {
          connectorId: string;
          userId: string;
          allowedActions: string[];
          grantedBy: string;
        };
      }) => {
        connectorPermissions.push({
          connectorId: data.connectorId,
          userId: data.userId,
          allowedActions: data.allowedActions,
        });
        return {
          id: `perm-${++permIdSeq}`,
          connectorId: data.connectorId,
          allowedActions: data.allowedActions,
        };
      },
    ),
  };

  // tx client passed to $transaction callbacks: exposes the same
  // connectorPermission mock so toHaveBeenCalled assertions still work.
  const txClient = { connectorPermission: connectorPermissionMock };

  return {
    __esModule: true,
    default: {
      agentToken: {
        findUnique: jest.fn(
          async ({ where }: { where: { token?: string; id?: string } }) => {
            if (where.token !== undefined) return agentTokens[where.token] ?? null;
            if (where.id !== undefined) return agentTokensById[where.id] ?? null;
            return null;
          },
        ),
      },
      connectorPermission: connectorPermissionMock,
      mcpConnection: {
        findMany: jest.fn(
          async ({ where }: { where: { id: { in: string[] } } }) => {
            return mcpConnectionRows.filter((c) => where.id.in.includes(c.id));
          },
        ),
      },
      $transaction: jest.fn(
        async (cb: (tx: typeof txClient) => Promise<unknown>) => {
          const snapshot = [...connectorPermissions];
          try {
            return await cb(txClient);
          } catch (e) {
            connectorPermissions = snapshot;
            throw e;
          }
        },
      ),
    },
    prisma: {
      agentToken: {
        findUnique: jest.fn(async ({ where }: { where: { token: string } }) => {
          return agentTokens[where.token] ?? null;
        }),
      },
      connectorPermission: {
        findUnique: jest.fn(
          async ({
            where,
          }: {
            where: { connectorId_userId: { connectorId: string; userId: string } };
          }) => {
            return (
              connectorPermissions.find(
                (r) =>
                  r.connectorId === where.connectorId_userId.connectorId &&
                  r.userId === where.connectorId_userId.userId,
              ) ?? null
            );
          },
        ),
        findMany: jest.fn(
          async ({
            where,
          }: {
            where: { userId: string; connectorId: { in: string[] } };
          }) => {
            return connectorPermissions.filter(
              (r) =>
                r.userId === where.userId &&
                where.connectorId.in.includes(r.connectorId),
            );
          },
        ),
      },
    },
  };
});

const mockGetActiveConnections = jest.fn();
const mockCallTool = jest.fn();

jest.mock("../connectors/mcp/mcpBridge", () => ({
  getActiveConnections: (...args: unknown[]) =>
    mockGetActiveConnections(...args),
  callTool: (...args: unknown[]) => mockCallTool(...args),
}));

const mockLogAuditEvent = jest.fn();
jest.mock("../services/auditService", () => ({
  logAuditEvent: (...args: unknown[]) => mockLogAuditEvent(...args),
}));

// `listEnabledConnectors` returns non-MCP catalog items. The catalog
// test below seeds this with one stub connector so we can assert
// that (a) the pre-existing shape is preserved for existing consumers
// and (b) MCP connections are appended with `category: "mcp"`.
const mockListEnabledConnectors = jest.fn().mockReturnValue([]);
jest.mock("../connectors/registry", () => ({
  listEnabledConnectors: (...args: unknown[]) =>
    mockListEnabledConnectors(...args),
  initConnectors: jest.fn(),
}));

// `authenticate` on `/connectors/catalog` is the session-auth path
// (NextAuth/JWT); we replace it with a pass-through so we can isolate
// the catalog assembly logic. BYOA endpoints now go through the
// byoaAuth middleware (which calls prisma.agentToken.findUnique —
// covered by the prisma mock above); session authenticate is only
// replaced here to isolate the catalog assembly logic.
jest.mock("../middleware/auth", () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user: unknown }).user = currentSessionUser;
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import express from "express";
import request from "supertest";
import prisma from "../lib/prisma";
import { agentRoutes } from "../routes/agents";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/agents", agentRoutes);
  return app;
}

const VALID_TOKEN = "byoa_valid_token_xyz";
/** Admin-created connection: open to all active agents (no grant required). */
const ACTIVE_CONN = {
  id: "conn-1",
  name: "agent-tasks",
  creatorIsAdmin: true,
  tools: [
    {
      name: "projects_list",
      description: "List projects",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "tasks_list",
      description: "List tasks",
      inputSchema: { type: "object", properties: {} },
    },
  ],
};

/** Non-admin connection: default-deny, requires a ConnectorPermission grant. */
const NON_ADMIN_CONN = {
  id: "conn-2",
  name: "user-mcp",
  creatorIsAdmin: false,
  tools: [
    {
      name: "read_data",
      description: "Read data",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "write_data",
      description: "Write data",
      inputSchema: { type: "object", properties: {} },
    },
  ],
};

beforeEach(() => {
  for (const k of Object.keys(agentTokens)) delete agentTokens[k];
  agentTokens[VALID_TOKEN] = {
    userId: "user-agent-1",
    status: "active",
    isActive: true,
    agentUser: { id: "user-agent-1", isActive: true, displayName: "Test Agent" },
  };
  connectorPermissions = [];
  for (const k of Object.keys(agentTokensById)) delete agentTokensById[k];
  mcpConnectionRows = [];
  permIdSeq = 0;
  currentSessionUser = { id: "user-human-1", isAdmin: false };
  (prisma.connectorPermission.deleteMany as jest.Mock).mockClear();
  (prisma.connectorPermission.create as jest.Mock).mockClear();
  (prisma.mcpConnection.findMany as jest.Mock).mockClear();
  ((prisma as unknown as { $transaction: jest.Mock }).$transaction).mockClear();
  mockGetActiveConnections.mockReset();
  mockCallTool.mockReset();
  mockLogAuditEvent.mockReset();
  mockListEnabledConnectors.mockReset();
  mockListEnabledConnectors.mockReturnValue([]);
});

describe("GET /api/agents/mcp/tools", () => {
  it("returns tools from active MCP connections with a valid BYOA token", async () => {
    mockGetActiveConnections.mockResolvedValue([ACTIVE_CONN]);
    const app = buildApp();

    const res = await request(app)
      .get("/api/agents/mcp/tools")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.tools).toHaveLength(2);
    expect(res.body.tools[0]).toMatchObject({
      connectionId: "conn-1",
      connectionName: "agent-tasks",
      name: "projects_list",
    });
    expect(res.body.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      "projects_list",
      "tasks_list",
    ]);
  });

  it("returns 401 when no Bearer byoa_ token is present", async () => {
    const app = buildApp();

    const res = await request(app).get("/api/agents/mcp/tools");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/byoa_/);
    expect(mockGetActiveConnections).not.toHaveBeenCalled();
  });

  it("returns 401 when the Bearer token prefix is wrong", async () => {
    const app = buildApp();

    const res = await request(app)
      .get("/api/agents/mcp/tools")
      .set("Authorization", "Bearer not_byoa_token");
    expect(res.status).toBe(401);
    expect(mockGetActiveConnections).not.toHaveBeenCalled();
  });

  it("returns 401 when the byoa token is unknown", async () => {
    const app = buildApp();

    const res = await request(app)
      .get("/api/agents/mcp/tools")
      .set("Authorization", "Bearer byoa_unknown_token");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid agent token/);
  });

  it("returns 500 (not a hung request) when the agent-token lookup throws", async () => {
    // Guards the byoaAuth try/catch: a DB/infra error during token resolution
    // must produce a graceful 500, not a rejected-promise hang (Express 4).
    (prisma.agentToken.findUnique as jest.Mock).mockRejectedValueOnce(
      new Error("db down"),
    );
    const app = buildApp();

    const res = await request(app)
      .get("/api/agents/mcp/tools")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
    expect(mockGetActiveConnections).not.toHaveBeenCalled();
  });
});

describe("POST /api/agents/mcp/call", () => {
  it("forwards to mcpBridge.callTool and returns its content for a known tool", async () => {
    mockGetActiveConnections.mockResolvedValue([ACTIVE_CONN]);
    mockCallTool.mockResolvedValue({
      success: true,
      content: [{ type: "text", text: '{"projects":[]}' }],
    });
    const app = buildApp();

    const res = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-1", tool: "projects_list", arguments: {} });

    expect(res.status).toBe(200);
    expect(res.body.content).toEqual([
      { type: "text", text: '{"projects":[]}' },
    ]);
    expect(mockCallTool).toHaveBeenCalledWith("conn-1", "projects_list", {});
  });

  it("returns 400 for a tool that is not in the connection's discovered tool list", async () => {
    mockGetActiveConnections.mockResolvedValue([ACTIVE_CONN]);
    const app = buildApp();

    const res = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-1", tool: "rm_rf_prod", arguments: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown tool/);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it("returns 404 when the connectionId does not match any active connection", async () => {
    mockGetActiveConnections.mockResolvedValue([ACTIVE_CONN]);
    const app = buildApp();

    const res = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({
        connectionId: "conn-does-not-exist",
        tool: "projects_list",
        arguments: {},
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found|inactive/i);
    expect(mockCallTool).not.toHaveBeenCalled();

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    const entry = mockLogAuditEvent.mock.calls[0][0];
    expect(entry).toMatchObject({
      agentId: "user-agent-1",
      action: "mcp.call",
      resourceType: "mcp_tool",
      resourceId: "projects_list",
      success: false,
    });
    expect(entry.details).toMatchObject({
      connectionId: "conn-does-not-exist",
      reason: "connection_not_found",
    });
  });

  it("returns 401 when no BYOA token is present", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/agents/mcp/call")
      .send({ connectionId: "conn-1", tool: "projects_list", arguments: {} });
    expect(res.status).toBe(401);
    expect(mockGetActiveConnections).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is missing connectionId or tool", async () => {
    const app = buildApp();

    const noConn = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ tool: "projects_list" });
    expect(noConn.status).toBe(400);
    expect(noConn.body.error).toMatch(/connectionId/);

    const noTool = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-1" });
    expect(noTool.status).toBe(400);
    expect(noTool.body.error).toMatch(/tool/);
  });

  it("surfaces upstream errors from mcpBridge.callTool as 502", async () => {
    mockGetActiveConnections.mockResolvedValue([ACTIVE_CONN]);
    mockCallTool.mockResolvedValue({
      success: false,
      content: null,
      error: "MCP server error: 500",
    });
    const app = buildApp();

    const res = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-1", tool: "projects_list", arguments: {} });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("MCP server error: 500");
    expect(res.body.content).toBeNull();
  });

  it("writes an audit log entry on successful tool invocation", async () => {
    mockGetActiveConnections.mockResolvedValue([ACTIVE_CONN]);
    mockCallTool.mockResolvedValue({ success: true, content: [] });
    const app = buildApp();

    await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-1", tool: "projects_list", arguments: {} });

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    const entry = mockLogAuditEvent.mock.calls[0][0];
    expect(entry).toMatchObject({
      agentId: "user-agent-1",
      action: "mcp.call",
      resourceType: "mcp_tool",
      resourceId: "projects_list",
      success: true,
    });
    expect(entry.details).toMatchObject({
      connectionId: "conn-1",
      connectionName: "agent-tasks",
    });
    expect(typeof entry.durationMs).toBe("number");
  });

  it("writes an audit log entry on upstream failure with the upstream error", async () => {
    mockGetActiveConnections.mockResolvedValue([ACTIVE_CONN]);
    mockCallTool.mockResolvedValue({
      success: false,
      content: null,
      error: "boom",
    });
    const app = buildApp();

    await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-1", tool: "projects_list", arguments: {} });

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    const entry = mockLogAuditEvent.mock.calls[0][0];
    expect(entry).toMatchObject({
      agentId: "user-agent-1",
      action: "mcp.call",
      resourceType: "mcp_tool",
      resourceId: "projects_list",
      success: false,
    });
    expect(entry.details).toMatchObject({
      connectionId: "conn-1",
      connectionName: "agent-tasks",
      error: "boom",
    });
  });

  it("writes an audit log entry when the tool is rejected as unknown", async () => {
    mockGetActiveConnections.mockResolvedValue([ACTIVE_CONN]);
    const app = buildApp();

    await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-1", tool: "rm_rf_prod", arguments: {} });

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    const entry = mockLogAuditEvent.mock.calls[0][0];
    expect(entry).toMatchObject({
      agentId: "user-agent-1",
      action: "mcp.call",
      resourceType: "mcp_tool",
      resourceId: "rm_rf_prod",
      success: false,
    });
    expect(entry.details).toMatchObject({
      connectionId: "conn-1",
      reason: "unknown_tool",
    });
  });
});

describe("MCP ACL — POST /api/agents/mcp/call", () => {
  it("admin connection: allows any active agent to call a tool without a grant", async () => {
    mockGetActiveConnections.mockResolvedValue([ACTIVE_CONN]);
    mockCallTool.mockResolvedValue({ success: true, content: [{ type: "text", text: "ok" }] });
    const app = buildApp();

    const res = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-1", tool: "projects_list", arguments: {} });

    expect(res.status).toBe(200);
    expect(mockCallTool).toHaveBeenCalledWith("conn-1", "projects_list", {});
  });

  it("non-admin connection WITH a matching grant: forwards to callTool", async () => {
    connectorPermissions.push({
      connectorId: "mcp:conn-2",
      userId: "user-agent-1",
      allowedActions: ["read_data"],
    });
    mockGetActiveConnections.mockResolvedValue([NON_ADMIN_CONN]);
    mockCallTool.mockResolvedValue({ success: true, content: [] });
    const app = buildApp();

    const res = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-2", tool: "read_data", arguments: {} });

    expect(res.status).toBe(200);
    expect(mockCallTool).toHaveBeenCalledWith("conn-2", "read_data", {});
  });

  it("non-admin connection with NO permission row: returns 403 and does not call the tool", async () => {
    // No grant for user-agent-1 on conn-2
    mockGetActiveConnections.mockResolvedValue([NON_ADMIN_CONN]);
    const app = buildApp();

    const res = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-2", tool: "read_data", arguments: {} });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not permitted/i);
    expect(mockCallTool).not.toHaveBeenCalled();

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    const entry = mockLogAuditEvent.mock.calls[0][0];
    expect(entry).toMatchObject({
      agentId: "user-agent-1",
      action: "mcp.call",
      resourceType: "mcp_tool",
      resourceId: "read_data",
      success: false,
    });
    expect(entry.details).toMatchObject({
      connectionId: "conn-2",
      reason: "permission_denied",
    });
  });

  it("non-admin connection WITH a grant but tool not in allowedActions: returns 403", async () => {
    connectorPermissions.push({
      connectorId: "mcp:conn-2",
      userId: "user-agent-1",
      allowedActions: ["read_data"], // write_data is NOT granted
    });
    mockGetActiveConnections.mockResolvedValue([NON_ADMIN_CONN]);
    const app = buildApp();

    const res = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-2", tool: "write_data", arguments: {} });

    expect(res.status).toBe(403);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it("non-admin connection with wildcard '*' grant: allows any tool", async () => {
    connectorPermissions.push({
      connectorId: "mcp:conn-2",
      userId: "user-agent-1",
      allowedActions: ["*"],
    });
    mockGetActiveConnections.mockResolvedValue([NON_ADMIN_CONN]);
    mockCallTool.mockResolvedValue({ success: true, content: [] });
    const app = buildApp();

    const res = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-2", tool: "write_data", arguments: {} });

    expect(res.status).toBe(200);
    expect(mockCallTool).toHaveBeenCalledWith("conn-2", "write_data", {});
  });

  it("non-admin connection with a grant for a DIFFERENT user: 403 (no cross-user authorization)", async () => {
    connectorPermissions.push({
      connectorId: "mcp:conn-2",
      userId: "user-other-agent", // grant belongs to a different agent
      allowedActions: ["read_data"],
    });
    mockGetActiveConnections.mockResolvedValue([NON_ADMIN_CONN]);
    const app = buildApp();

    const res = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-2", tool: "read_data", arguments: {} });

    expect(res.status).toBe(403);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it("a grant on one non-admin connection does not authorize a different one", async () => {
    connectorPermissions.push({
      connectorId: "mcp:conn-2",
      userId: "user-agent-1",
      allowedActions: ["read_data"],
    });
    const OTHER_CONN = {
      id: "conn-3",
      name: "other-mcp",
      creatorIsAdmin: false,
      tools: [
        { name: "read_data", description: "Read data", inputSchema: { type: "object", properties: {} } },
      ],
    };
    mockGetActiveConnections.mockResolvedValue([OTHER_CONN]);
    const app = buildApp();

    const res = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-3", tool: "read_data", arguments: {} });

    expect(res.status).toBe(403);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it("a grant whose connectorId lacks the mcp: prefix does not authorize an MCP call", async () => {
    connectorPermissions.push({
      connectorId: "conn-2", // bare id, missing the required "mcp:" prefix
      userId: "user-agent-1",
      allowedActions: ["read_data"],
    });
    mockGetActiveConnections.mockResolvedValue([NON_ADMIN_CONN]);
    const app = buildApp();

    const res = await request(app)
      .post("/api/agents/mcp/call")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ connectionId: "conn-2", tool: "read_data", arguments: {} });

    expect(res.status).toBe(403);
    expect(mockCallTool).not.toHaveBeenCalled();
  });
});

describe("MCP ACL — GET /api/agents/mcp/tools", () => {
  it("returns admin-connection tools plus only granted tools on non-admin connection", async () => {
    connectorPermissions.push({
      connectorId: "mcp:conn-2",
      userId: "user-agent-1",
      allowedActions: ["read_data"], // write_data is NOT granted
    });
    mockGetActiveConnections.mockResolvedValue([ACTIVE_CONN, NON_ADMIN_CONN]);
    const app = buildApp();

    const res = await request(app)
      .get("/api/agents/mcp/tools")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    // All 2 tools from admin conn-1, only "read_data" from non-admin conn-2
    expect(res.body.tools).toHaveLength(3);
    const names = res.body.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["projects_list", "read_data", "tasks_list"]);

    // write_data is absent
    const writeData = res.body.tools.find((t: { name: string }) => t.name === "write_data");
    expect(writeData).toBeUndefined();
  });

  it("omits a non-admin connection entirely when the agent has no grant for it", async () => {
    // No grants at all for conn-2
    mockGetActiveConnections.mockResolvedValue([ACTIVE_CONN, NON_ADMIN_CONN]);
    const app = buildApp();

    const res = await request(app)
      .get("/api/agents/mcp/tools")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    // Only admin conn-1 tools; conn-2 is invisible
    expect(res.body.tools).toHaveLength(2);
    const connIds = res.body.tools.map((t: { connectionId: string }) => t.connectionId);
    expect(connIds.every((id: string) => id === "conn-1")).toBe(true);
  });

  it("does not expose a non-admin connection's tools granted to a DIFFERENT user", async () => {
    connectorPermissions.push({
      connectorId: "mcp:conn-2",
      userId: "user-other-agent", // grant belongs to another agent
      allowedActions: ["read_data"],
    });
    mockGetActiveConnections.mockResolvedValue([ACTIVE_CONN, NON_ADMIN_CONN]);
    const app = buildApp();

    const res = await request(app)
      .get("/api/agents/mcp/tools")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    // conn-2 stays invisible to user-agent-1 (the grant is for a different user)
    expect(res.body.tools).toHaveLength(2);
    const connIds = res.body.tools.map((t: { connectionId: string }) => t.connectionId);
    expect(connIds.every((id: string) => id === "conn-1")).toBe(true);
  });

  it("wildcard '*' grant on non-admin connection exposes all its tools", async () => {
    connectorPermissions.push({
      connectorId: "mcp:conn-2",
      userId: "user-agent-1",
      allowedActions: ["*"],
    });
    mockGetActiveConnections.mockResolvedValue([NON_ADMIN_CONN]);
    const app = buildApp();

    const res = await request(app)
      .get("/api/agents/mcp/tools")
      .set("Authorization", `Bearer ${VALID_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.tools).toHaveLength(2);
    const names = res.body.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["read_data", "write_data"]);
  });
});

describe("GET /api/agents/connectors/catalog", () => {
  // The catalog endpoint uses session `authenticate` (not BYOA). That
  // middleware is replaced with a pass-through at the top of the file
  // so we can assert the MCP-specific augmentation in isolation.
  const STUB_CONNECTOR = {
    id: "jira",
    name: "Jira",
    provider: "jira",
    auth: { scope: "team" },
    icon: "jira-icon",
    category: "project-management",
    actions: [
      { id: "create_ticket", name: "Create ticket", description: "..." },
    ],
  };

  it("includes MCP connections with category: 'mcp' alongside existing connectors", async () => {
    mockListEnabledConnectors.mockReturnValue([STUB_CONNECTOR]);
    mockGetActiveConnections.mockResolvedValue([ACTIVE_CONN]);
    const app = buildApp();

    const res = await request(app).get("/api/agents/connectors/catalog");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);

    const existing = res.body.items.find((i: { id: string }) => i.id === "jira");
    expect(existing).toMatchObject({
      id: "jira",
      name: "Jira",
      provider: "jira",
      category: "project-management",
      status: "connected",
    });
    expect(existing.actions).toEqual([
      { id: "create_ticket", name: "Create ticket", description: "..." },
    ]);

    const mcpItem = res.body.items.find((i: { provider: string }) => i.provider === "mcp");
    expect(mcpItem).toMatchObject({
      id: "mcp:conn-1",
      name: "agent-tasks",
      provider: "mcp",
      category: "mcp",
      status: "connected",
      scope: null,
      icon: null,
    });
    expect(mcpItem.actions.map((a: { id: string }) => a.id).sort()).toEqual([
      "projects_list",
      "tasks_list",
    ]);
  });

  it("preserves the existing catalog shape when no MCP connections are active", async () => {
    mockListEnabledConnectors.mockReturnValue([STUB_CONNECTOR]);
    mockGetActiveConnections.mockResolvedValue([]);
    const app = buildApp();

    const res = await request(app).get("/api/agents/connectors/catalog");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: "jira",
      provider: "jira",
      category: "project-management",
    });
  });
});

describe("MCP ACL — PUT /api/agents/:agentTokenId/permissions (grant-side ownership)", () => {
  const AGENT_TOKEN_ID = "agtok-1";

  // The agent whose permissions are being managed. Its creator (createdById)
  // is the granter under test, so the existing canManage gate passes and we
  // isolate the new mcp:-connection ownership check.
  function seedAgent(createdById: string) {
    agentTokensById[AGENT_TOKEN_ID] = {
      id: AGENT_TOKEN_ID,
      userId: "user-agent-1",
      createdById,
    };
  }

  it("non-owner non-admin granting an mcp: connection they do not own: 403, nothing wiped", async () => {
    currentSessionUser = { id: "granter", isAdmin: false };
    seedAgent("granter"); // granter controls the agent → canManage passes
    mcpConnectionRows = [{ id: "conn-x", createdBy: "someone-else" }];
    const app = buildApp();

    const res = await request(app)
      .put(`/api/agents/${AGENT_TOKEN_ID}/permissions`)
      .send({ permissions: [{ connectorId: "mcp:conn-x", allowedActions: ["*"] }] });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/mcp:conn-x/);
    // No partial wipe: deleteMany must not run when any grant is rejected.
    expect(prisma.connectorPermission.deleteMany as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.connectorPermission.create as jest.Mock).not.toHaveBeenCalled();
  });

  it("owner (non-admin) granting their own mcp: connection: 200 and the permission is created", async () => {
    currentSessionUser = { id: "owner", isAdmin: false };
    seedAgent("owner");
    mcpConnectionRows = [{ id: "conn-x", createdBy: "owner" }];
    const app = buildApp();

    const res = await request(app)
      .put(`/api/agents/${AGENT_TOKEN_ID}/permissions`)
      .send({
        permissions: [{ connectorId: "mcp:conn-x", allowedActions: ["read_data"] }],
      });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ connectorId: "mcp:conn-x" });
    expect(prisma.connectorPermission.deleteMany as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it("admin granting an mcp: connection owned by someone else: 200 (admins are not ownership-gated)", async () => {
    currentSessionUser = { id: "admin", isAdmin: true };
    seedAgent("someone-else"); // admin need not control the agent
    mcpConnectionRows = [{ id: "conn-x", createdBy: "someone-else" }];
    const app = buildApp();

    const res = await request(app)
      .put(`/api/agents/${AGENT_TOKEN_ID}/permissions`)
      .send({ permissions: [{ connectorId: "mcp:conn-x", allowedActions: ["*"] }] });

    expect(res.status).toBe(200);
    // The admin path skips the ownership lookup entirely.
    expect(prisma.mcpConnection.findMany as jest.Mock).not.toHaveBeenCalled();
  });

  it("granting an unknown mcp: connection id: 400 (typo guard, nothing wiped)", async () => {
    currentSessionUser = { id: "granter", isAdmin: false };
    seedAgent("granter");
    mcpConnectionRows = []; // referenced connection does not exist
    const app = buildApp();

    const res = await request(app)
      .put(`/api/agents/${AGENT_TOKEN_ID}/permissions`)
      .send({ permissions: [{ connectorId: "mcp:ghost", allowedActions: ["*"] }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown MCP connection/);
    expect(prisma.connectorPermission.deleteMany as jest.Mock).not.toHaveBeenCalled();
  });

  it("non-mcp connector grants are unaffected by the ownership check", async () => {
    currentSessionUser = { id: "granter", isAdmin: false };
    seedAgent("granter");
    mcpConnectionRows = [];
    const app = buildApp();

    const res = await request(app)
      .put(`/api/agents/${AGENT_TOKEN_ID}/permissions`)
      .send({
        permissions: [{ connectorId: "jira", allowedActions: ["create_ticket"] }],
      });

    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ connectorId: "jira" });
    // A pure non-mcp grant never triggers the McpConnection lookup.
    expect(prisma.mcpConnection.findMany as jest.Mock).not.toHaveBeenCalled();
  });

  it("multiple mcp: grants where one is not owned: 403, nothing wiped or created", async () => {
    // The precise scenario the up-front validation exists for: one owned and
    // one foreign mcp: grant in the same all-or-nothing replace.
    currentSessionUser = { id: "owner", isAdmin: false };
    seedAgent("owner");
    mcpConnectionRows = [
      { id: "conn-ok", createdBy: "owner" },
      { id: "conn-bad", createdBy: "someone-else" },
    ];
    const app = buildApp();

    const res = await request(app)
      .put(`/api/agents/${AGENT_TOKEN_ID}/permissions`)
      .send({
        permissions: [
          { connectorId: "mcp:conn-ok", allowedActions: ["*"] },
          { connectorId: "mcp:conn-bad", allowedActions: ["*"] },
        ],
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/mcp:conn-bad/);
    // The owned grant in the same body must NOT be applied.
    expect(prisma.connectorPermission.deleteMany as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.connectorPermission.create as jest.Mock).not.toHaveBeenCalled();
  });

  it("mixed mcp: + non-mcp array with an unauthorized mcp: grant: whole replace rejected, non-mcp grant not created", async () => {
    currentSessionUser = { id: "granter", isAdmin: false };
    seedAgent("granter");
    mcpConnectionRows = [{ id: "conn-x", createdBy: "someone-else" }];
    const app = buildApp();

    const res = await request(app)
      .put(`/api/agents/${AGENT_TOKEN_ID}/permissions`)
      .send({
        permissions: [
          { connectorId: "jira", allowedActions: ["create_ticket"] },
          { connectorId: "mcp:conn-x", allowedActions: ["*"] },
        ],
      });

    expect(res.status).toBe(403);
    expect(prisma.connectorPermission.deleteMany as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.connectorPermission.create as jest.Mock).not.toHaveBeenCalled();
  });

  it("mixed mcp: + non-mcp array with an owned mcp: grant: 200, both rows created", async () => {
    currentSessionUser = { id: "owner", isAdmin: false };
    seedAgent("owner");
    mcpConnectionRows = [{ id: "conn-x", createdBy: "owner" }];
    const app = buildApp();

    const res = await request(app)
      .put(`/api/agents/${AGENT_TOKEN_ID}/permissions`)
      .send({
        permissions: [
          { connectorId: "jira", allowedActions: ["create_ticket"] },
          { connectorId: "mcp:conn-x", allowedActions: ["read_data"] },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    const ids = res.body.items
      .map((i: { connectorId: string }) => i.connectorId)
      .sort();
    expect(ids).toEqual(["jira", "mcp:conn-x"]);
    expect(prisma.connectorPermission.create as jest.Mock).toHaveBeenCalledTimes(2);
  });

  // Regression A: null / non-object entries in permissions must be skipped
  // without causing a 500. Under the old non-transactional code, `null.connectorId`
  // throws AFTER deleteMany already wiped existing permissions.
  it("null and non-object entries are skipped and do not cause a 500 (regression A)", async () => {
    currentSessionUser = { id: "granter", isAdmin: false };
    seedAgent("granter");
    // No mcp: connectors, so the ownership check is bypassed.
    const app = buildApp();

    const res = await request(app)
      .put(`/api/agents/${AGENT_TOKEN_ID}/permissions`)
      .send({
        permissions: [
          { connectorId: "github", allowedActions: ["read"] },
          null,
          "x",
          {},
          { connectorId: "", allowedActions: ["read"] },
          { connectorId: "   ", allowedActions: ["read"] },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ connectorId: "github" });
    expect(prisma.connectorPermission.create as jest.Mock).toHaveBeenCalledTimes(1);
  });

  // Regression B: a mid-loop create failure inside $transaction must roll back
  // the deleteMany wipe so the original permissions are preserved.
  it("create failure inside transaction rolls back the deleteMany wipe (regression B)", async () => {
    currentSessionUser = { id: "granter", isAdmin: false };
    seedAgent("granter");
    // Seed an existing permission for the agent's userId before the request.
    connectorPermissions.push({
      connectorId: "existing-connector",
      userId: "user-agent-1",
      allowedActions: ["read"],
    });
    // Make create throw on the first call so the transaction fails mid-loop.
    (prisma.connectorPermission.create as jest.Mock).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const app = buildApp();

    const res = await request(app)
      .put(`/api/agents/${AGENT_TOKEN_ID}/permissions`)
      .send({
        permissions: [{ connectorId: "github", allowedActions: ["read"] }],
      });

    expect(res.status).toBe(500);
    // The original row must be restored by the $transaction rollback.
    expect(connectorPermissions).toHaveLength(1);
    expect(connectorPermissions[0]).toMatchObject({
      connectorId: "existing-connector",
      userId: "user-agent-1",
    });
  });
});
