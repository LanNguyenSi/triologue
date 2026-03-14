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
    }).catch(() => {});
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
