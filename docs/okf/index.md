# Knowledge bundle index

Curated OKF knowledge bundle for the triologue repo: cross-file semantics,
invariants, and integration facts that no single source file or existing doc
states on its own. The mature references one level up (`docs/`:
BYOA_SSE_ARCHITECTURE, mcp-agents, frontend-primitives, AGENT_MEMORY_USAGE,
PLUGIN_ARCHITECTURE) stay authoritative for their areas; these docs
deliberately do not duplicate them.

## Overview

- [MCP tool ACL](mcp-tool-acl.md), pointer to the authoritative
  `docs/mcp-agents.md` plus where the backing tables and enforcement code
  live.
- [Frontend UI primitives](frontend-primitives-adoption.md), pointer to the
  authoritative `docs/frontend-primitives.md` plus the primitive set and the
  open adoption-sweep task.

## Modules

- [Agent integration surfaces](agent-integration-surfaces.md), registration
  tiers, how a mention actually reaches an agent today (gateway, not
  webhooks), and the two-layer quota system.

## Invariants

- [Auth and authz boundaries](auth-and-authz-boundaries.md), one
  authenticate middleware serves both humans and byoa_ agent tokens; caller
  types are separated only by requireHuman/requireAdmin/requireAI and
  byoaAuth.
- [Approvals lifecycle](approvals-lifecycle.md), single creation path with
  task authorization before trust, human-only entitlement-gated decisions,
  and the known-open list-scoping gap.
- [Room and message lifecycle](room-message-lifecycle.md), two divergent
  message read paths, soft-delete asymmetry, membership gating, and the
  tracked status-literal drift bug.
- [Prisma data-model invariants](prisma-data-model-invariants.md),
  deprecated enum values, string-literal statuses with no shared constants,
  free-string scopes, and unconstrained taskId references.
