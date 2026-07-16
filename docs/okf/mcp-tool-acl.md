---
type: overview
title: MCP tool ACL — where the rule is documented and where it is enforced
description: Pointer doc — the default-deny MCP ACL for BYOA agents is authoritatively documented in docs/mcp-agents.md; this entry only adds where the backing tables and enforcement code live so an agent lands in the right files.
tags: [mcp, acl, agents, connectors, pointer]
timestamp: 2026-07-16T02:42:25Z
sources:
  - docs/mcp-agents.md
  - server/prisma/schema.prisma
  - server/src/routes/agents.ts
---

# MCP tool ACL — pointer

The authoritative reference for the MCP tool ACL is
[../mcp-agents.md](../mcp-agents.md) (default-deny rule for non-admin
connections, `PUT /:agentTokenId/permissions` full-replace semantics, audit
coverage). It is current against master and deliberately NOT restated here —
one copy, no drift.

What that doc does not spell out, for code navigation:

- The two backing tables are `ConnectorPermission` (`server/prisma/schema.prisma:288`)
  and `McpConnection` (`server/prisma/schema.prisma:302`).
- The permission read/write surface for agent tokens lives in
  `server/src/routes/agents.ts` (grep `ConnectorPermission`); the endpoint
  behavior is pinned by `server/src/__tests__/agent-mcp-endpoints.test.ts`.
