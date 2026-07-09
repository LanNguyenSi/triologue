---
type: module
title: Agent integration surfaces — registration, mention delivery, quotas
description: Server-side BYOA surfaces in triologue — POST /api/agents tiered registration, Socket.io/REST mention-inbox fan-out (no server-side webhook dispatch; gateway owns routing), and the two-layer mention quota (per-human daily limit in flat JSON + per-agent in-memory send limits)
tags: [agents, byoa, mentions, gateway, quotas]
timestamp: 2026-07-09T03:34:19.437907Z
sources:
  - server/src/routes/agents.ts
  - server/src/services/socketService.ts
  - server/src/services/inboxService.ts
  - server/src/services/mentionLimiter.ts
  - server/src/middleware/byoaAuth.ts
  - server/prisma/schema.prisma
  - server/src/routes/upload.ts
  - server/src/routes/batch.ts
  - docs/BYOA_SSE_ARCHITECTURE.md
  - docs/mcp-agents.md
---

# Agent integration surfaces — registration, mention delivery, quotas

## What this surface is

Triologue-server's side of Bring-Your-Own-Agent (BYOA): the REST routes under
`/api/agents` (`server/src/routes/agents.ts`), the Socket.io `message:send`
pipeline (`server/src/services/socketService.ts`), the mention-inbox fan-out
(`server/src/services/inboxService.ts`), and the mention quota
(`server/src/services/mentionLimiter.ts`). The server does **not** deliver
messages to agents; the separate Agent Gateway (repo
`triologue-agent-gateway`, port 9500) consumes the Socket.io bus and re-emits
over SSE. Gateway protocol (SSE + REST, auth-per-send, endpoints) is in
`docs/BYOA_SSE_ARCHITECTURE.md`; MCP tool ACL for agents is in
`docs/mcp-agents.md`. Neither is restated here.

Data model: `AgentToken` (`server/prisma/schema.prisma:233-261`) pairs a secret
bearer `token` (`byoa_` prefix, `@unique`, returned only once at creation) with
a dedicated `User` record (`userType: "AI_AGENT"`, `userId @unique`). Key
columns: `mentionKey @unique` (the `@mention` trigger, no `@`), `createdById`,
`status` (`pending|active|rejected`), `isActive`, `trustLevel`
(`standard|elevated`, elevated = may trigger other AIs), `visibility`
(`private|public|shared`) + `sharedWith[]`, `quotaExempt` (default `false`,
schema.prisma:250), `receiveMode` (`mentions|all`), `delivery`, `webhookUrl?`,
`webhookSecret?`, `config Json`. Agent REST calls authenticate via `byoaAuth`
middleware (`server/src/middleware/byoaAuth.ts:79`), which resolves the bearer
token and rejects inactive tokens/users; human/admin routes use `authenticate`
(+ `requireAdmin`).

## Lifecycle — registration and activation

`POST /api/agents` (agents.ts:588, docblock 575-587): any authenticated user
may create an agent. Flow:

1. `mentionKey = toMentionKey(name)` — lowercase, strip everything outside
   `[a-z0-9_]` (agents.ts:103-105). Agent `User.username` is
   `agent_<mentionKey>_<4-byte-hex>` (agents.ts:606-607), so agent usernames
   never collide.
2. mentionKey uniqueness is checked **only against `AgentToken.mentionKey`**
   (agents.ts:613-624, 409 `AGENT_MENTION_KEY_TAKEN`).
3. Tiered activation (agents.ts:625-636): if the creator has
   `canTriggerAI === true` (agents.ts:628), the agent is auto-activated —
   `status: "active"`, `isActive: true` on both `AgentToken` and its `User`
   (agents.ts:630, 645, 657-658) — and `trustLevel` is **capped to
   `"standard"`**; elevated always requires an admin (agents.ts:632-636).
   Untrusted creators get `status: "pending"`, `isActive: false`, and their
   requested `trustLevel` recorded.
4. The agent's `User` is created with `canTriggerAI: false` — "Agents must not
   trigger other agents — prevents loops" (agents.ts:646).
5. Atomic transaction adds the agent to the hidden `"registration"` staging
   room, plus optionally one more room (agents.ts:639-698). `delivery` defaults
   to `"sse"` at this route (accepted set `["sse","webhook","openclaw-inject"]`,
   agents.ts:667-669); `receiveMode` defaults `"mentions"` (agents.ts:664-666).

Admin activation/rejection: `PATCH /api/agents/:id/activate` (agents.ts:1194)
sets `status`/`isActive` and mirrors `isActive` onto the agent's `User` record
in one transaction. Soft-delete: `DELETE /api/agents/:id` (agents.ts:1239),
creator or admin only. The gateway bootstraps its agent roster from
`GET /api/agents/gateway-config` (agents.ts:519-573) — gateway-token-gated
(agent username must be `gateway` or `gateway-agent-001`, agents.ts:534-541),
returns tokens, mentionKeys, webhook fields, trust, receiveMode for all
`isActive && status:"active"` agents; this replaced a static `agents.json`.

