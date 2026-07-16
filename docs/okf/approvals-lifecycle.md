---
type: invariant
title: Approvals lifecycle — creation, decision authority, and the open list-scoping gap
description: ApprovalRequest rows are created only by the connector proxy after task authorization, decided only by entitled humans (403 before 409), while GET list/get is any-human with no membership scoping (known-open, agent-tasks 946fa940).
tags: [approvals, connectors, security, authz]
timestamp: 2026-07-16T02:42:25Z
sources:
  - server/src/routes/approvals.ts
  - server/src/connectors/proxy.ts
  - server/prisma/schema.prisma
  - server/src/__tests__/approvals.test.ts
  - server/src/middleware/auth.ts
  - server/src/index.ts
---

# Approvals lifecycle — creation, decision authority, and the open list-scoping gap

## The invariant

An `ApprovalRequest` row is only ever **written** by one code path and only ever **decided** by an entitled human:

1. **Creation happens exclusively in the connector proxy.** `POST /api/connectors/:connectorId/actions/:actionId` (`server/src/connectors/proxy.ts:23`, mounted at `server/src/index.ts:200`) creates the row via `prisma.approvalRequest.create` (`proxy.ts:145-157`) and only when the connector action declares `action.requiresApproval === true` (`proxy.ts:123`). No other code creates approvals; the proxy never reads the list back (per the file-level doc in `approvals.ts:8-19`, `approvalRequest.findMany` has no callers outside `routes/approvals.ts`).

