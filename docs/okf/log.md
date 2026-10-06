# Log

<!-- Add new entries at the top, newest first. -->

- 2026-10-06T09:28:38Z, self-delete upload cleanup batches its lookups (task c3d3ffb2). self-delete-data-retention.md:
  the Upload files item now states that the still-referenced lookup is one
  query per table for all collected files and that a failed lookup keeps every
  file; the guards, the literal LIKE-escaped match and the unlinked set are
  unchanged and the doc cites no line of routes/auth.ts, so no citation moves.
  Re-stamped after the source and test commits.
- 2026-10-05T14:15:11Z, files route dead lookup removed (task 5748ead0). agent-integration-surfaces.md:
  `resolveUserId` in routes/files.ts lost its unreachable second
  `findAgentTokenByRawToken` call (a `byoa_` bearer already returns in the first
  branch), so the files route is now one lookup site, cited as routes/files.ts:119
  instead of :119, 134. No other citation of files.ts exists in the bundle; the
  doc is re-stamped after the source commit. approvals-lifecycle.md,
  mcp-tool-acl.md, prisma-data-model-invariants.md and
  self-delete-data-retention.md are re-stamped because their listed test
  sources only swapped the supertest import for the shared loopback helper;
  their claims were re-read and none is affected (the approvals.test.ts:274-293
  citation does not move, the import swap keeps the line count). Re-stamped again after the rebase onto the webhookSecret redaction, whose doc edits do not touch these claims.
- 2026-10-05T14:00:53Z, agent listings redact webhookSecret (task 882acf00).
  agent-integration-surfaces.md: the listing-redaction paragraph now lists
  `webhookSecret` among the redacted fields, adds the `hasWebhookSecret` flag,
  and drops the "listings still return webhookSecret" sentence; its two
  services/agentTokenRotation.ts citations move (`redactAgentTokenRow` :158 to
  :160, `AGENT_TOKEN_SECRET_FIELDS` :143 to :144); the other citations to that
  file (:30, :45, :61, :97) sit above the edit and are unchanged. agents.ts is
  not edited, so its citations hold. auth-and-authz-boundaries.md is
  re-stamped because services/agentTokenRotation.ts changed; mcp-tool-acl.md
  and prisma-data-model-invariants.md do not list that file, they are
  re-stamped because their sources (routes/agents.ts, prisma/schema.prisma)
  changed in the token-rotate commit after their last stamp. Their claims were
  re-read and none is affected (the one services/agentTokenRotation.ts:61
  citation is unchanged).
- 2026-10-05T10:20:28Z, agent token rotation second review fix (task 6d3fe2ef). agent-integration-surfaces.md:
  the listing-redaction paragraph now says `redactAgentTokenRow` reads
  `AGENT_TOKEN_SECRET_FIELDS` at call time (token "[redacted]", every other
  listed field null), and its citation moves to services/agentTokenRotation.ts:158
  after the new type aliases; the list itself stays at :143. The revocation
  paragraph names the admin suspend (`PATCH /api/agents/:id` with
  `isActive: false`, agents.ts:966), which now nulls the previous-token slot.
  The agents.ts edit is a single changed line, so no other agents.ts citation
  moves. auth-and-authz-boundaries.md, mcp-tool-acl.md and
  prisma-data-model-invariants.md are re-stamped because agents.ts and
  services/agentTokenRotation.ts changed; their claims were re-read and none
  is affected (the one services/agentTokenRotation.ts:61 citation is unchanged).
