---
type: invariant
title: Prisma data-model invariants — deprecated enums, string-literal statuses, scope strings
description: UserType keeps deprecated AI_* values post-backfill, Task/Project/Approval statuses are comment-documented lowercase String columns with no shared constants module, AgentMemoryEntry.scope is a free string consumed only as GLOBAL/PROJECT, and AgentAuditLog.agentId is nullable with onDelete SetNull so a deleted user's audit trail survives, anonymised.
tags: [prisma, schema, migrations, data-model]
timestamp: 2026-09-23T05:10:00Z
sources:
  - server/prisma/schema.prisma
  - server/prisma/migrations/20260223_backfill_ai_agent_user_type/migration.sql
  - server/prisma/migrations/20260226_agent_memory_core_scope/migration.sql
  - server/prisma/migrations/20260314162709_add_task_reviewer_field/migration.sql
  - server/prisma/migrations/20260227211700_add_soft_delete_and_nullable_sender/migration.sql
  - server/prisma/migrations/20260923045824_agent_audit_log_agentid_nullable_setnull/migration.sql
  - server/src/middleware/auth.ts
  - server/src/utils/validation.ts
  - server/src/routes/auth.ts
  - server/src/routes/agents.ts
  - server/src/routes/memory.ts
  - server/src/routes/rooms.ts
  - server/src/routes/projects.ts
  - server/src/routes/batch.ts
  - server/src/routes/approvals.ts
  - server/src/routes/admin.ts
  - server/src/connectors/proxy.ts
  - server/src/plugins/builtin/salesWorkbenchPlugin.ts
  - server/src/services/auditService.ts
  - server/src/services/taskPushService.ts
---

# Prisma data-model invariants

Verified against branch `fix/6bc2a14c-self-delete-audit-fk` commit `0050668` (base `551338d`, the last commit on `master` this branch forked from). Schema: `server/prisma/schema.prisma`; migrations: `server/prisma/migrations/`.

## Invariant 1: `UserType` keeps deprecated values, canonical AI type is `AI_AGENT`

`enum UserType` (schema.prisma:342-349) is `HUMAN`, `AI_AGENT`, plus `AI_ICE` / `AI_LAVA` / `AI_OTHER` under the comment `// Deprecated — kept for migration compatibility, will be removed`. `User.userType` defaults to `HUMAN` (schema.prisma:20).

Existing rows were rewritten by `server/prisma/migrations/20260223_backfill_ai_agent_user_type/migration.sql`:

```sql
UPDATE "users"
SET "userType" = 'AI_AGENT'
WHERE "userType" IN ('AI_ICE', 'AI_LAVA', 'AI_OTHER');
```

The canonical agent-creation path hardcodes the new value: BYOA agent registration creates the User with `userType: "AI_AGENT"` (server/src/routes/agents.ts:602). Code that still branches on the deprecated values is defensive read-side compatibility, not production of the values:

- `requireAI` accepts `['AI_AGENT', 'AI_ICE', 'AI_LAVA', 'AI_OTHER']` (server/src/middleware/auth.ts:131-136)
- same 4-value lists at server/src/routes/projects.ts:1524, server/src/routes/rooms.ts:551 and :602, server/src/routes/auth.ts:265, and `AGENT_USER_TYPES` in server/src/services/taskPushService.ts:7

