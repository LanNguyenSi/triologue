---
type: invariant
title: Prisma data-model invariants — deprecated enums, string-literal statuses, scope strings
description: UserType keeps deprecated AI_* values post-backfill, Task/Project/Approval statuses are comment-documented lowercase String columns with no shared constants module, and AgentMemoryEntry.scope is a free string consumed only as GLOBAL/PROJECT.
tags: [prisma, schema, migrations, data-model]
timestamp: 2026-07-16T02:42:25Z
sources:
  - server/prisma/schema.prisma
  - server/prisma/migrations/20260223_backfill_ai_agent_user_type/migration.sql
  - server/prisma/migrations/20260226_agent_memory_core_scope/migration.sql
  - server/prisma/migrations/20260314162709_add_task_reviewer_field/migration.sql
  - server/src/middleware/auth.ts
  - server/src/utils/validation.ts
  - server/src/routes/auth.ts
  - server/src/routes/agents.ts
  - server/src/routes/memory.ts
  - server/src/routes/rooms.ts
  - server/src/routes/projects.ts
  - server/src/routes/batch.ts
  - server/src/services/taskPushService.ts
---

# Prisma data-model invariants

Verified against master `c0520e2`. Schema: `server/prisma/schema.prisma`; migrations: `server/prisma/migrations/`.

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
- same 4-value lists at server/src/routes/projects.ts:1534, server/src/routes/rooms.ts:551 and :602, server/src/routes/auth.ts:264, and `AGENT_USER_TYPES` in server/src/services/taskPushService.ts:7

**Caveat (write path now closed on the public route, agent-tasks `0bc4f108`, PR #181):** the Joi `register`/`login` schemas still `.valid('HUMAN', 'AI_AGENT', 'AI_ICE', 'AI_LAVA', 'AI_OTHER')` (server/src/utils/validation.ts:39-41, 51-63), and `POST /auth/register` would still persist the client-supplied value verbatim via `userType: userType as UserType` (server/src/routes/auth.ts:140) if it reached that line. It no longer can: a dedicated guard now runs first — `if (userType && userType !== 'HUMAN') return res.status(403)...` (auth.ts:75-77) — before either REGISTRATION_MODE gate and before any Prisma call, independent of mode (including `open`). A repo-wide grep of `userType:` write-sites confirms only two paths ever persist the field: `agents.ts:602` (hardcoded `"AI_AGENT"`, never a deprecated value) and this now-gated `auth.ts:140`. The Joi schema's permissiveness is dead weight on this path, not a live hole; do not narrow it without also checking `login`'s use of the same values (auth.ts:264) first.

## Invariant 2: statuses are plain `String` columns, not DB enums; value sets live in comments and are retyped per call site

Real Prisma enums exist only for `UserType`, `RoomType`, `ParticipantRole`, `MessageType`, `AttachmentType` (schema.prisma:342-380). Every status-like column is `String` with the value set documented (at best) in a trailing comment:

- `Task.status String @default("todo") // todo | in_progress | in_review | done | blocked` (schema.prisma:420)
- `Project.status String @default("active") // active | archived | closed` (schema.prisma:390)
- `ApprovalRequest.status String @default("pending") // pending | approved | rejected` (schema.prisma:745)
- `AgentToken.status String @default("pending") // pending | active | rejected` (schema.prisma:242)
- uncommented: `IntegrationToken.status @default("active")` (:273), `McpConnection.status @default("pending")` (:308), `PluginModuleRun.status @default("started")` (:569)

There is **no shared status-constants module** in `server/src`. The closest thing is local to one file: `CORE_TASK_STATUSES` / `OPTIONAL_TASK_STATUSES` / `WORKFLOW_STATUS_ORDER` / `TASK_STATUSES` in server/src/routes/projects.ts:21-30, exported nowhere and imported by no other file (the only exported status constants anywhere are project-status sets in server/src/utils/projectRoomPolicy.ts:3-4). Other call sites retype the lowercase literals inline:

- server/src/routes/batch.ts:129, :148, :152-153, :520 (`{ not: 'done' }`, `'blocked'`, `'in_review'`), :274, :276 (scoring comparisons)
- server/src/routes/rooms.ts:251 (task filter, now correctly `'done'` — see below)
- server/src/routes/projects.ts:2224, :2257 (`"in_review"`, `"in_progress"` comparisons)

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