- 2026-10-05T09:56:57Z, agent token rotation (task 6d3fe2ef). agent-integration-surfaces.md:
  new "Token rotation" section for `POST /api/agents/:id/token/rotate` (gateway
  token plus the agent's current token, compare-and-swap swap, grace window,
  the four bearer lookup sites that honour the previous token), the
  `previousToken` / `previousTokenExpiresAt` columns in the data-model
  paragraph, gateway-config now served through `authenticateGatewayCaller` and
  carrying the two fields; sources gain the lookup-site files and
  `services/agentTokenRotation.ts`. auth-and-authz-boundaries.md: the byoa
  branch resolves through `findAgentTokenByRawToken`, the rotate route named as
  the route that skips `authenticate`. Citations in the five docs that cite
  the changed files were re-pointed against the base (`git diff -U0` hunk
  offsets, including the bare `:N` continuations): schema.prisma +2 lines
  after :262, agents.ts -11 after the gateway-config edit (+1 import above it),
  the lookup sites in byoaAuth.ts, middleware/auth.ts and proxy.ts shift by
  their import and `where` lines; the old gateway username check (agents.ts
  lines 492-499 before this change) now lives in the helper at
  agents.ts:2799-2804. Each moved anchor was spot-checked by comparing the base
  line with the new line. self-delete-data-retention.md cites no changed line;
  it is re-stamped because its schema.prisma source changed.
  Review fix round, same task: a scripted base-versus-head comparison of every
  changed number in the bundle (each pair checked against the `git diff -U0`
  line map of the cited file) found three errors in the first re-point. The
  HTTP status `409 AGENT_MENTION_KEY_TAKEN` in agent-integration-surfaces.md had
  been shifted as if it were a line number (read 410) and is 409 again; the
  `POST /api/agents` docblock range is 522-534, not the unshifted 533-545; and
  the bare continuations `(2316-2324)`, `(2339)` and `(2357)` in the outbound
  send paragraph were missed and are now 2305-2313, 2328 and 2346. The
  2026-08-22 entry below, which an earlier pass had edited, is restored to its
  original wording: history entries record what was true then and are never
  re-pointed. The rotate route citations moved again (agents.ts:2835-2899) when
  the agent-user active check, the docblock note and the CAS filter landed, and
  the doc gained the listing-redaction paragraph (`redactAgentTokenRow`).
  auth-and-authz-boundaries.md, mcp-tool-acl.md and
  prisma-data-model-invariants.md are re-stamped because agents.ts changed
  again; their claims were re-read against the new code and none is affected.
- 2026-10-05T08:06:17Z, self-deletion fix round (task 4654c296). self-delete-data-retention.md:
  GLOBAL-scope agent memory entries are kept (createdBy nulled) by operator
  decision, the explicit memory delete excludes them; the upload still-referenced
  check is stated as a literal suffix comparison; the audit residual names the
  reassignment rows. prisma-data-model-invariants.md: the `details.assignedTo`
  scrub names the `task.assignee_reassigned` rows as a second writer and extends
  the late-row race note, the GLOBAL exclusion is stated in the six-relations
  bullet, the `DELETE /me` citations are re-pointed (route 686-1063, scrub
  statements 847-860) after the helper and comment growth above them, and the
  agent-integration-surfaces.md call-site citation moved to 1002. The other
  docs listing auth.ts as a source (approvals-lifecycle, auth-and-authz-boundaries,
  mcp-tool-acl, room-message-lifecycle) cite only lines above 560, which did not
  move, and none of their claims names memory scope or the unlink check, so they
  are re-stamped without a text change.

- 2026-10-05T07:38:24Z, self-deletion no longer cascades into other owners' projects (task
  4654c296). self-delete-data-retention.md: the six creator relations moved
  from Removed to Anonymised (SetNull), the project-less memory entry delete,
  the assignee reassignment with its audit row and the post-commit upload
  unlink are stated, `tasks.assignedTo` left Kept, Upload files rewritten, the
  new DB test file added to sources. prisma-data-model-invariants.md: the
  Invariant 6 claim that a task or run cascade-deletes with its creator is
  narrowed to the user's own projects, a bullet for the six SetNull relations
  added, the `DELETE /me` citations re-pointed to the shifted lines (the
  route moved down by the new upload helper; nothing above line 560 of
  auth.ts moved). agent-integration-surfaces.md: the `removeMentionLimitEntry`
  call-site citation re-pointed. approvals-lifecycle.md,
  auth-and-authz-boundaries.md, mcp-tool-acl.md and room-message-lifecycle.md
  list auth.ts or schema.prisma as a source; their citations resolve at the
  recorded lines (no line count changed in schema.prisma, nothing above line
  560 of auth.ts moved) and none of their claims names the six relations, so
  they are re-stamped without a text change.

