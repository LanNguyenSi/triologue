---
type: invariant
title: Room and message lifecycle — two read paths, soft-delete asymmetry, status-literal drift
description: Message reads go through two divergent endpoints (only /api/messages filters isDeleted), all reads/writes gate on RoomParticipant, and Task.status is an unconstrained String whose casing drift makes rooms.ts openTasks include done tasks (open bug 19e744b4).
tags: [rooms, messages, soft-delete, lifecycle]
timestamp: 2026-07-09T03:34:19.437907Z
sources:
  - server/src/routes/rooms.ts
  - server/src/routes/messages.ts
  - server/src/routes/batch.ts
  - server/src/routes/projects.ts
  - server/src/services/socketService.ts
  - server/src/utils/projectRoomPolicy.ts
  - server/prisma/schema.prisma
  - server/src/index.ts
  - client/src/stores/chatStore.ts
  - client/src/pages/ProjectEditPage.tsx
---

# Room and message lifecycle — two read paths, soft-delete asymmetry, status-literal drift

Routers mount at `server/src/index.ts:144` (`/api/messages` → `messageRoutes`) and `server/src/index.ts:146` (`/api/rooms` → `roomRoutes`). `Message.isDeleted Boolean @default(false)` is the soft-delete flag (`server/prisma/schema.prisma:145`); `User.isDeleted` is a separate soft-delete flag (`schema.prisma:22`). `Message.sender` is nullable with `onDelete: SetNull`; `Message.room` is `onDelete: Cascade`, so hard-deleting a room hard-deletes its messages (`schema.prisma:159-160`).

## Invariant 1: membership gates every message read and write — no public-read path

Every message-touching path first checks `prisma.roomParticipant.findUnique({ where: { userId_roomId } })` and rejects non-members:

- `GET /api/messages/:roomId` — `server/src/routes/messages.ts:27-32` (403 "Not a member of this room"); same check on `/search` (`messages.ts:129-134`) and `/pinned` (`messages.ts:247-252`).
- `GET /api/rooms/:roomId` (batch detail) — `server/src/routes/rooms.ts:166-177` (403 "Access denied to this room").
- `GET /api/rooms/:roomId/messages` — `rooms.ts:356-367` (403 "Access denied to this room").
- Socket write path `message:send` — `server/src/services/socketService.ts:135-149` (emits error "Not authorized to send messages in this room").

Writes are additionally blocked when the room's linked project has `status === "closed"`: `isRoomWriteBlocked` (`server/src/utils/projectRoomPolicy.ts:11-14`, `WRITE_BLOCKED_PROJECT_STATUS = "closed"` at :4) is enforced in `socketService.ts:151-163` and surfaced to the client as `canSendMessages` (`rooms.ts:283`).

## Invariant 2: two message-list endpoints, and only one filters soft-deleted messages

- `GET /api/messages/:roomId` (`messages.ts:22-110`) filters `isDeleted: false` (`messages.ts:62`); so do `/search` (`messages.ts:144`) and `/pinned` (`messages.ts:257`). This is the endpoint the client chat view uses: `client/src/stores/chatStore.ts:161` (`/api/messages/${roomId}?limit=50`) and `chatStore.ts:190-192` (pagination).
- `GET /api/rooms/:roomId/messages` (`rooms.ts:348-414`) does NOT filter `isDeleted` on messages — its `findMany` where-clause is only `{ roomId, ...(before && { id: { lt: before } }) }` (`rooms.ts:370-374`), so soft-deleted message content is returned to any room member. It instead masks soft-deleted SENDERS: it selects `sender.isDeleted` (`rooms.ts:383`) and rewrites `displayName: '[Deleted User]', username: '[deleted]'` (`rooms.ts:401-407`).
- No in-repo caller of `GET /api/rooms/:roomId/messages` was found (grep of `client/src`, `server/src`, and repo docs for the path; only build artifacts in `client/dist` and an unrelated MS Graph URL in `server/src/integrations/teams/teamsSync.ts:58` matched). Its purpose is unconfirmed; treat it as a legacy/orphan read path, but note it is still live and leaks soft-deleted content to room members.

The sender-masking asymmetry cuts both ways: the primary path `messages.ts:66-73` selects sender WITHOUT `isDeleted` and performs no masking, so deleted-user display names pass through unmasked on the endpoint the client actually uses, while the masking logic lives only on the apparently-uncalled rooms.ts variant.

