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

const agentTokens: Record<string, AgentTokenRow> = {};

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    agentToken: {
      findUnique: jest.fn(async ({ where }: any) => {
        return agentTokens[where.token] ?? null;
      }),
    },
  },
  prisma: {
    agentToken: {
      findUnique: jest.fn(async ({ where }: any) => {
        return agentTokens[where.token] ?? null;
      }),
    },
  },
}));

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
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: "user-human-1", isAdmin: false };
    next();
  },
  requireAdmin: (req: any, _res: any, next: any) => next(),
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
const ACTIVE_CONN = {
  id: "conn-1",
  name: "agent-tasks",
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

beforeEach(() => {
  for (const k of Object.keys(agentTokens)) delete agentTokens[k];
  agentTokens[VALID_TOKEN] = {
    userId: "user-agent-1",
    status: "active",
    isActive: true,
    agentUser: { id: "user-agent-1", isActive: true, displayName: "Test Agent" },
  };
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
    expect(res.body.tools.map((t: any) => t.name).sort()).toEqual([
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

    const existing = res.body.items.find((i: any) => i.id === "jira");
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

    const mcpItem = res.body.items.find((i: any) => i.provider === "mcp");
    expect(mcpItem).toMatchObject({
      id: "mcp:conn-1",
      name: "agent-tasks",
      provider: "mcp",
      category: "mcp",
      status: "connected",
      scope: null,
      icon: null,
    });
    expect(mcpItem.actions.map((a: any) => a.id).sort()).toEqual([
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