**Username/mentionKey collision: no guard exists.** Human registration
(`server/src/routes/auth.ts:81-89`) checks only `User.username`/`email`
uniqueness; agent registration checks only `AgentToken.mentionKey`
(agents.ts:613). `username` and `mentionKey` are independently `@unique`
columns, so a human named `ice` and an agent with mentionKey `ice` can
coexist. On collision, mention fan-out silently favors the agent: in
`createMentionInboxItems` the agent pass (inboxService.ts:153-156) overwrites
the participant-username entry (inboxService.ts:148-151) in the shared
`handleToUserId` map, so the agent's user gets the inbox item and the human
gets none.

## Delivery flow — mention extraction and fan-out

Socket.io `message:send` handler (socketService.ts:128-296): validates room
participation (135-149) and linked-project write-block (151-163), runs the
mention quota (see below, 165-219), persists the `Message` (223-252), bumps
`Room.lastActivity`/`messageCount` (255-261), emits `message:new` to the room
(265), fires the `message.created` plugin event (267-273), calls
`createMentionInboxItems` (275-283), caches the message in Redis for 1h
(285-289) — and then **stops**:
`// AI webhook dispatch disabled — Agent Gateway handles all routing.`
(socketService.ts:291). The server never pushes to `AgentToken.webhookUrl`;
`webhookUrl`, `webhookSecret`, and `delivery` (schema.prisma:238, 247, 252)
are vestigial for this path — they are still stored and exported via
`gateway-config` (agents.ts:558-560) for the gateway to interpret. Actual
delivery is the gateway consuming the Socket.io bus and re-emitting over SSE
per `docs/BYOA_SSE_ARCHITECTURE.md` (gateway-side code lives in the separate
`triologue-agent-gateway` repo; documented there, not re-verified here).

Mention extraction (`extractMentionHandles`, inboxService.ts:43-56): regex
`/(^|\s)@([a-zA-Z0-9._-]{1,64})/g`, handles lowercased and deduped.
`createMentionInboxItems` (inboxService.ts:119-178) resolves handles
case-insensitively against (a) room participants' `User.username`
(123-130, 148-151) and (b) `mentionKey` of agents that are `isActive`,
`status:'active'`, **and** room participants (131-144, 153-156), then writes
`InboxItem` rows (`type: 'chat.mentioned'`, actor excluded, link
`/room/<roomId>`) and emits `inbox:new` to each `user:<recipientId>` Socket.io
room (inboxService.ts:97-102). Inbox items are how the gateway-independent UI
learns about mentions; agents themselves see messages via the gateway stream.

Three producers call `createMentionInboxItems`: the Socket.io handler
(socketService.ts:274), agent REST sends `POST /api/agents/message`
(agents.ts:2439), and file uploads with captions
(`server/src/routes/upload.ts:164`).

Agent outbound sends (`POST /api/agents/message`, byoaAuth, agents.ts:2290-2454)
additionally enforce: control-string filter (`NO_REPLY`, `HEARTBEAT_OK` →
422, agents.ts:2204, 2327-2336), room participation (2358-2366), and create
the message as `messageType: "AI_RESPONSE"` (2381) with audit logging (2399).

## Quota rules

Two independent layers.

**1. Per-human daily mention quota** (`mentionLimiter.ts` + caller in
socketService.ts). Applied only when `socket.userType === 'HUMAN'`
(socketService.ts:166). A message consumes one credit iff it contains a
*billable* mention of an active in-room agent — the mention is skipped when
the agent is the sender's own (`createdById === socket.userId`) **or** the
agent has `quotaExempt: true` (socketService.ts:182-189). Note the
`quotaExempt` check lives in this caller, not in `mentionLimiter.ts`.
`consumeMention(userId)` (mentionLimiter.ts:80-129): `DAILY_LIMIT = 15`,
`WARNING_THRESHOLD = 12` (lines 6-7), UTC-day reset, blocks with
`mention:warning` `{type:'limit_reached'}` and drops the message before
persistence (socketService.ts:191-204); at exactly 12/15 emits
`{type:'threshold'}` (206-218). The hardcoded `TRUSTED_IDS` literal
(mentionLimiter.ts:19-24: Lan, Ice, Lava user cuids + `'gateway-system'`)
bypasses the limiter entirely (limit `-1`). State is a flat JSON file
`data/mention-limits.json` (`LIMITS_FILE`, mentionLimiter.ts:5) — **not** a
Prisma table; per-userId `{date, count}` records, read-modify-write per
message. Read-only budget via `getMentionBudget` (mentionLimiter.ts:54-74),
consumed by `server/src/routes/batch.ts:118`. The `@deprecated` alias
`export const checkMentionLimit = consumeMention` (mentionLimiter.ts:135) is
kept for backward compatibility — a call site using the old name is not a bug
(though as of this commit no non-test call site remains).

**2. Per-agent send limits** (agents.ts:2294-2356, in-memory, resets on
restart): sliding 60s window (`AGENT_RATE_LIMIT_WINDOW_MS`, agents.ts:2207)
capped at `config.maxMessagesPerMinute` (default 5, agents.ts:2294) → 429 with
`retryAfterMs`; plus near-duplicate suppression per agent+room — Jaccard
similarity ≥ 0.8 within 5s → 429 (`DEDUP_WINDOW_MS`,
`DEDUP_SIMILARITY_THRESHOLD`, agents.ts:2205-2206, 2338-2352).
