---
type: invariant
title: "Self-deletion data retention: what DELETE /api/auth/me removes, anonymises and keeps"
description: The exact statement of what account self-deletion does to every table, column and file that can hold the deleted user's id or personal text, with a one-line reason per kept item; items still under review are stated as current behaviour, not as a promise.
tags: [gdpr, self-delete, retention, prisma, privacy]
timestamp: 2026-10-06T09:56:47Z
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
  - server/src/__tests__/auth-self-delete-other-owners.test.ts
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
statements in the order the route lists them, `user.delete` last), then
best-effort file cleanups after the commit (the mention-limits entry and the
upload files of the deleted attachments). If any statement in the
transaction fails, none of it is applied and the user still exists.

How the inventory was enumerated: every model and column in
`server/prisma/schema.prisma` that is a relation to `User` or a plain string
or string array that stores a user id was listed, then each write path was
read (`rg` over `server/src`, excluding tests, for the column name). Text
columns were listed when a user's own words are stored in them. Logs, cache,
files and backups were listed from the code that writes them.

## Removed

By an explicit statement in the transaction:

- Invite codes this user created that nobody redeemed (`useCount` is 0).
- `agent_tokens` this user registered (this also revokes the bearer token of
  the agent), `integration_tokens` created by or assigned to this user, and
  `connector_permissions` belonging to this user.
- `approval_request` rows this user requested that are still pending.
- `inbox_items` this user triggered (`actorId`) in other users' inboxes. They
  carry an excerpt of this user's text, and the `SetNull` on `actorId` alone
  would erase only the key, so they are deleted before the user row.
- `agent_memory_entries` this user created that have no project or sit inside
  a project this user owns, except entries of scope `GLOBAL` (see Anonymised).
  The creator foreign key is `SetNull`, which alone would keep them, so they
  are deleted explicitly. Entries this user created inside another owner's
  project are not touched here.
- The user row itself.

By an `onDelete: Cascade` foreign key: room participation, reactions, typing
status, `user_secrets`, `user_file_sources`, `user_plugin_preferences`, the
user's own inbox, and the projects the user owns with everything inside them
(tasks, whoever created them, task attachments, plugin module instances and
runs, project plugin links, project attachments, agent memory entries). Data
that other people put into a project this user owns goes with the project.

Rows inside projects other people own are **not** removed (see Anonymised).

## Anonymised (the row stays, the reference or the personal text goes)

- `agent_audit_log`: `agentId` becomes null (`onDelete: SetNull`), `details`
  of the user's own rows becomes JSON null, and the `assignedTo` key naming
  the user is removed from other rows. See Invariant 6 in
  [Prisma data-model invariants](prisma-data-model-invariants.md) for the
  residuals that stay.
- `invite_codes`: `createdById` becomes null (`SetNull`); `usedById` becomes
  null on every code the user redeemed; `note` becomes null on used codes the
  user created and on single-use codes (`maxUses` is 1) the user redeemed (a
  note can hold an email). A used code the user created stays as a record
  that it was redeemed, and stays deactivated. Whether a code counts as used
  is decided by its `useCount`, not by `usedById`, so a code whose redeemer
  deleted first is still kept, deactivated, when its creator deletes later.
- `approval_request`: `requestedBy` becomes null (`SetNull`); `decidedBy` and
  `decisionNote` become null on decisions the user made. The row, its status
  and `decidedAt` stay as the record that a decision was made.
- Rows the user created inside projects owned by other people stay, with the
  creator column null (`onDelete: SetNull`, nullable columns):
  `tasks.createdBy`, `plugin_module_instances.createdBy` (and the runs hanging
  off such an instance), `plugin_module_runs.startedBy`,
  `project_plugin_links.linkedBy`, `project_attachments.uploadedBy` and
  `agent_memory_entries.createdBy`. Clients render a null creator as a deleted
  user. The row's own content (task title and description, attachment
  filename, memory payload) is the project's data and stays. All six use
  `SetNull` rather than reassigning to the project owner: a null creator is
  honest, whereas an owner id would claim the owner authored the row.
