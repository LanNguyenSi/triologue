/**
 * Helper that registers the agent-tasks HTTP MCP endpoint as an
 * `McpConnection` row from environment variables.
 *
 * Pulled into its own module (away from `prisma/seed.ts`) so unit
 * tests can import the helper without triggering the seed script's
 * top-level `main()` IIFE that wants a live Postgres.
 *
 * Usage in `prisma/seed.ts`:
 *
 * ```ts
 * import { upsertAgentTasksMcpConnection } from "../src/connectors/mcp/agentTasksSeed";
 * await upsertAgentTasksMcpConnection(prisma, process.env, admin.id);
 * ```
 */

/**
 * Minimal Prisma surface this helper needs. Typed loosely so the
 * unit test can pass an in-memory stub without dragging the full
 * generated PrismaClient type into the test file.
 */
export interface McpConnectionClient {
  mcpConnection: {
    findFirst: (args: { where: { name: string } }) => Promise<{ id: string } | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<{ id: string }>;
  };
}

export type SeedResult =
  | { kind: "skipped"; reason: string }
  | { kind: "created"; id: string; url: string }
  | { kind: "updated"; id: string; url: string };

/**
 * Idempotent. Reads:
 * - `AGENT_TASKS_MCP_TOKEN` — required. The agent token used as the
 *   Bearer credential the gateway forwards into agent-tasks. Missing
 *   or empty → skipped (so a fresh deploy without the integration
 *   configured still seeds cleanly).
 * - `AGENT_TASKS_MCP_URL` — optional. Defaults to
 *   `https://agent-tasks.opentriologue.ai/api/mcp`. Override for
 *   local / staging endpoints.
 *
 * Looks up the canonical row by `name = "agent-tasks"` (not
 * `@unique` in the schema, so `findFirst` + create-or-update
 * instead of `upsert`). Re-running the seed never duplicates the
 * row, and an existing row gets its url + apiKey + transport
 * refreshed without losing its `createdBy` owner.
 */
export async function upsertAgentTasksMcpConnection(
  client: McpConnectionClient,
  env: Record<string, string | undefined>,
  ownerUserId: string,
): Promise<SeedResult> {
  const token = env.AGENT_TASKS_MCP_TOKEN;
  if (!token || token.length === 0) {
    return { kind: "skipped", reason: "AGENT_TASKS_MCP_TOKEN not set" };
  }
  const url =
    env.AGENT_TASKS_MCP_URL && env.AGENT_TASKS_MCP_URL.length > 0
      ? env.AGENT_TASKS_MCP_URL
      : "https://agent-tasks.opentriologue.ai/api/mcp";

  const existing = await client.mcpConnection.findFirst({
    where: { name: "agent-tasks" },
  });

  if (existing) {
    await client.mcpConnection.update({
      where: { id: existing.id },
      data: { url, apiKey: token, transport: "http" },
    });
    return { kind: "updated", id: existing.id, url };
  }

  const created = await client.mcpConnection.create({
    data: {
      name: "agent-tasks",
      url,
      apiKey: token,
      transport: "http",
      status: "pending",
      createdBy: ownerUserId,
    },
  });
  return { kind: "created", id: created.id, url };
}
