/**
 * Unit tests for the agent-tasks McpConnection seed helper.
 *
 * Pure function tests against an in-memory Prisma stub — no real
 * database, no migration, no live HTTP. The integration round-trip
 * (discoverTools + callTool against the live /api/mcp endpoint)
 * lives in `agent-tasks-mcp-live.test.ts` and is gated behind
 * the AGENT_TASKS_MCP_TEST_URL env var so this fast unit suite
 * stays runnable without a server.
 */
import {
  upsertAgentTasksMcpConnection,
  type McpConnectionClient,
} from "../connectors/mcp/agentTasksSeed";

interface FakeRow {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  transport: string;
  status: string;
  createdBy: string;
}

function makeFakeClient(initial: FakeRow[] = []): {
  client: McpConnectionClient;
  rows: FakeRow[];
  calls: { create: number; update: number; findFirst: number };
} {
  const rows: FakeRow[] = [...initial];
  const calls = { create: 0, update: 0, findFirst: 0 };

  const client: McpConnectionClient = {
    mcpConnection: {
      async findFirst({ where }) {
        calls.findFirst++;
        return rows.find((r) => r.name === where.name) ?? null;
      },
      async create({ data }) {
        calls.create++;
        const row: FakeRow = {
          id: `cuid-${rows.length + 1}`,
          name: data.name as string,
          url: data.url as string,
          apiKey: data.apiKey as string,
          transport: data.transport as string,
          status: data.status as string,
          createdBy: data.createdBy as string,
        };
        rows.push(row);
        return { id: row.id };
      },
      async update({ where, data }) {
        calls.update++;
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error(`row not found: ${where.id}`);
        Object.assign(row, data);
        return { id: row.id };
      },
    },
  };
  return { client, rows, calls };
}

describe("upsertAgentTasksMcpConnection", () => {
  it("skips with a clear reason when AGENT_TASKS_MCP_TOKEN is unset", async () => {
    const { client, calls } = makeFakeClient();
    const result = await upsertAgentTasksMcpConnection(client, {}, "admin-1");
    expect(result).toEqual({
      kind: "skipped",
      reason: "AGENT_TASKS_MCP_TOKEN not set",
    });
    expect(calls.findFirst).toBe(0);
    expect(calls.create).toBe(0);
    expect(calls.update).toBe(0);
  });

  it("skips when the token env var is the empty string", async () => {
    const { client } = makeFakeClient();
    const result = await upsertAgentTasksMcpConnection(
      client,
      { AGENT_TASKS_MCP_TOKEN: "" },
      "admin-1",
    );
    expect(result.kind).toBe("skipped");
    if (result.kind === "skipped") {
      expect(result.reason).toContain("not set");
    }
  });

  it("creates the row on first run with the canonical name + http transport", async () => {
    const { client, rows } = makeFakeClient();
    const result = await upsertAgentTasksMcpConnection(
      client,
      { AGENT_TASKS_MCP_TOKEN: "atk_xxx" },
      "admin-1",
    );
    expect(result.kind).toBe("created");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "agent-tasks",
      url: "https://agent-tasks.opentriologue.ai/api/mcp",
      apiKey: "atk_xxx",
      transport: "http",
      status: "pending",
      createdBy: "admin-1",
    });
  });

  it("honours an explicit AGENT_TASKS_MCP_URL override", async () => {
    const { client, rows } = makeFakeClient();
    await upsertAgentTasksMcpConnection(
      client,
      {
        AGENT_TASKS_MCP_TOKEN: "atk_xxx",
        AGENT_TASKS_MCP_URL: "http://localhost:3001/api/mcp",
      },
      "admin-1",
    );
    expect(rows[0].url).toBe("http://localhost:3001/api/mcp");
  });

  it("updates an existing row in place instead of creating a duplicate", async () => {
    const seed: FakeRow = {
      id: "cuid-existing",
      name: "agent-tasks",
      url: "http://old.example/api/mcp",
      apiKey: "atk_old",
      transport: "sse",
      status: "active",
      createdBy: "admin-1",
    };
    const { client, rows, calls } = makeFakeClient([seed]);
    const result = await upsertAgentTasksMcpConnection(
      client,
      { AGENT_TASKS_MCP_TOKEN: "atk_new" },
      "admin-2",
    );
    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.id).toBe("cuid-existing");
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "cuid-existing",
      apiKey: "atk_new",
      url: "https://agent-tasks.opentriologue.ai/api/mcp",
      transport: "http",
      // createdBy is intentionally NOT touched on update — first
      // creator stays the canonical owner.
      createdBy: "admin-1",
    });
    expect(calls.create).toBe(0);
    expect(calls.update).toBe(1);
  });
});
