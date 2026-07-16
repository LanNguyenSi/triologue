# Log

<!-- Add new entries at the top, newest first. -->

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