- `agent_memory_entries` of scope `GLOBAL` the user created stay with
  `createdBy` null (operator decision: global memory is shared knowledge, not
  the user's personal data), including project-less ones. A `GLOBAL` entry
  that sits inside a project the user owns still goes with that project.
- `tasks.assignedTo` naming the user on tasks in projects the user does not
  own is reassigned to that project's owner, in the same transaction, and each
  such task gets one `agent_audit_log` row as the timeline note
  (`resourceType` `task`, `action` `task.assignee_reassigned`, `agentId` null,
  `details` `{ reason: "assignee_account_deleted", assignedTo: <owner id> }`;
  the deleted user's id is not written). Tasks assigned to the user inside
  projects the user owns are deleted with the project.
- `tasks.reviewedBy` becomes null where it names the user (no reviewer).
- The user's id is removed from every `projects.teamMemberIds` and every
  `agent_tokens.sharedWith` array.
- `messages.senderId` and `pinnedById`, `agent_memory_entries.updatedBy` and
  `plugin_installations.updatedBy` become null (`SetNull`). Message content
  is a separate item, below.
- The user's entry in `server/data/mention-limits.json` is removed after the
  commit, best effort: a failure is logged and never fails the request, and a
  corrupt or unreadable file is left untouched.

The scrubs of columns without a foreign key (`usedById`, `decidedBy`,
`reviewedBy`, `teamMemberIds`, `sharedWith`) remove the id at deletion time
only. A later or stale write that names the id again is not prevented.

## Kept

| What | Why it is kept |
| --- | --- |
| `messages` content, `aiContext`, `researchTag` (sender becomes null) | Other people's rooms and conversations depend on it. **Under review.** |
| `message_attachments` filename and url | Follows the message it belongs to. **Under review** with it. |
| `rooms.name` and `rooms.description` typed by the user | Rooms have no owner column; the text belongs to a room other people use. **Under review.** |
| `threads.createdBy` | Nothing in `server/src` writes it. |
| Title and description the user edited into other owners' tasks | The project owner's data. |
| `task_attachments.uploadedBy` and filename | Plain required column, part of the task. |
| The upload files of attachment rows that stay (for example attachments the user uploaded into other owners' projects) | The row stays, so does the file it points at. |
| `project_secrets.createdBy` on other owners' projects | The secret belongs to the project. **Under review.** |
| `connector_permissions.grantedBy` naming the user | The record of who authorised an agent. |
| `web_hook_configs.reviewerAgentId` | Nothing in `server/src` writes it. |
| Agent `User` rows the user registered | Kept deactivated so rooms and history that reference them stay coherent; their username and display name may embed the human's name. **Under review.** |
| `invite_codes.note` on codes this user neither created nor redeemed as a single-use code (for example an unused code, or a single-use code a third person redeemed) whose note mentions this user's email | Matching free text is not attempted. |
| `invite_codes.note` on multi-use codes (`maxUses` above 1) another user created and this user redeemed | The note is the creator's label for the whole code, can carry project routing, and the code stays active for later redeemers; `usedById` is still nulled. |
| `agent_audit_log` residuals | User-typed text copied into another actor's audit row, the slug of a user-typed room name inside `roomId`, and an `assignedTo` audit row (a task update or a reassignment row) written after the scrub ran. See Invariant 6. |

## Outside the database

- **Logs.** `logs/combined.log` and `logs/error.log` (winston,
  `server/src/utils/logger.ts`) can contain usernames, user ids and invitee
  emails. They are rotated by size only (10 MB, 5 files each); nothing is
  scrubbed on deletion.
- **Redis.** Cached messages (`message:<id>`) expire after one hour; the
  `online_users` presence set entry is removed when the user's last socket
  disconnects.
  Sockets that are already connected are not closed on deletion.
- **Upload files.** After the commit, best effort, the files in `server/uploads`
  of the `project_attachments` and `task_attachments` rows deleted with the
  user's own projects are unlinked. The URLs are collected inside the
  transaction, before the deletes. Only a URL of the exact form
  `/uploads/<one segment>` is acted on, the file name is resolved with
  `basename` and must sit directly in `server/uploads`, and a file is kept
  while any surviving `project_attachments`, `task_attachments` or
  `message_attachments` row still references the same upload (matched as a
  literal suffix: the last `/uploads/<name>` segment of the stored URL is
  compared with `/uploads/<name>` by equality, so backslash, percent and
  underscore in a name are never read as pattern characters). The lookup is
  batched, one query per table for all collected files, so each table is
  scanned once however many files there are, not once per file (the cost no
  longer grows with the number of files; with a single file it is higher than
  the old per-file count, see the CHANGELOG); when that lookup fails every
  file is kept. A failure
  is logged and never fails the request. Files of rows that stay (see Kept) are
  not unlinked, and a file uploaded into one of the user's projects in the
  instant between the URL collection and the commit is left on disk.
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
`server/src/__tests__/auth-self-delete-other-owners.test.ts` does the same for
the six relations above (the row in another owner's project survives with the
creator null, the row in the user's own project is gone, a control row of
another user is unchanged), the project-less memory entry (a `GLOBAL` one
survives, a non-`GLOBAL` one is gone), the assignee reassignment with its
audit row, and the upload-file unlinking (own-project files unlinked,
still-referenced files and nested, absolute and `../` URLs untouched, and the
still-referenced check matching a backslash or underscore in a file name
literally).
`server/src/__tests__/auth-self-delete.test.ts` proves every statement rolls
back when a later one fails, including the memory delete, the reassignment and
the file unlink. `server/src/__tests__/mentionLimiter-removal.test.ts`
covers the file cleanup helper.