- 2026-10-05T06:11:18Z, agent-integration-surfaces.md re-verified against current
  sources after 789b8e7 (self-deletion removes the mention-limit entry) and
  8cbfb53 (docs/mcp-agents.md): every citation (mentionLimiter.ts, schema.prisma,
  agents.ts, socketService.ts, inboxService.ts, byoaAuth.ts, upload.ts, batch.ts,
  auth.ts) still resolved at its recorded line, so no citation was re-numbered,
  and no claim was found untrue; the quota section's self-deletion sentence said
  only 'at the end of the file', and now cites `removeMentionLimitEntry`
  (mentionLimiter.ts:148-161) at its call site
  `server/src/routes/auth.ts:858`; the doc points at `docs/mcp-agents.md` as a
  whole (no section), so the removed duplicate Audit coverage section there
  affects no claim here; server/src/routes/auth.ts (already cited) joins the
  doc's sources; restamped.

- 2026-10-04T13:51:06Z, docs/mcp-agents.md lost its outdated duplicate Audit coverage
  section (the current one, including 403, remains). mcp-tool-acl.md
  re-checked: its pointer to audit coverage still holds and its schema
  anchors (ConnectorPermission, McpConnection) still resolve; restamped.
  agent-integration-surfaces.md re-checked with no claim affected, left
  unstamped because its other sources carry pre-existing staleness.

- 2026-10-03T12:12:29Z, okf-staleness workflow re-synced from the okf-kit
  workflow template (fleet convergence ticket fdc01728): the workflow header
  now names the template as its source instead of calling the file a pattern
  to keep in sync, the pin moved from okf-kit@0.10.0 to okf-kit@0.16.0,
  `--require-anchors` joined the invocation, and the job stays warn-only.
  Measured on the tree before the change with `okf-kit check --json <bundle>`:
  at okf-kit@0.10.0, 0 errors, 4 warnings, 0 notices (exit 0) plain and 0
  errors, 236 warnings, 0 notices (exit 0) with `--require-anchors`; at
  okf-kit@0.16.0, 0 errors, 4 warnings, 0 notices (exit 0) plain and 0 errors,
  236 warnings, 0 notices (exit 0) with `--require-anchors`. Of the
  anchored-run warnings, 232 are anchor-required findings (full citations
  without an anchor); anchoring them is separate work and none of them blocks
  anything.

- 2026-09-30T13:01:47Z, task 75fac3fe: `self-delete-data-retention.md` keeps the deletion-time-only note below the Anonymised list and widens the kept-note row to codes this user neither created nor redeemed as a single-use code; `prisma-data-model-invariants.md` puts the admin MCP-connection audit bullet back after the different-actor text class and says which class it concerns. The scrub test now pins the single-use boundary (a two-use code keeps its note). Re-stamped.

- 2026-09-30T12:42:25Z, task 75fac3fe: `prisma-data-model-invariants.md` re-checked after merging the admin MCP-connection routes (task 18620b53) with the self-delete scrubs: the admin audit bullet, the `McpConnection.createdBy` paragraph and the verified-by list carry both changes, and `server/src/routes/admin.ts` and its test match them. Re-stamped.

- 2026-09-30T12:26:19Z, task 18620b53: `docs/mcp-agents.md` now states exactly which url parts the admin MCP-connection routes redact (userinfo, fragment, query values; path and parameter names returned as stored). `mcp-tool-acl.md` and `agent-integration-surfaces.md`, which list that doc, re-checked (no claim affected) and re-stamped.

