# Log

<!-- Add new entries at the top, newest first. -->

- 2026-09-23T09:55:07Z, self-deletion closes the six remaining RESTRICT
  foreign keys to users (task eb405d43, batch 62, decision D-001):
  `agent_tokens.createdById`, `integration_tokens.createdBy`,
  `connector_permissions.userId` and `mcp_connections.createdBy` are
  deleted outright in the same `DELETE /me` transaction (credential-like,
  FKs stay RESTRICT); `invite_codes.createdById` and
  `approval_request.requestedBy` get a nullable/`onDelete: SetNull` schema
  change instead (migration
  `20260923094230_self_delete_restrict_fks_invite_and_approval`), with an
  unused invite / pending approval deleted and a used invite / decided
  approval kept, FK nulled. `prisma-data-model-invariants.md`'s Invariant 6
  residual updated to describe the closure; `approvals-lifecycle.md`'s
  "only requestedBy is relationally guaranteed" claim narrowed to pending
  requests. Every schema.prisma citation in `agent-integration-surfaces.md`,
  `auth-and-authz-boundaries.md`, `mcp-tool-acl.md` and
  `room-message-lifecycle.md` shifted by +4 or +8 lines from the two new
  doc comments ahead of the changed relations and is re-pointed.

- 2026-09-23T07:20:00Z, AgentAuditLog anonymisation on self-deletion (task
  6bc2a14c): `DELETE /api/auth/me` no longer 500s (Postgres's default
  blocking foreign-key action) for a user who ever caused an
  `agent_audit_log` row to be written. `AgentAuditLog.agentId` is now
  nullable with `onDelete: SetNull` (migration
  `20260923045824_agent_audit_log_agentid_nullable_setnull`), so the row
  survives, anonymised. The route's delete runs as a batch
  `prisma.$transaction([...])` (not an interactive `(tx) => {...}`
  callback, whose default 5s timeout a heavy account's cascade could
  otherwise exceed), first taking a `SELECT ... FOR UPDATE` lock on the
  user row -- closing the race where an audit row written BY this user
  (`agentId` FK) could otherwise still be inserted between the scrub
  statements and the delete, but NOT the symmetric race on the other
  scrub statement below: another, still-present actor's late
  `task.update` audit row naming this user's id in
  `details.assignedTo` has no FK to lock against and can still land
  after the scrub runs, unscrubbed (covered by GDPR inventory task
  `75fac3fe`, not closed here) -- then scrubbing
  `agent_audit_log.details`: JSON `null` on every row this user wrote,
  and the `assignedTo` key removed from any other still-present user's
  row that names this user's id. See
  `prisma-data-model-invariants.md`'s Invariant 6 for the full enumeration
  and its explicit residual: text this user typed into a resource that a
  DIFFERENT actor's own audit row copied in (for example an attachment
  filename) is NOT scrubbed by this task, tracked as GDPR inventory task
  `75fac3fe`. The route's `catch` block distinguishes a known Prisma
  constraint failure (`409`, code in the body) from an unexpected error
  (`500`), and writes the Prisma code or the error's own message into the
  log call's MESSAGE string itself, not a second metadata-object argument
  that `utils/logger.ts`'s `winston.format.printf` silently drops from
  every written line. Every citation into `server/src/routes/auth.ts`
  across this bundle's docs that list it as a source (this doc,
  `agent-integration-surfaces.md`, `auth-and-authz-boundaries.md`) was
  re-verified against the file's actual current content, not assumed from
  line-count arithmetic; the docs whose only listed source touched by this
  task was `schema.prisma` (`approvals-lifecycle.md`, `mcp-tool-acl.md`) or
  `schema.prisma` plus an unshifted `projects.ts` range
  (`room-message-lifecycle.md`) needed no citation changes, only
  re-verification and a re-stamp. `npx okf-kit@0.10.0 check docs/okf --json`
  on the committed tree at this entry's own commit reports 0 errors / 0
  warnings / 0 notices; with `--require-anchors` it reports the same
  pre-existing unanchored-citation count as the 2026-09-21 sweep plus this
  entry's own unanchored citations, unconverted here, consistent with that
  sweep's note that the unanchored style is pre-existing and bundle-wide.

