# MCP tool access for BYOA agents

BYOA agents can discover and invoke tools from registered MCP connections
via two endpoints:

- `GET  /api/agents/mcp/tools` — list tools across all `active` MCP connections.
- `POST /api/agents/mcp/call` — invoke `{ connectionId, tool, arguments }`.

Both require a `Bearer byoa_<token>` for an active agent. The `tool` name is
validated against the connection's discovered tool list before forwarding, so
an agent cannot invent tools.

## Registering a connection

No API route creates a connection. The database seed creates one connection
named `agent-tasks` when `AGENT_TASKS_MCP_TOKEN` is set (used as the bearer for
the upstream server); `AGENT_TASKS_MCP_URL` overrides its URL (see
[environment.md](environment.md)). Re-running the seed updates the URL, token
and transport of the existing row. The row is owned by the admin user named in
`ADMIN_USERNAME`, so it is open to every active agent (see the ACL below).

A connection has the status `pending`, `active` or `error`, and only `active`
connections can be called. A health check every 5 minutes re-discovers the
tools of `active` and `error` connections and sets the status to `active` or
`error`.

## Managing connections (admin)

There is no self-service route for MCP connections; administrators manage them
through three routes, each behind `authenticate`, `requireHuman` and
`requireAdmin` (a human admin session; an admin-flagged agent token gets 403):

- `GET    /api/admin/mcp-connections`: list connections with their owner
  (`?ownerId=<userId>` filters). The `apiKey` is never returned, and the `url`
  is returned redacted: userinfo and fragment are dropped and query values are
  replaced (`?token=redacted`). The path and query parameter names are
  returned as stored, so a credential placed in the path or as a value-less
  query key is not redacted; store credentials in `apiKey` instead.
- `PATCH  /api/admin/mcp-connections/:id/owner` with `{ "newOwnerId": "<userId>" }`:
  transfer ownership. The new owner must be an active human admin (400
  otherwise; 404 for an unknown connection, an unknown user or a soft-deleted
  user). The response echoes `previousOwnerWasAdmin`.
- `DELETE /api/admin/mcp-connections/:id`: remove the connection. Bridge calls
  for the removed id answer "MCP connection not found", and the agents' permission
  grants for that connection (`mcp:<id>` rows) are deleted with it.

Both writes are audit-logged (`mcp_connection.owner.transferred`,
`mcp_connection.removed`). This is what resolves the `409 owns_mcp_connections`
that `DELETE /api/auth/me` returns while a user still owns connections. Because
the per-connection ACL below keys on whether the owner is an admin, transferring
a connection whose previous owner was not an admin to an admin makes it open to
every active agent; the response and the audit row record `previousOwnerWasAdmin`
for that case. The audit `details` carry the connection `name` (and
`previousOwnerWasAdmin` for a transfer) but no user id: the acting admin is the
row's `agentId` and the connection is its `resourceId`.

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

Callers: an admin or the human who created the agent (`403` otherwise; `404`
for an unknown agent). A non-admin can grant `mcp:<id>` only for a connection
they own. An unknown connection answers `400 Unknown MCP connection`, another
owner's connection `403`. All `mcp:` entries are checked before the existing set
is replaced, so a rejected call changes nothing. Entries with an empty
`connectorId` or empty `allowedActions` are skipped. The response is
`{ "items": [...] }` with the created rows. Read the current set with
`GET /api/agents/:agentTokenId/permissions` (same callers).

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
