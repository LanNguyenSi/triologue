/**
 * Triologue's HTTP MCP client. Sends JSON-RPC POST against an
 * `McpConnection.url` with a Bearer token, parses the standard
 * MCP `tools/list` and `tools/call` result shapes, and stores the
 * discovered tool list back on the connection row.
 *
 * Reference remote target: the agent-tasks backend exposes a
 * stateless Streamable-HTTP MCP endpoint at `/api/mcp` with the
 * same 12 tools the stdio @agent-tasks/mcp-server package wraps.
 * Register it via the seed helper `upsertAgentTasksMcpConnection`
 * in `prisma/seed.ts` (env-driven, opt-in via
 * AGENT_TASKS_MCP_TOKEN). The discoverTools / callTool code in
 * this file works against /api/mcp without modification — that
 * was the entire point of the agent-tasks side delivering an HTTP
 * peer of its stdio package.
 */
import { logger } from '../../utils/logger';
import prisma from '../../lib/prisma';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  success: boolean;
  content: unknown;
  error?: string;
}

export async function discoverTools(connectionId: string): Promise<McpTool[]> {
  const conn = await (prisma as any).mcpConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn) throw new Error('MCP connection not found');

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (conn.apiKey) headers['Authorization'] = `Bearer ${conn.apiKey}`;

    const res = await fetch(conn.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    });

    if (!res.ok) throw new Error(`MCP server responded with ${res.status}`);
    const data: any = await res.json();
    const tools: McpTool[] = (data.result?.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || {},
    }));

    await (prisma as any).mcpConnection.update({
      where: { id: connectionId },
      data: {
        discoveredTools: tools as any,
        status: 'active',
        lastHealthCheck: new Date(),
      },
    });

    logger.info(`[mcp] Discovered ${tools.length} tools from ${conn.name}`);
    return tools;
  } catch (err) {
    logger.error(`[mcp] Discovery failed for ${conn.name}:`, err);
    await (prisma as any).mcpConnection.update({
      where: { id: connectionId },
      data: { status: 'error', lastHealthCheck: new Date() },
    }).catch(() => { /* no-op: best-effort status update; must not shadow the original error that is re-thrown below */ });
    throw err;
  }
}

export async function callTool(connectionId: string, toolName: string, args: Record<string, unknown>): Promise<McpCallResult> {
  const conn = await (prisma as any).mcpConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn) return { success: false, content: null, error: 'MCP connection not found' };
  if (conn.status !== 'active') return { success: false, content: null, error: `MCP connection status: ${conn.status}` };

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (conn.apiKey) headers['Authorization'] = `Bearer ${conn.apiKey}`;

    const res = await fetch(conn.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });

    if (!res.ok) {
      return { success: false, content: null, error: `MCP server error: ${res.status}` };
    }

    const data: any = await res.json();
    if (data.error) {
      return { success: false, content: null, error: data.error.message || 'MCP call failed' };
    }

    return { success: true, content: data.result?.content || data.result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, content: null, error: message };
  }
}

export async function getActiveConnections(): Promise<Array<{ id: string; name: string; tools: McpTool[] }>> {
  const connections = await (prisma as any).mcpConnection.findMany({
    where: { status: 'active' },
    select: { id: true, name: true, discoveredTools: true },
  });
  return connections.map((c: any) => ({
    id: c.id,
    name: c.name,
    tools: Array.isArray(c.discoveredTools) ? c.discoveredTools : [],
  }));
}
