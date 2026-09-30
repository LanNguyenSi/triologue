---
type: invariant
title: "Self-deletion data retention: what DELETE /api/auth/me removes, anonymises and keeps"
description: The exact statement of what account self-deletion does to every table, column and file that can hold the deleted user's id or personal text, with a one-line reason per kept item; items still under review are stated as current behaviour, not as a promise.
tags: [gdpr, self-delete, retention, prisma, privacy]
timestamp: 2026-09-30T11:30:56Z
sources:
  - server/src/routes/auth.ts
  - server/src/services/mentionLimiter.ts
  - server/prisma/schema.prisma
  - server/src/utils/logger.ts
  - server/src/services/socketService.ts
  - server/src/routes/upload.ts
  - server/src/integrations/teams/teamsSync.ts
  - scripts/backup.sh
  - server/src/__tests__/auth-self-delete.test.ts
  - server/src/__tests__/auth-self-delete-pii-scrubs.test.ts
  - server/src/__tests__/mentionLimiter-removal.test.ts
---

# Self-deletion data retention

This is the statement of what `DELETE /api/auth/me` (`server/src/routes/auth.ts`)
does with the data that references the deleting user. It is a description of
current behaviour, not a legal position: no row below claims a legal basis
for keeping or removing anything, and every item marked **under review** may
change. Anything not listed is either not personal data or was not found to
reference a user by id or by the user's own text.

The route runs one database transaction (a batch `$transaction([...])`,
statements in the order the route lists them, `user.delete` last), then one
best-effort file cleanup after the commit. If any statement in the
transaction fails, none of it is applied and the user still exists.

How the inventory was enumerated: every model and column in
`server/prisma/schema.prisma` that is a relation to `User` or a plain string
or string array that stores a user id was listed, then each write path was
read (`rg` over `server/src`, excluding tests, for the column name). Text
columns were listed when a user's own words are stored in them. Logs, cache,
files and backups were listed from the code that writes them.

## Removed

By an explicit statement in the transaction:

- Invite codes this user created that nobody redeemed.
- `agent_tokens` this user registered (this also revokes the bearer token of
  the agent), `integration_tokens` created by or assigned to this user, and
  `connector_permissions` belonging to this user.
- `approval_request` rows this user requested that are still pending.
- `inbox_items` this user triggered (`actorId`) in other users' inboxes. They
  carry an excerpt of this user's text, and the `SetNull` on `actorId` alone
  would erase only the key, so they are deleted before the user row.
- The user row itself.

By an `onDelete: Cascade` foreign key: room participation, reactions, typing
status, `user_secrets`, `user_file_sources`, `user_plugin_preferences`, the
user's own inbox, projects the user owns (with their tasks and attachments),
tasks the user created, plugin module instances and runs, project plugin
links, project attachments the user uploaded, and agent memory entries the
user created.

Two of those cascades reach into other owners' projects, which is why they
are **under review**: tasks created by the deleted user, and project
attachments uploaded by the deleted user, are deleted even inside projects
the user did not own. The same holds for plugin module instances and runs,
project plugin links and agent memory entries the user created there. The
uploaded files on disk are not removed (see Outside the database).

## Anonymised (the row stays, the reference or the personal text goes)

- `agent_audit_log`: `agentId` becomes null (`onDelete: SetNull`), `details`
  of the user's own rows becomes JSON null, and the `assignedTo` key naming
  the user is removed from other rows. See Invariant 6 in
  [Prisma data-model invariants](prisma-data-model-invariants.md) for the
  residuals that stay.
- `invite_codes`: `createdById` becomes null (`SetNull`); `usedById` becomes
  null on codes the user redeemed; `note` becomes null on codes the user
  redeemed and on used codes the user created (a note can hold an email).
  A used code stays as a record that it was redeemed, and stays deactivated.
- `approval_request`: `requestedBy` becomes null (`SetNull`); `decidedBy` and
  `decisionNote` become null on decisions the user made. The row, its status
  and `decidedAt` stay as the record that a decision was made.
- `tasks.reviewedBy` becomes null where it names the user (no reviewer).
- The user's id is removed from every `projects.teamMemberIds` and every
  `agent_tokens.sharedWith` array.
- `messages.senderId` and `pinnedById`, `agent_memory_entries.updatedBy` and
  `plugin_installations.updatedBy` become null (`SetNull`). Message content
  is a separate item, below.
- The user's entry in `server/data/mention-limits.json` is removed after the
  commit, best effort: a failure is logged and never fails the request, and a
  corrupt or unreadable file is left untouched.

## Kept

| What | Why it is kept |
| --- | --- |
| `messages` content, `aiContext`, `researchTag` (sender becomes null) | Other people's rooms and conversations depend on it. **Under review.** |
| `message_attachments` filename and url | Follows the message it belongs to. **Under review** with it. |
| `rooms.name` and `rooms.description` typed by the user | Rooms have no owner column; the text belongs to a room other people use. **Under review.** |
| `threads.createdBy` | Nothing in `server/src` writes it. |
| `tasks.assignedTo` naming the user on other owners' tasks | The column is required; a replacement assignee is a decision for the project owner. **Under review.** |
| Title and description the user edited into other owners' tasks | The project owner's data. |
| `task_attachments.uploadedBy` and filename | Plain required column, part of the task. |
| `project_secrets.createdBy` on other owners' projects | The secret belongs to the project. **Under review.** |
| `connector_permissions.grantedBy` naming the user | The record of who authorised an agent. |
| `web_hook_configs.reviewerAgentId` | Nothing in `server/src` writes it. |
| Agent `User` rows the user registered | Kept deactivated so rooms and history that reference them stay coherent; their username and display name may embed the human's name. **Under review.** |
| `invite_codes.note` on unused codes other users created that mention this user's email | Matching free text is not attempted. |
| `agent_audit_log` residuals | User-typed text copied into another actor's audit row, the slug of a user-typed room name inside `roomId`, and an `assignedTo` audit row written after the scrub ran. See Invariant 6. |

## Outside the database

- **Logs.** `logs/combined.log` and `logs/error.log` (winston,
  `server/src/utils/logger.ts`) can contain usernames, user ids and invitee
  emails. They are rotated by size only (10 MB, 5 files each); nothing is
  scrubbed on deletion.
- **Redis.** Cached messages (`message:<id>`) expire after one hour; the
  `online_users` presence set entry is removed when the user's last socket
  disconnects.
  Sockets that are already connected are not closed on deletion.
- **Upload files.** Files in `server/uploads` are not unlinked when the rows
  that reference them are deleted or kept.
- **Backups.** `scripts/backup.sh` rotates dumps by count and age with the
  defaults in the script; a dump taken before the deletion still contains the
  user. No purge of existing backups is done.
- **Microsoft Teams.** Messages already posted to a Teams channel by the
  Teams sync (`[senderName] content`) cannot be recalled by this service.
- **Client.** Data the browser stored locally (token, preferences) is not
  inspected or cleared by the server.

## Verification

`server/src/__tests__/auth-self-delete-pii-scrubs.test.ts` seeds, per
scrub, a fixture for the deleting user and a control row of the same shape
belonging to other users, deletes through the route, and asserts both.
`server/src/__tests__/auth-self-delete.test.ts` proves every statement rolls
back when a later one fails. `server/src/__tests__/mentionLimiter-removal.test.ts`
covers the file cleanup helper.