- 2026-09-30T12:25:10Z, task 75fac3fe: `DELETE /api/auth/me` now scrubs the
  plain-string references it used to keep (invite code redeemer and note,
  approval decider and note, task reviewer, project team and agent sharing
  arrays) and deletes the inbox items the user triggered in other inboxes, in
  the same transaction, and removes the user's mention-limits entry after the
  commit. The unused-invite-code delete keys on `useCount` (a code whose
  redeemer deleted first stays a used code), and the note of a multi-use code
  another user created is kept when this user only redeemed it. New doc
  `self-delete-data-retention.md` states what the route removes, anonymises
  and keeps, with the items still under review named as such and the note that
  the scrubs of columns without a foreign key act at deletion time only.
  `prisma-data-model-invariants.md` re-verified: the route's line citations
  were re-mapped, the "tracked separately" statements now point to the new
  doc, and the claim that used invite codes and decided approvals are an audit
  of who acted was corrected (the same correction was made to the comments on
  `InviteCode` and `ApprovalRequest` in `schema.prisma`, comment-only, line
  numbers unchanged). `agent-integration-surfaces.md` gained the
  mention-limits cleanup; its `mentionLimiter.ts` citations are unchanged
  because the helper was appended at the end of the file.
  `auth-and-authz-boundaries.md`, `agent-integration-surfaces.md` and
  `prisma-data-model-invariants.md` had their `routes/auth.ts` citations
  shifted by the added lines and re-checked against the current lines;
  `approvals-lifecycle.md` lists `routes/auth.ts` under `sources` and its
  claims about pending and decided approvals still hold. `mcp-tool-acl.md` and
  `room-message-lifecycle.md` list `schema.prisma` under `sources` and cite no
  line of the edited comments. All re-stamped.

- 2026-09-30T11:57:52Z, task 18620b53 (review fixes): the admin MCP-connection audit calls no longer
  put a user id in `details` (name and `previousOwnerWasAdmin` only), so
  `prisma-data-model-invariants.md` now states that these calls fall outside
  the "user id in a different actor's row" class instead of handing the keys
  to task `75fac3fe`. Removal also deletes the connection's `mcp:<id>`
  permission rows and admin responses redact the url; `docs/mcp-agents.md`
  says so, and `mcp-tool-acl.md` and `agent-integration-surfaces.md`
  (which list that doc) were re-checked, still accurate, and re-stamped.

- 2026-09-30T11:49:10Z, task a47b6fd9: `prisma-data-model-invariants.md` re-verified against the changes that record DRIFT only when the diff output carries diff markers and keep the prisma error code on ERROR, and that name the status file as the durable signal (the cron log line is optional and has no known reader; the health dashboard is the natural reader). Re-stamped.

- 2026-09-30T11:21:11Z, task 18620b53: admin routes to list, transfer and remove MCP
  connections were added (`server/src/routes/admin.ts`) so a user blocked
  from self-delete by `owns_mcp_connections` can be unblocked in the
  product, and `docs/mcp-agents.md` gained a "Managing connections (admin)"
  section. `prisma-data-model-invariants.md` re-verified: the
  `McpConnection.createdBy` paragraph now names the admin routes, the
  audit-`details` inventory records that the new audit calls carry user
  ids written by the acting admin (left to task `75fac3fe`), and the new
  test file was added to `sources`. `mcp-tool-acl.md` gained a navigation
  bullet and new `sources`; `agent-integration-surfaces.md` (lists
  `docs/mcp-agents.md`) was re-checked, its statements stay accurate, and
  it was re-stamped.

- 2026-09-30T11:16:13Z, task a47b6fd9: the deploy's post_update drift report now writes a durable status file (`scripts/schema-drift-report.sh`) that an hourly cron check (`scripts/check-schema-drift.sh`) turns into a `schema-drift FAIL` line in the backup log. `prisma-data-model-invariants.md` re-verified and re-stamped: its production-path paragraph names the script, the status file, the check and the clearing rule; the two scripts were added to `sources`.

- 2026-09-30T07:53:25Z, `prisma-data-model-invariants.md`: the post_update drift report is described as not failing the deploy on drift, with the relay step timeout named as the remaining failure path. Re-stamped.

