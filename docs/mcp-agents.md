# MCP tool access for BYOA agents

BYOA agents can discover and invoke tools from admin-registered MCP connections
via two endpoints:

- `GET  /api/agents/mcp/tools` — list tools across all `active` MCP connections.
- `POST /api/agents/mcp/call` — invoke `{ connectionId, tool, arguments }`.

Both require a `Bearer byoa_<token>` for an active agent. The `tool` name is
validated against the connection's discovered tool list before forwarding, so
an agent cannot invent tools.

## Audit coverage

Every authenticated `POST /mcp/call` — success, upstream failure (502),
unknown tool (400), connection-not-found (404), and handler exceptions (500)
— writes an `AgentAuditLog` row. Auth-failure paths (no token, wrong prefix,
unknown or deactivated agent) intentionally do **not** produce audit rows:
we have no trusted `agentId` to attribute them to. If you are hunting for
missing audit entries, start with server logs for 401/403 rather than the
audit table.

## Known limitation: no per-connection ACL

There is no per-connection authorization today. Any active BYOA agent can reach
any active MCP connection. This is accepted for now because:

1. MCP connections are admin-only — created via seed or admin UI, not by
   regular users or agents.
2. The connection's upstream token (`McpConnection.apiKey`) is the real gate
   for what the connected system exposes.
3. Every `POST /mcp/call` is written to `AgentAuditLog` with `agentId`,
   `action: "mcp.call"`, `resourceType: "mcp_tool"`, `resourceId: <tool>`,
   `details: { connectionId, connectionName }`, plus `success` and
   `durationMs`. That gives a post-hoc audit trail even without preventive
   ACLs.

If per-agent scoping becomes necessary (e.g. when non-admins can register
connections, or when a single tenant has multiple agents with different
trust levels), the planned approach is an `AgentConnectionPermission` table
keyed on `(agentTokenId, mcpConnectionId)` checked in both endpoints before
listing or calling. Tracked under the triologue project in agent-tasks.