Other read paths are consistent with the filtering side: room list `lastMessage` filters `isDeleted: false` (`rooms.ts:99`), the batched room-detail `include=messages` query filters it (`rooms.ts:207`), and pinned-message queries filter it (`rooms.ts:1062`, `messages.ts:257`).

## Invariant 3: message soft-delete is one-way and socket-broadcast

`DELETE /api/messages/:messageId` (`messages.ts:183-237`) sets `isDeleted: true` (`messages.ts:218-221`), returns 410 if already deleted (`messages.ts:197-199`), and emits `message:deleted` to the room (`messages.ts:224-230`). Pinning refuses deleted messages with 410 (`messages.ts:315-317`). There is no undelete endpoint and no hard-delete of individual messages in these routes. Note: the doc comment at `messages.ts:178-181` claims room admins may delete any message in their room, but the code only authorizes `message.senderId === userId` or global `user.isAdmin` (`messages.ts:207-215`) — trust the code, not the comment.

## Invariant 4 (violated — live bug 19e744b4): Task.status literals are lowercase; rooms.ts filters with 'DONE'

`Task.status` is a plain `String @default("todo")` with values documented only in a schema comment: `todo | in_progress | in_review | done | blocked` (`schema.prisma:420`). The batched room-detail endpoint filters linked-project open tasks with `where: { status: { not: 'DONE' } }` (`rooms.ts:223`, inside the `wantProject` query at `rooms.ts:217-235`, surfaced as `project.openTasks` at `rooms.ts:331-337`). Because stored literals are lowercase, `not: 'DONE'` matches everything, so the openTasks list NEVER excludes done tasks. This is a known-open, tracked defect (agent-tasks 19e744b4) — do not document the current behavior as intended, and do not "fix" call sites to uppercase.

Correct call sites for comparison: `server/src/routes/batch.ts:135`, `:154`, `:489` all use `{ not: 'done' }`; the client milestone editor uses `"done"` (`client/src/pages/ProjectEditPage.tsx:641`).

## Structural root cause: no shared status-constants module

There is no shared constants module for `Task.status`; every call site retypes the literal. The closest things are file-local constants in `server/src/routes/projects.ts:28-37` (`CORE_TASK_STATUSES = ["todo", "in_progress", "done"]`, `OPTIONAL_TASK_STATUSES = ["blocked", "in_review"]`, `WORKFLOW_STATUS_ORDER`) and PROJECT-status (not task-status) constants in `server/src/utils/projectRoomPolicy.ts:3-4`. `server/src/constants*` does not exist. Any new code touching `Task.status` must use lowercase literals and should expect casing drift like `rooms.ts:223` until a shared module exists.

## Room.roomType

`enum RoomType { TRIOLOGUE, DIRECT, RESEARCH, SYSTEM }` (`schema.prisma:351-356`), default `TRIOLOGUE` (`schema.prisma:98`). The only route-level branch on it found is at room creation: `POST /api/rooms` defaults `roomType = 'TRIOLOGUE'` (`rooms.ts:420`) and auto-creates a linked project only when the room is private AND `roomType !== 'SYSTEM'` AND the name is not "registration" AND `createProject !== false` (`rooms.ts:428-432`). All other `roomType` references in routes merely echo the stored value (`rooms.ts:125`, `:278`, `:499`, `batch.ts:292`).

## DISCREPANCIES (leads vs. verified reality)

- Lead placed the isDeleted filters in messages.ts at "~62,144"; verified at `messages.ts:62` and `:144`, plus a third at `:257` (pinned) the lead omitted.
- Lead implied sender masking is the rooms.ts endpoint's deleted-user handling; verified, but the converse gap (primary `/api/messages` path does NO deleted-sender masking, `messages.ts:66-73`) was not in the leads and is a real asymmetry.
- The comment block at `messages.ts:178-181` ("Room admins can delete any message in their room") does not match the code (`messages.ts:207-215`: sender or global admin only). Comment drift, not lead drift.
- All other leads verified as stated: no in-repo caller of `GET /api/rooms/:roomId/messages`; membership checks at `rooms.ts:356-367`, `messages.ts:27-32`, `socketService.ts:135-149`; `'DONE'` at `rooms.ts:223` vs lowercase everywhere else; no shared Task.status constants module.
