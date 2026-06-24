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

## Per-connection authorization (ACL)

Access to MCP connections is controlled by the following default-deny rule:

- **Admin-created connections** (the connection's creator has `isAdmin === true`)
  are open to all active agents. This preserves the trusted, admin-seeded
  behavior for connections registered by operators.
- **All other (non-admin) connections** are **default-deny**: an agent may
  discover or call a tool only if there is a `ConnectorPermission` row for
  `{ userId: <agent.userId>, connectorId: "mcp:" + <connectionId> }` whose
  `allowedActions` contains the tool name or the wildcard `"*"`.

### Managing grants

Use `PUT /api/agents/:agentTokenId/permissions` to set an agent's connector
grants. The body is an envelope with a `permissions` array, and the call
**replaces the agent's entire permission set** across every connector (MCP and
non-MCP): any row not included in the array is removed, so always resend the
full set.

```json
{
  "permissions": [
    {
      "connectorId": "mcp:<connectionId>",
      "allowedActions": ["tool_a", "tool_b"]
    }
  ]
}
```

Pass `"allowedActions": ["*"]` to grant access to all current and future tools
on that connection.

### Visibility

`GET /api/agents/mcp/tools` is filtered to the permitted (connectionId, tool)
pairs for the calling agent. Connections that yield zero visible tools are
omitted entirely, so an agent cannot enumerate connections it has no access to.

### Audit coverage

Every authenticated `POST /mcp/call` — success, upstream failure (502),
unknown tool (400), connection-not-found (404), permission-denied (403), and
handler exceptions (500) — writes an `AgentAuditLog` row. Auth-failure paths
(no token, wrong prefix, unknown or deactivated agent) intentionally do **not**
produce audit rows: we have no trusted `agentId` to attribute them to. If you
are hunting for missing audit entries, start with server logs for 401/403
rather than the audit table.