2. **A caller-supplied `taskId` is resolved and authorized BEFORE any trust is derived from it.** `proxy.ts:77-120`: the task is loaded, then access requires `task.assignedTo === agentToken.userId` OR a `roomParticipant` membership in the task's project room (`proxy.ts:100-112`); otherwise 403 "Agent has no access to this task context" (`proxy.ts:113-117`). Only the resulting `authorizedTask` feeds the approval's `taskId` and `projectId` (`proxy.ts:125,143`). Ordering matters because `ApprovalRequest.taskId` has **no Prisma `@relation`/FK** (`server/prisma/schema.prisma:738`; the model's only relation is `requester` on `requestedBy`, `schema.prisma:751`), so nothing downstream re-validates it — an unauthorized taskId would steer both who may decide (via `projectId`) and where the room notification lands (`proxy.ts:70-76` comment).

3. **A prior approval is reusable for 24h.** Before creating a new row, the proxy looks for an existing `status: "approved"` row matching `(requestedBy: agentToken.userId, connectorId, actionId, taskId)` with `createdAt >= now - 24h` (`proxy.ts:124-136`; note the window keys on `createdAt`, not `decidedAt`, and `taskId` matches exactly, including `null` for task-less calls). If found, the action proceeds without a new approval, logging `approval.consumed` (`proxy.ts:241`). If not, the new row is created `status: "pending"` with `actionInput: req.body`, `riskLevel: action.riskLevel ?? "medium"` (`proxy.ts:145-157`), the project room and inbox are notified (`proxy.ts:174-231`, non-fatal on failure), and the proxy returns **202** with `{ requiresApproval: true, approvalId }` (`proxy.ts:233-237`).

4. **Scope determines decision authority.** `projectId` is `authorizedTask?.projectId ?? undefined` (`proxy.ts:143`): task-scoped approvals are decidable by that project's owner/team; task-less approvals stay `projectId = null` and are **admin-only**.

5. **Decide is human-only AND entitlement-gated.** `PATCH /api/approvals/:id/decide` (`approvals.ts:154`, mounted at `index.ts:204`) requires `requireHuman` (`middleware/auth.ts:123-128`, rejects any `userType !== 'HUMAN'`, so agent tokens — including the requester — always 403 regardless of `isAdmin`) AND `canDecideApproval` (`approvals.ts:72-86`): `user.isAdmin`, or, when `projectId` is set, the project's `ownerId` or a member of `teamMemberIds`; `projectId === null` ⇒ admin-only (`approvals.ts:77`). The **403 entitlement check deliberately precedes the 409 pending-state check** (`approvals.ts:170-191`) so a non-entitled caller cannot probe an approval's state via status code; the 404 stays first because ids are unguessable cuids (`approvals.ts:20-24`). Denied attempts are audit-logged as `approval.decide.denied` (`approvals.ts:172-186`).

## Where it's enforced

- `server/src/connectors/proxy.ts:29-39` — bearer must be an active `byoa_` agent token; `proxy.ts:53-68` — `connectorPermission` row required, `allowedActions` allowlist honored.
- `server/src/connectors/proxy.ts:85-120` — task resolution + authorization before the approval gate; `proxy.ts:122-157` — reuse window then creation.
- `server/src/routes/approvals.ts:72-86` — `canDecideApproval` (exported, unit-testable); `approvals.ts:154-224` — decide route ordering (400 → 404 → 403 → 409).
- `server/src/routes/approvals.ts:63-65,92-124` — `projectMembershipWhere` and `GET /` project-scoping; `approvals.ts:130-147` — `GET /:id` reusing `canDecideApproval` before returning the row.
- `server/src/__tests__/approvals.test.ts` — security suite labelled `d065de21` (test file line 2) covering: admin/owner/team-member 200; unrelated human 403 with `update` not called; agent token 403 even with `isAdmin`; requester self-approve 403; `projectId=null` admin-only; 403-before-409 ordering; GET routes reject agent tokens (line 318). A second labelled block, `946fa940` (from line 357), pins the read-scoping fix: admin list sees everything unfiltered; non-admin list constrained to owned/team-member projects; a `taskId` filter only narrows past the project constraint, never widens it; a human with no projects sees nothing (including unscoped approvals); `GET /:id` applies the same decide-entitlement to reads. Mutation-check intent is documented in both test headers.
- Decide-side hardening landed in commit `00be0d0` (PR #177, label `d065de21`). Read-side scoping landed in commit `1253285` (PR #180, label `946fa940`).

## What breaks it

- **FIXED (agent-tasks `946fa940`, commit `1253285`, PR #180): read access is now membership-scoped.** `GET /api/approvals` (`approvals.ts:92`) filters non-admins to approvals of projects they own or are a team member of, via the shared `projectMembershipWhere` predicate (`approvals.ts:63-65`, applied `approvals.ts:105-111`); admins still see everything unfiltered, and unscoped approvals (`projectId === null`) stay admin-only. `GET /api/approvals/:id` (`approvals.ts:130`) now reuses the decide entitlement (`canDecideApproval`, `approvals.ts:138-141`) and 403s a non-entitled human before the row — including its `actionInput` — is ever returned. Before this fix, any authenticated human (admin or not, project member or not) could list every project's approvals and fetch any approval by id; do not reintroduce that by weakening or removing `projectMembershipWhere`/`canDecideApproval` on these routes.
- **Bypassing the proxy's task authorization** (e.g. adding a second creation site, or writing `taskId`/`projectId` from unvalidated input) breaks invariant 2: because `taskId` has no FK, a forged taskId/projectId silently grants decide rights to an arbitrary project's members and posts notifications into a foreign room.
- **Reordering the decide checks** (409 before 403) reintroduces the state-probing side channel the tests pin (`approvals.test.ts:273-294`).
- **Weakening `requireHuman` or `canDecideApproval`** reverts to the pre-`00be0d0` broken-access-control state where any authenticated caller, including the requesting agent's own token, could decide any approval (`approvals.ts:4-6`).
- **Changing the 24h reuse key** (any of `requestedBy`/`connectorId`/`actionId`/`taskId`, the `approved` status filter, or the `createdAt` cutoff at `proxy.ts:124-136`) widens or narrows the no-reprompt window; note a `null`-task approval never satisfies a task-scoped call and vice versa, since the `taskId` match is exact.
- **Trusting `ApprovalRequest.taskId` as a live reference** anywhere new: it is a bare `String?` (`schema.prisma:738`) — task deletion leaves dangling ids; only `requestedBy` is relationally guaranteed.