- 2026-09-30T07:31:13Z, task 6fd386a4: CI now prepares the test database with
  `prisma migrate deploy` and fails on migration/schema drift; one
  reconciling migration was added and `schema.prisma` gained two
  `@@index` declarations (`Task.createdBy`, `TaskAttachment.taskId`). The
  migration is written to apply both on a database built from the
  migrations and on the production state that the deploy hook's
  `prisma db push` had produced, and `.relay.yml` `post_update` now runs a
  read-only `prisma migrate diff --from-url` drift report instead of
  `prisma db push`.
  `prisma-data-model-invariants.md` re-verified: its statements that the
  four foreign-key and index differences were unreconciled drift now say
  they were reconciled and are guarded in CI, a production-path paragraph
  (entrypoint `migrate deploy`, the removed `db push` hook, why the
  migration is re-runnable) was added to Invariant 4, the
  migration-directory claim was recounted, the new migration, `ci.yml`,
  `.relay.yml` and `server/entrypoint.sh` were added to `sources`, and
  every `schema.prisma` line citation that had drifted (enum, status
  columns, `AgentMemoryEntry`, `ApprovalRequest`, `AgentAuditLog`,
  `PluginTaskSync`, creator relations) was re-mapped to the current lines.
  `agent-integration-surfaces.md`, `approvals-lifecycle.md`,
  `auth-and-authz-boundaries.md`, `mcp-tool-acl.md` and
  `room-message-lifecycle.md` list `schema.prisma` under `sources`; their
  `schema.prisma` citations were re-checked against the current lines (the
  two new declarations replace existing lines, so no line moved) and the
  docs re-stamped.

- 2026-09-23T12:15:39Z, task eb405d43: the rollback test in
  `server/src/__tests__/auth-self-delete.test.ts` now flushes pending audit
  writes before reading its fixtures; `prisma-data-model-invariants.md`
  re-checked (it names the test, no line citations) and re-stamped.

- 2026-09-23T11:40:09Z, self-deletion closes the six remaining RESTRICT
  foreign keys to users (task eb405d43): `agent_tokens.createdById`,
  `integration_tokens.createdBy` OR `userId`, and
  `connector_permissions.userId` are deleted outright in the same
  `DELETE /me` transaction (credential-like, FKs stay RESTRICT); the
  agent's own `User` row for every `agent_tokens` row a departing user
  registered is also set `isActive: false`, on top of deleting its token,
  so BYOA agents a departing registrar owns are revoked and deactivated,
  not merely revoked. `invite_codes.createdById` and
  `approval_request.requestedBy` get a nullable/`onDelete: SetNull` schema
  change instead (migration
  `20260923094230_self_delete_restrict_fks_invite_and_approval`): an
  unused invite / pending approval is deleted and a used invite / decided
  approval survives, FK nulled; a used invite with redemptions left is
  also deactivated (`isActive: false`), closing a multi-use code
  (`maxUses > 1`) that otherwise stayed redeemable after its creator was
  gone. `mcp_connections.createdBy` stays RESTRICT and untouched:
  `DELETE /me` returns `409 owns_mcp_connections` while the user still
  owns any, using the pre-existing FK itself, classified specially,
  needing no new check statement and race-safe via the route's existing
  `FOR UPDATE` lock, since deleting an admin-owned, org-wide connection
  would otherwise destroy it for every agent. A real, unmocked rollback
  test (a throwaway table with its own RESTRICT FK to `users(id)`) proves
  every statement in the array, including both audit-log scrub
  statements, rolls back together when `prisma.user.delete` fails.
  `prisma-data-model-invariants.md`'s Invariant 6 residual updated to
  describe the closure; `approvals-lifecycle.md`'s "only requestedBy is
  relationally guaranteed" claim narrowed to pending requests. Every
  schema.prisma citation in `agent-integration-surfaces.md`,
  `auth-and-authz-boundaries.md`, `mcp-tool-acl.md` and
  `room-message-lifecycle.md` shifted and is re-pointed.

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
  earlier restamp missed (POST /api/agents cited as agents.ts line 644 at
  that commit, a comment inside the create transaction; the route was at
  line 546) plus an
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