**Caveat (write path now closed on the public route, agent-tasks `0bc4f108`, PR #181):** the Joi `register`/`login` schemas still `.valid('HUMAN', 'AI_AGENT', 'AI_ICE', 'AI_LAVA', 'AI_OTHER')` (server/src/utils/validation.ts:39-41, 51-63), and `POST /auth/register` would still persist the client-supplied value verbatim via `userType: userType as UserType` (server/src/routes/auth.ts:141) if it reached that line. It no longer can: a dedicated guard now runs first — `if (userType && userType !== 'HUMAN') return res.status(403)...` (auth.ts:76-78) — before either REGISTRATION_MODE gate and before any Prisma call, independent of mode (including `open`). A repo-wide grep of `userType:` write-sites confirms only two paths ever persist the field: `agents.ts:602` (hardcoded `"AI_AGENT"`, never a deprecated value) and this now-gated `auth.ts:141`. The Joi schema's permissiveness is dead weight on this path, not a live hole; do not narrow it without also checking `login`'s use of the same values (auth.ts:265) first. (Both line numbers shifted by one from the prior sweep's 75-77/140/264: task 6bc2a14c added one `import` line near the top of auth.ts, T-001, 2026-09-23.)

## Invariant 2: statuses are plain `String` columns, not DB enums; value sets live in comments and are retyped per call site

Real Prisma enums exist only for `UserType`, `RoomType`, `ParticipantRole`, `MessageType`, `AttachmentType` (schema.prisma:342-380). Every status-like column is `String` with the value set documented (at best) in a trailing comment:

- `Task.status String @default("todo") // todo | in_progress | in_review | done | blocked` (schema.prisma:420)
- `Project.status String @default("active") // active | archived | closed` (schema.prisma:390)
- `ApprovalRequest.status String @default("pending") // pending | approved | rejected` (schema.prisma:745)
- `AgentToken.status String @default("pending") // pending | active | rejected` (schema.prisma:242)
- uncommented: `IntegrationToken.status @default("active")` (:273), `McpConnection.status @default("pending")` (:308), `PluginModuleRun.status @default("started")` (:569)

There is **no shared status-constants module** in `server/src`. The closest thing is local to one file: `CORE_TASK_STATUSES` / `OPTIONAL_TASK_STATUSES` / `WORKFLOW_STATUS_ORDER` / `TASK_STATUSES` in server/src/routes/projects.ts:26-35, exported nowhere and imported by no other file (the only exported status constants anywhere are project-status sets in server/src/utils/projectRoomPolicy.ts:3-4). Other call sites retype the lowercase literals inline:

- server/src/routes/batch.ts:129, :148, :152-153, :520 (`{ not: 'done' }`, `'blocked'`, `'in_review'`), :274, :276 (scoring comparisons)
- server/src/routes/rooms.ts:251 (task filter, now correctly `'done'` — see below)
- server/src/routes/projects.ts:2216, :2249 (`"in_review"`, `"in_progress"` comparisons)

**Consequence (was a live bug, fixed — agent-tasks `19e744b4`, PR #184, commit `8f23e23`):** because the DB cannot reject a wrong-cased literal, drift can ship silently — this exact class of bug did, until 2026-07-13: `server/src/routes/rooms.ts:251` filtered `where: { status: { not: 'DONE' } }` (uppercase), which never matched any stored row, so done tasks always leaked into the room's open-task preview. The fix was a one-line literal change to `'done'`, regression-pinned by `server/src/__tests__/rooms-project-openTasks.test.ts`. The general risk this invariant documents — no shared status-constants module, so nothing stops a future call site from repeating this — is still real; the specific instance is closed. Surrounding message/room flow is described in [room-message-lifecycle.md](room-message-lifecycle.md), not re-described here.

**Rule for agents:** when reading or writing any `status` column, treat the schema comment as the authoritative value set, use exact lowercase literals, and expect no compile-time or DB-level protection.

## Invariant 3: `AgentMemoryEntry.scope` is a free string; code consumes only `"GLOBAL"` and `"PROJECT"`

`AgentMemoryEntry.scope String @default("PROJECT")` (schema.prisma:681), indexed via `@@index([scope, createdAt])` and `@@index([scope, projectId, archivedAt, createdAt])` (:704, :707). The column was added by `server/prisma/migrations/20260226_agent_memory_core_scope/migration.sql`, which does exactly this and no more: adds `scope TEXT NOT NULL DEFAULT 'PROJECT'` (plus `title`, `tags`, `isPinned`, `archivedAt`, `updatedBy`), makes `projectId` nullable "for GLOBAL memory scope", creates the two scope indexes, and adds the `updatedBy` FK. **The string `'CORE'` appears nowhere in the migration.** The `core` in the directory name refers to the core-agent-memory plugin (`const CORE_MEMORY_PLUGIN_ID = "core-agent-memory"`, server/src/routes/memory.ts:7), not to a `CORE` scope value — that is the resolution of the apparent name/code mismatch.

Live code branches on exactly two stored values: `normalizeScope` (server/src/routes/memory.ts:20-26) accepts only `GLOBAL | PROJECT | ALL` (`ALL` is a query-filter pseudo-value, never stored), the list filter branches on `"GLOBAL"`/`"PROJECT"` (memory.ts:322-353), and the write path stores `scope` as `GLOBAL` or `PROJECT` with `projectId: scope === "PROJECT" ? projectId : null` (memory.ts:480, :546-550). No code path reads or writes a `"CORE"` scope (repo-wide grep of `server/src` finds `CORE` only in `CORE_TASK_STATUSES` and `CORE_MEMORY_PLUGIN_ID`).

**Rule for agents:** the DB accepts any string in `scope`; anything other than `GLOBAL`/`PROJECT` is invisible to every query filter. `GLOBAL` entries have `projectId = null` by construction.

## Invariant 4: migration hygiene on this checkout

All 38 migration directories under `server/prisma/migrations/` contain a non-empty `migration.sql` (smallest is 68 bytes: `20260314162709_add_task_reviewer_field/migration.sql`, a single `ALTER TABLE "tasks" ADD COLUMN "reviewedBy" TEXT;`). The historical "empty migration dir" report (agent-tasks `eda2bc59`) names directory `20260314162022_add_task_reviewer_field` — **that directory does not exist on this checkout at all**; the only `add_task_reviewer_field` migration is `20260314162709`. The report does not reproduce here; plausibly the empty `...162022` dir was deleted and re-generated as `...162709`, but that is inference, not verified history.

## Invariant 5: `ApprovalRequest.taskId` is an unconstrained foreign key by convention only

`ApprovalRequest` (schema.prisma:735-758) has `taskId String?` (:738) with `@@index([taskId])` (:754) but **no `@relation`** — the model's only relation is `requester User @relation("ApprovalRequests", ...)` (:751). Contrast with `TaskAttachment` (:450) and `PluginTaskSync` (:604), which both declare `task Task @relation(... onDelete: Cascade)`. Consequences: no referential integrity (a dangling or garbage `taskId` is storable), no cascade on task deletion, and no `include: { task: ... }` from Prisma — task data must be fetched separately. Approval semantics and the authz concern around them are covered in [approvals-lifecycle.md](approvals-lifecycle.md).

## Invariant 6: `AgentAuditLog.agentId` is nullable and anonymises on user deletion; no other column carries the deleted user's personal data

`AgentAuditLog` (schema.prisma:713-733) declares `agentId String?` (:716) with `agent User? @relation("AgentAuditLogs", fields: [agentId], references: [id], onDelete: SetNull)` (:726), applied by `server/prisma/migrations/20260923045824_agent_audit_log_agentid_nullable_setnull/migration.sql`. Before task 6bc2a14c (triologue), `agentId` was `String` (non-nullable) with no `onDelete` rule, so Postgres's default blocking foreign-key action rejected `prisma.user.delete()` for any user who had ever caused an audit row to be written (for example, one PATCH to a task: `routes/projects.ts`'s `updateTask` ends with an unconditional, un-awaited `logAuditEvent`, see `services/auditService.ts`), and `routes/auth.ts`'s `DELETE /me` route's bare `catch {}` turned that into an opaque 500. The migration is hand-scoped to this one relation: `prisma migrate dev --create-only` against a scratch database also proposed dropping and re-adding four unrelated foreign keys (`project_secrets_projectId_fkey`, `projects_ownerId_fkey`, `tasks_projectId_fkey`, `webhook_configs_projectId_fkey`) plus two index drops and one index rename, reflecting pre-existing drift between `server/prisma/migrations/` and `schema.prisma` on those tables that predates this task and that this task does not touch; only the `agent_audit_log_agentId_fkey` statements from that generated diff were kept, matching the precedent set by `server/prisma/migrations/20260227211700_add_soft_delete_and_nullable_sender/migration.sql` (the same `DROP NOT NULL` / `DROP CONSTRAINT` / `ADD CONSTRAINT ... ON DELETE SET NULL` shape, there for `messages.senderId`).

**Decision (D-001): anonymise, not delete or cascade-delete.** A deleted user's audit rows survive with `agentId = null`, keeping the operational record (what action ran, on what resource, when, whether it succeeded) while severing the identifying link. Every other `agent_audit_log` column was checked, across every `logAuditEvent`/`withAudit` call site in `server/src` (`services/auditService.ts`, `routes/approvals.ts`, `routes/agents.ts`, `routes/admin.ts`, `routes/projects.ts`, `connectors/proxy.ts`, `plugins/builtin/salesWorkbenchPlugin.ts`), for whether it can carry the deleted user's own personal data (their name, email, username, or an account field), not merely resource content:

- `id`, `timestamp`, `resourceId`, `projectId`, `roomId`: opaque ids/timestamps, never the acting user's identity.
- `action`, `resourceType`: fixed, code-defined literal strings (`"task.update"`, `"approval.requested"`, `"mcp.call"`, ...), never user-supplied text.
- `success`, `durationMs`: booleans/numbers.
- `details` (`Json`): free-form and action-defined, so it was checked call site by call site rather than assumed safe. It never stores the acting user's own username, display name or email (`agents.ts`'s `message.send` audit logs `contentLength`, not message content, and a repo-wide grep of every `logAuditEvent`/`withAudit` call finds no `username`/`displayName`/`email` field written into `details` anywhere). A minority of call sites do copy free text into `details`, but it is content about the resource the action targeted, not the deleted user's personal data: a task's `title` (`routes/projects.ts` updateTask's audit call), a screening run's `runTitle` (`plugins/builtin/salesWorkbenchPlugin.ts`), an approval's `decisionNote` (`routes/approvals.ts`), and an attachment's `filename` (`routes/agents.ts`). That content remains fully attributable to its project/task/approval via the row's own `projectId`/`resourceId` regardless of `agentId`, so redacting it on the deleting user's own audit rows would not actually remove it from the system (the same title/note/filename lives on the still-present `Task`/`ApprovalRequest`/attachment row), and it is not, in itself, the deleted user's name, email or account data. No `details` redaction is applied.

**Readers of `agentId` outside tests** (`rg agentAuditLog\|AgentAuditLog` across `server/src`, excluding `server/src/__tests__`): `services/auditService.ts` only ever writes `agentId` (the caller's own, currently-authenticated id; a deleted user cannot be the writer of a new row), so it is unaffected by an existing row's `agentId` going `null`. `routes/projects.ts`'s `GET /:projectId/activity` (server/src/routes/projects.ts:2541-2606) is the one reader: it now filters `items.map((item) => item.agentId).filter((id): id is string => id !== null)` before querying `user.findMany` (previously `String(item.agentId)` would have coerced a `null` into the literal id `"null"`, a harmless but incorrect lookup), and builds each row's `agentName`/`agentUsername` only `if (item.agentId)`, so a row whose actor was deleted now renders with both fields `undefined` instead of throwing or matching a stray id.

**Other `prisma.user.delete`/`prisma.user.deleteMany` call sites** (same repo-wide grep, excluding `server/src/__tests__`): none outside `routes/auth.ts`'s `DELETE /me`. `routes/agents.ts`'s agent-deletion route (:1197) is a soft delete (`prisma.user.update({ data: { isDeleted: true, isActive: false } })`, comment: "Messages remain with senderId=null"); it never calls `prisma.user.delete` and so never exercises this constraint.
