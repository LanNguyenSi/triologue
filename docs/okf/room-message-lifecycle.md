---
type: invariant
title: Room and message lifecycle — two read paths, soft-delete asymmetry, status-literal drift
description: Message reads go through two divergent endpoints (only /api/messages filters isDeleted), all reads/writes gate on RoomParticipant, and Task.status is an unconstrained String whose casing drift caused rooms.ts openTasks to include done tasks (fixed, 19e744b4, PR #184).
tags: [rooms, messages, soft-delete, lifecycle]
timestamp: 2026-11-10T08:08:32Z
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

Routers mount at `server/src/index.ts:191` (`/api/messages` → `messageRoutes`) and `server/src/index.ts:194` (`/api/rooms` → `roomRoutes`), with `/api/rooms/:roomId/threads` → `threadRoutes` (`server/src/routes/threads.ts`: create, list, resolve; room membership checked first) mounted just before it at `server/src/index.ts:193`. `Message.isDeleted Boolean @default(false)` is the soft-delete flag (`server/prisma/schema.prisma:152`); `User.isDeleted` is a separate soft-delete flag (`schema.prisma:22`). `Message.sender` is nullable with `onDelete: SetNull`; `Message.room` is `onDelete: Cascade`, so hard-deleting a room hard-deletes its messages (`schema.prisma:166-167`).

## Invariant 1: membership gates every message read and write — no public-read path

Every message-touching path first checks `prisma.roomParticipant.findUnique({ where: { userId_roomId } })` and rejects non-members:

- `GET /api/messages/:roomId` — `server/src/routes/messages.ts:27-32` (403 "Not a member of this room"); same check on `/search` (`messages.ts:133-138`) and `/pinned` (`messages.ts:252-257`).
- `GET /api/rooms/:roomId` (batch detail) — `server/src/routes/rooms.ts:203-214` (403 "Access denied to this room").
- `GET /api/rooms/:roomId/messages` — `rooms.ts:439-450` (403 "Access denied to this room").
- Socket write path `message:send` — `server/src/services/socketService.ts:163-177` (emits error "Not authorized to send messages in this room").

Writes are additionally blocked when the room's linked project has `status === "closed"`: `isRoomWriteBlocked` (`server/src/utils/projectRoomPolicy.ts:44-47`, `WRITE_BLOCKED_PROJECT_STATUS = "closed"` at :4) is enforced in `socketService.ts:179-191` and surfaced to the client as `canSendMessages` (`rooms.ts:337`).

## Invariant 2: two message-list endpoints, and only one filters soft-deleted messages

- `GET /api/messages/:roomId` (`messages.ts:22-110`) filters `isDeleted: false` (`messages.ts:62`); so do `/search` (`messages.ts:148`) and `/pinned` (`messages.ts:262`). This is the endpoint the client chat view uses: `client/src/stores/chatStore.ts:145-146` (`/api/messages/${roomId}?limit=...`, with `before` for older pages) and `chatStore.ts:271` (pagination). The client keeps messages with a `threadId` out of the room list and fetches on, up to five pages per call, while a page holds only replies.
- `GET /api/rooms/:roomId/messages` (`rooms.ts:418-499`) does NOT filter `isDeleted` on messages unless `threadId` is given — its `findMany` where-clause is `{ roomId, ...(threadId filter), ...(before && { id: { lt: before } }) }` (no `isDeleted` condition unless `threadId` is given) (`rooms.ts:467-471`; the optional `?threadId=` filter narrows the list to one thread's messages and then also adds `isDeleted: false`, so a soft-deleted reply is left out of the filtered list; without the parameter thread replies are part of the room list and soft-deleted messages are still returned), so soft-deleted message content is returned to any room member (which is why the self-delete opt-in `deleteMessages` replaces the content instead of only setting `isDeleted`, see [Self-deletion data retention](self-delete-data-retention.md)). It instead masks soft-deleted SENDERS: it selects `sender.isDeleted` (`rooms.ts:480`) and rewrites `displayName: '[Deleted User]', username: '[deleted]'` (`rooms.ts:499-504`).
- No in-repo caller of `GET /api/rooms/:roomId/messages` was found (grep of `client/src`, `server/src`, and repo docs for the path; only build artifacts in `client/dist` matched). Its purpose is unconfirmed; treat it as a legacy/orphan read path, but note it is still live and leaks soft-deleted content to room members.

The sender-masking asymmetry cuts both ways: the primary path `messages.ts:66-73` selects sender WITHOUT `isDeleted` and performs no masking, so deleted-user display names pass through unmasked on the endpoint the client actually uses, while the masking logic lives only on the apparently-uncalled rooms.ts variant.

Other read paths are consistent with the filtering side: room list `lastMessage` filters `isDeleted: false` (`rooms.ts:137`), the batched room-detail `include=messages` query filters it (`rooms.ts:244`), and pinned-message queries filter it (`rooms.ts:1159`, `messages.ts:262`).

## Invariant 3: message soft-delete is one-way and socket-broadcast

`DELETE /api/messages/:messageId` (`messages.ts:188-242`) sets `isDeleted: true` (`messages.ts:223-226`), returns 410 if already deleted (`messages.ts:202-204`), and emits `message:deleted` to the room (`messages.ts:229-235`). Pinning refuses deleted messages with 410 (`messages.ts:320-322`). There is no undelete endpoint and no hard-delete of individual messages in these routes. Note: the doc comment at `messages.ts:183-186` claims room admins may delete any message in their room, but the code only authorizes `message.senderId === userId` or global `user.isAdmin` (`messages.ts:212-220`) — trust the code, not the comment.

## Invariant 4 (fixed — was live bug 19e744b4): Task.status literals are lowercase; rooms.ts now filters with 'done'

`Task.status` is a plain `String @default("todo")` with values documented only in a schema comment: `todo | in_progress | in_review | done | blocked` (`schema.prisma:442`). The batched room-detail endpoint filters linked-project open tasks with `where: { status: { not: 'done' } }` (`rooms.ts:260`, inside the `wantProject` query at `rooms.ts:254-272`, surfaced as `project.openTasks` at `rooms.ts:402-408`). Until PR #184 (commit `8f23e23`, 2026-07-13) this line read `not: 'DONE'` (uppercase), which never matched any stored row, so the openTasks list never excluded done tasks. The fix is a one-line literal change, regression-pinned by `server/src/__tests__/rooms-project-openTasks.test.ts`. Treat agent-tasks `19e744b4` as closed for this call site -- do not reopen it or re-"fix" this line to uppercase.

Correct call sites for comparison: `server/src/routes/batch.ts:129`, `:148`, `:520` all use `{ not: 'done' }`; the client milestone editor uses `"done"` (`client/src/pages/ProjectEditPage.tsx:642`).

## Structural root cause: no shared status-constants module

There is no shared constants module for `Task.status`; every call site retypes the literal. The closest things are file-local constants in `server/src/routes/projects.ts:27-36` (`CORE_TASK_STATUSES = ["todo", "in_progress", "done"]`, `OPTIONAL_TASK_STATUSES = ["blocked", "in_review"]`, `WORKFLOW_STATUS_ORDER`) and PROJECT-status (not task-status) constants in `server/src/utils/projectRoomPolicy.ts:3-4`. `server/src/constants*` does not exist. Any new code touching `Task.status` must use lowercase literals — casing drift like the `rooms.ts:260` case (see Invariant 4, since fixed) can still happen at any call site until a shared module exists.

## Room.roomType

`enum RoomType { TRIOLOGUE, DIRECT, RESEARCH, SYSTEM }` (`schema.prisma:373-378`), default `TRIOLOGUE` (`schema.prisma:105`). The only route-level branch on it found is at room creation: `POST /api/rooms` defaults `roomType = 'TRIOLOGUE'` (`rooms.ts:517`) and auto-creates a linked project only when the room is private AND `roomType !== 'SYSTEM'` AND the name is not "registration" AND `createProject !== false` (`rooms.ts:525-529`). All other `roomType` references in routes merely echo the stored value (`rooms.ts:162`, `:332`, `:596`, `batch.ts:323`).

## DISCREPANCIES (leads vs. verified reality)

- Lead placed the isDeleted filters in messages.ts at "~62,144"; verified at `messages.ts:62` and `:148`, plus a third at `:262` (pinned) the lead omitted.
- Lead implied sender masking is the rooms.ts endpoint's deleted-user handling; verified, but the converse gap (primary `/api/messages` path does NO deleted-sender masking, `messages.ts:66-73`) was not in the leads and is a real asymmetry.
- The comment block at `messages.ts:183-186` ("Room admins can delete any message in their room") does not match the code (`messages.ts:212-220`: sender or global admin only). Comment drift, not lead drift.
- All other leads verified as stated: no in-repo caller of `GET /api/rooms/:roomId/messages`; membership checks at `rooms.ts:439-450`, `messages.ts:27-32`, `socketService.ts:163-177`; no shared Task.status constants module.
- 2026-07-16 re-verification (task de185997): the `'DONE'` vs lowercase mismatch at former `rooms.ts:225` (Invariant 4) is no longer current — PR #184 (commit `8f23e23`, 2026-07-13) fixed it to `'done'` at what is now `rooms.ts:260`, with a regression test. Treat Invariant 4 as describing a closed bug, not a live one.
