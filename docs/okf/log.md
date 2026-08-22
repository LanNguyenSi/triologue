# Log

<!-- Add new entries at the top, newest first. -->

- 2026-08-22T04:57:09Z, reviewer follow-up on the docs-freshness pass (task
  dcef57d0): auth-and-authz-boundaries.md had one drifted citation the
  earlier restamp missed (POST /api/agents cited as agents.ts:644, a comment
  inside the create transaction; the route is at agents.ts:546) plus an
  imprecise entitlement-check range (approvals.ts:50-69 tightened to :63-86,
  which is where isAdmin and the unscoped-admin-only check actually live);
  every other file:NNN citation in that doc was re-measured and confirmed
  correct. frontend-primitives-adoption.md had gone STALE (its source
  docs/frontend-primitives.md changed on this branch); re-verified the
  primitive set against client/src/components/ui/primitives/index.ts
  (unchanged: Badge, Button, Card, EmptyState, Input, SectionHeader, Select)
  and restamped.

- 2026-08-22T04:46:20Z, docs-freshness audit follow-up (task dcef57d0): the
  2026-07-16 sweep had fixed the doc bodies for 946fa940 and 19e744b4 but
  left the approvals-lifecycle.md frontmatter/H1 and room-message-lifecycle.md
  frontmatter still calling them open; both now say closed with PR
  references. index.md's approvals summary line updated to match. Three
  auth-and-authz-boundaries.md line citations refreshed (agents.ts 628→586,
  646→604; approvals.ts 118→154).

- 2026-07-16T02:42:25Z, re-verification sweep (task de185997): 6 stale docs re-checked
  against current sources. Substantive: three security/bug claims this
  bundle carried as KNOWN-OPEN are fixed on master and now documented as
  closed (946fa940 approvals read-scoping via PR #180, 0bc4f108
  register userType guard via PR #181, 19e744b4 rooms.ts 'DONE' casing
  via PR #184); redis-hardening non-blocking cache noted (PR #192);
  the rest is citation drift re-confirmed at source.

- 2026-07-16T01:03:30Z, CI now watches staleness: warn-only
  `okf-kit check` on every PR (.github/workflows/okf-staleness.yml,
  canonical pattern from harness#350).
- 2026-07-09T03:34:19.437907Z, initial 7 docs authored and verified against
  sources at master c0520e2 (triologue 0.4.0): auth-and-authz-boundaries,
  approvals-lifecycle, room-message-lifecycle, agent-integration-surfaces,
  prisma-data-model-invariants, mcp-tool-acl (pointer),
  frontend-primitives-adoption (pointer).
- 2026-07-09T03:34:05Z, bundle scaffolded by `okf-kit init`.