- 2026-09-21T04:45:00Z, six-warnings sweep (task e83579ea): `okf-kit check
  docs/okf` reported 0 errors / 6 warnings at triologue master 24a18c8
  (five `sources-fresh` on agent-integration-surfaces.md,
  auth-and-authz-boundaries.md, prisma-data-model-invariants.md and
  room-message-lifecycle.md; one `citations-resolve` range-exceeds-file
  on auth-and-authz-boundaries.md). All five stale warnings traced to
  the same source commit, 04dbeb4 (fix(server): centralize upload MIME
  allowlist, #243, 2026-09-14), which reshaped
  server/src/routes/projects.ts, server/src/routes/upload.ts and
  server/src/utils/validation.ts (deleted the unused `fileSchemas`
  export, moved MIME-allowlist logic into a new
  server/src/utils/uploadMimeTypes.ts). Read `git show 04dbeb4` in full
  for the three files plus every citation each doc makes into them; no
  doc cited the removed `fileSchemas` object and the MIME set the
  allowlist accepts is unchanged (only centralized), so no doc's prose
  needed a content correction. Six citations across the four docs had
  silently drifted to the wrong lines (still in-bounds except the one
  `citations-resolve` hit) and were re-pointed after reading the target
  lines at head: auth-and-authz-boundaries.md's `validate()` middleware
  citation, previously into validation.ts lines 190 through 209
  (assignment on line 208), re-pointed to lines 157 through 178
  (assignment on line 175);
  prisma-data-model-invariants.md's projects.ts 4-value AI_* list
  (1534 -> 1524), CORE_TASK_STATUSES block (21-30 -> 26-35), and
  in_review/in_progress comparisons (2224/2257 -> 2216/2249);
  room-message-lifecycle.md's CORE_TASK_STATUSES block (21-30 -> 26-35);
  agent-integration-surfaces.md's createMentionInboxItems-for-captions
  citation (upload.ts:164 -> :156). `okf-kit check --json docs/okf`
  went from 0/6/0 to 0/0/0 on the committed tree. With
  `--require-anchors` the same check reports 225 warnings at 24a18c8
  (219 for unanchored citations plus the six above) and 219 after this
  pass: the unanchored-citation style is pre-existing, bundle-wide and
  was not converted here.

- 2026-09-02T04:52:10Z, okf-kit CI pin bump 0.6.0 -> 0.9.0 (fleet parity,
  task 44ee799a): re-verified every bundle finding before bumping the pin.
  auth-and-authz-boundaries.md's `sources` list carries both
  server/src/middleware/auth.ts and server/src/routes/auth.ts, so every
  bare auth.ts citation in the doc's prose was ambiguous under
  `citations-resolve`'s exact-suffix source match; re-pointed each one to
  either middleware/auth.ts or routes/auth.ts per which file the cited
  line actually lives in (both files' content was re-opened and confirmed
  unchanged at every cited range, no drift beyond the ambiguity itself).
  agent-integration-surfaces.md's gateway-config citation (the
  webhookUrl/webhookSecret/delivery export in agents.ts) had drifted to a
  blank line; the export now lives 42 lines earlier in the same file,
  content confirmed, re-pointed. approvals-lifecycle.md's citation of the
  403-before-409 ordering test in approvals.test.ts started on a blank
  line; the describe block itself starts one line later and ends one line
  earlier than the old range, re-pointed. This log's own prior entry
  (2026-08-22T04:57:09Z, below) named a historical line range in
  approvals.ts as a citation; that range's start line is now a bare
  closing brace of an unrelated interface after later edits, so the
  historical mention was reworded out of citation-shaped syntax (plain
  "lines" prose) rather than re-pointed, since it was never meant to cite
  present-day code. room-message-lifecycle.md had gone STALE
  (client/src/pages/ProjectEditPage.tsx changed 2026-08-27, an i18n-key
  slice unrelated to this doc's claim); re-verified the milestone-status
  literal "done" is still there, twelve lines later than the doc's old
  citation, re-pointed and restamped. `okf-kit check --json docs/okf`
  went from 0 errors / 4 warnings / 11 notices to 0/0/0 on the committed
  tree. CI pin bumped to okf-kit@0.9.0 (measured: 0.8.0
  and 0.9.0 report identical findings on this bundle).

- 2026-08-22T04:57:09Z, reviewer follow-up on the docs-freshness pass (task
  dcef57d0): auth-and-authz-boundaries.md had one drifted citation the
  earlier restamp missed (POST /api/agents cited as agents.ts:644, a comment
  inside the create transaction; the route is at agents.ts:546) plus an
  imprecise entitlement-check range in approvals.ts (previously lines 50-69,
  tightened to lines 63-86, which is where isAdmin and the unscoped-admin-only
  check actually live);
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
