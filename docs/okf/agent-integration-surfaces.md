---
type: module
title: Agent integration surfaces — registration, mention delivery, quotas
description: Server-side BYOA surfaces in triologue — POST /api/agents tiered registration, Socket.io/REST mention-inbox fan-out (no server-side webhook dispatch; gateway owns routing), and the two-layer mention quota (per-human daily limit in flat JSON + per-agent in-memory send limits)
tags: [agents, byoa, mentions, gateway, quotas]
timestamp: 2026-10-05T14:00:53Z
sources:
  - server/src/routes/agents.ts
  - server/src/services/socketService.ts
  - server/src/services/inboxService.ts
  - server/src/services/mentionLimiter.ts
  - server/src/middleware/byoaAuth.ts
  - server/src/middleware/auth.ts
  - server/src/connectors/proxy.ts
  - server/src/routes/files.ts
  - server/src/services/agentTokenRotation.ts
  - server/prisma/schema.prisma
  - server/src/routes/upload.ts
  - server/src/routes/batch.ts
  - server/src/routes/auth.ts
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

Data model: `AgentToken` (`server/prisma/schema.prisma:239-269`) pairs a secret
bearer `token` (`byoa_` prefix, `@unique`, returned only once at creation) with
a dedicated `User` record (`userType: "AI_AGENT"`, `userId @unique`). Key
columns: `mentionKey @unique` (the `@mention` trigger, no `@`), `createdById`,
`status` (`pending|active|rejected`), `isActive`, `trustLevel`
(`standard|elevated`, elevated = may trigger other AIs), `visibility`
(`private|public|shared`) + `sharedWith[]`, `quotaExempt` (default `false`,
schema.prisma:256), `receiveMode` (`mentions|all`), `delivery`, `webhookUrl?`,
`webhookSecret?`, `config Json`, plus the rotation pair `previousToken? @unique` and
`previousTokenExpiresAt?` (schema.prisma:262-263, see "Token rotation" below). Agent REST calls authenticate via `byoaAuth`
middleware (`server/src/middleware/byoaAuth.ts:78`), which resolves the bearer
token and rejects inactive tokens/users; human/admin routes use `authenticate`
(+ `requireAdmin`).

## Lifecycle — registration and activation

`POST /api/agents` (agents.ts:535, docblock 522-534): any authenticated user
may create an agent. Flow:

1. `mentionKey = toMentionKey(name)` — lowercase, strip everything outside
   `[a-z0-9_]` (agents.ts:101-103). Agent `User.username` is
   `agent_<mentionKey>_<4-byte-hex>` (agents.ts:553-554), so agent usernames
   never collide.
2. mentionKey uniqueness is checked **only against `AgentToken.mentionKey`**
   (agents.ts:559-571, 409 `AGENT_MENTION_KEY_TAKEN`).
3. Tiered activation (agents.ts:572-583): if the creator has
   `canTriggerAI === true` (agents.ts:575), the agent is auto-activated —
   `status: "active"`, `isActive: true` on both `AgentToken` and its `User`
   (agents.ts:577, 592, 604-605) — and `trustLevel` is **capped to
   `"standard"`**; elevated always requires an admin (agents.ts:579-583).
   Untrusted creators get `status: "pending"`, `isActive: false`, and their
   requested `trustLevel` recorded.
4. The agent's `User` is created with `canTriggerAI: false` — "Agents must not
   trigger other agents — prevents loops" (agents.ts:593).
5. Atomic transaction adds the agent to the hidden `"registration"` staging
   room, plus optionally one more room (agents.ts:586-645). `delivery` defaults
   to `"sse"` at this route (accepted set `["sse","webhook","openclaw-inject"]`,
   agents.ts:614-616); `receiveMode` defaults `"mentions"` (agents.ts:611-613).

Admin activation/rejection: `PATCH /api/agents/:id/activate` (agents.ts:1141)
sets `status`/`isActive` and mirrors `isActive` onto the agent's `User` record
in one transaction. Soft-delete: `DELETE /api/agents/:id` (agents.ts:1186),
creator or admin only. The gateway bootstraps its agent roster from
`GET /api/agents/gateway-config` (agents.ts:478-520) — gateway-token-gated
(agent username must be `gateway` or `gateway-agent-001`, checked by the shared
helper `authenticateGatewayCaller`, agents.ts:2787-2813, username check
agents.ts:2799-2804; gateway-config calls it with `requireActive: false`, so
the gateway's own row is not checked for `isActive`), returns tokens,
mentionKeys, webhook fields, trust, receiveMode for all
`isActive && status:"active"` agents plus `previousToken` /
`previousTokenExpiresAt` per agent (agents.ts:512; both null outside a rotation
grace window); this replaced a static `agents.json`.

## Token rotation

`POST /api/agents/:id/token/rotate` (agents.ts:2835-2899, appended after the
last route) rotates an agent's bearer token. It is deliberately NOT behind
`authenticate`: a `byoa_` token satisfies that middleware (see
[auth-and-authz-boundaries.md](auth-and-authz-boundaries.md)). Authorization is
two headers at once: the gateway's own token in `Authorization`, via
`authenticateGatewayCaller` with `requireActive: true` (the gateway's row must
be `isActive` and `status: "active"`, agents.ts:2806-2811), AND the agent's
CURRENT token in `X-Agent-Token`, compared in constant time (`tokensEqual`,
agents.ts:2816-2820; the check is agents.ts:2861-2863). The previous token is
never accepted as proof, so a retry with the old token gets 403 and the route
is not idempotent by design. `X-Agent-Token` is a confirmation, not an
independent second credential: `gateway-config` hands every active agent's
current token to the gateway bearer, so the gateway token is the effective
authority, and recovery for a compromised gateway token is revoke and re-mint.
Unknown agent or deleted agent user is 404; a row that is not `isActive`/`active`,
or whose agent `User` is not active, is 403 (agents.ts:2852-2858).

The swap is `rotateAgentToken` (services/agentTokenRotation.ts:97), an
`updateMany` whose `where` is `{ id, token: currentToken, isActive: true,
status: "active" }`: a compare-and-swap, so of two concurrent rotations exactly
one matches and the loser gets 409, and a rotation that raced an admin reject or
a delete matches nothing and does not commit either
(`RotateConflictError`, agents.ts:2886). It moves the old token into
`AgentToken.previousToken` with `previousTokenExpiresAt = now + grace`; a second
rotation overwrites that slot, so at most one previous token exists. Grace is
300 s by default, `AGENT_TOKEN_ROTATE_GRACE_SECONDS` clamped to 30..3600
(`rotateGraceMs`, services/agentTokenRotation.ts:30). Success is 200 with
`Cache-Control: no-store` and `{ agentId, token, previousTokenExpiresAt,
graceSeconds }`, and one `agent.token.rotate` audit row (agents.ts:2870-2876)
whose details carry `graceSeconds` and the expiry, never a token value.

The previous token is honoured only at the bearer lookup sites, all through
`findAgentTokenByRawToken` (services/agentTokenRotation.ts:61): a single
`findUnique` on `token`, and only on a miss a `findFirst` on `previousToken`
with `previousTokenExpiresAt > now` (dead at the exact expiry instant,
`isPreviousTokenLive`, services/agentTokenRotation.ts:45). Sites:
`resolveActiveAgentToken` for `byoaAuth` (middleware/byoaAuth.ts:47), the
`authenticate` byoa branch (middleware/auth.ts:23), the connector proxy
(connectors/proxy.ts:34) and the files route (routes/files.ts:119, 134). Every
one keeps its status/`isActive` checks on the resolved row, so an admin reject
or a delete revokes the current and the previous token together (both writes
also null the previous-token slot, agents.ts:1161 and 1220). An admin suspend
(`PATCH /api/agents/:id` with `isActive: false`, agents.ts:966) nulls the slot
too, so a later unsuspend brings back only the current token. Login by
`aiToken` (routes/auth.ts) and the gateway's own bearer lookup do not accept
the previous token. Expired previous tokens are inert and there is no cleanup
job; the next rotation overwrites the slot.

Listings never carry a secret: `GET /api/agents/mine` (agents.ts:696) and
the admin list `GET /api/agents` (agents.ts:755) pass every row through
`redactAgentTokenRow` (services/agentTokenRotation.ts:160), which blanks every
field listed in `AGENT_TOKEN_SECRET_FIELDS` (services/agentTokenRotation.ts:144),
read from the list at call time: `token: "[redacted]"`, every other listed field
(today `previousToken` and `webhookSecret`) `null`, plus two flags:
`hasPreviousToken`, true only while a grace window is open, and
`hasWebhookSecret`, true when a non-empty webhook secret is stored. A new
secret column on `AgentToken` is redacted by adding it to that list; a unit
test classifies every column of the model and fails until it is. The webhook
secret is still handed to the gateway bearer by `gateway-config` (below) and
is never returned by any other agent route (the creation response returns the
token only; the single-agent routes build their responses from named
fields, although some read the full row internally), and no client
under `client/src` reads it.

**Username/mentionKey collision: no guard exists.** Human registration
(`server/src/routes/auth.ts:90-101`) checks only `User.username`/`email`
uniqueness; agent registration checks only `AgentToken.mentionKey`
(agents.ts:560). `username` and `mentionKey` are independently `@unique`
columns, so a human named `ice` and an agent with mentionKey `ice` can
coexist. On collision, mention fan-out silently favors the agent: in
`createMentionInboxItems` the agent pass (inboxService.ts:153-156) overwrites
the participant-username entry (inboxService.ts:148-151) in the shared
`handleToUserId` map, so the agent's user gets the inbox item and the human
gets none.

## Delivery flow — mention extraction and fan-out

Socket.io `message:send` handler (socketService.ts:138-314): validates room
participation (144-159) and linked-project write-block (161-173), runs the
mention quota (see below, 175-230), persists the `Message` (232-262), bumps
`Room.lastActivity`/`messageCount` (264-271), emits `message:new` to the room
(274), fires the `message.created` plugin event (276-282), calls
`createMentionInboxItems` (284-292), caches the message in Redis for 1h
(294-307, now non-blocking via `.catch()` per PR #192 so a Redis outage no
longer mis-reports a sent message as failed) — and then **stops**:
`// AI webhook dispatch disabled — Agent Gateway handles all routing.`
(socketService.ts:309). The server never pushes to `AgentToken.webhookUrl`;
`webhookUrl`, `webhookSecret`, and `delivery` (schema.prisma:244, 253, 258)
are vestigial for this path — they are still stored and exported via
`gateway-config` (agents.ts:504-506) for the gateway to interpret. Actual
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
(socketService.ts:284), agent REST sends `POST /api/agents/message`
(agents.ts:2386), and file uploads with captions
(`server/src/routes/upload.ts:156`).

Agent outbound sends (`POST /api/agents/message`, byoaAuth, agents.ts:2237-2401)
additionally enforce: control-string filter (`NO_REPLY`, `HEARTBEAT_OK` →
422, agents.ts:2151, 2274-2283), room participation (2305-2313), and create
the message as `messageType: "AI_RESPONSE"` (2328) with audit logging (2346).

## Quota rules

Two independent layers.

**1. Per-human daily mention quota** (`mentionLimiter.ts` + caller in
socketService.ts). Applied only when `socket.userType === 'HUMAN'`
(socketService.ts:176). A message consumes one credit iff it contains a
*billable* mention of an active in-room agent — the mention is skipped when
the agent is the sender's own (`createdById === socket.userId`) **or** the agent has `quotaExempt: true` (socketService.ts:192-199). Note the
`quotaExempt` check lives in this caller, not in `mentionLimiter.ts`.
`consumeMention(userId)` (mentionLimiter.ts:80-129): `DAILY_LIMIT = 15`,
`WARNING_THRESHOLD = 12` (lines 6-7), UTC-day reset, blocks with
`mention:warning` `{type:'limit_reached'}` and drops the message before
persistence (socketService.ts:204-214); at exactly 12/15 emits
`{type:'threshold'}` (216-228). The hardcoded `TRUSTED_IDS` literal
(mentionLimiter.ts:19-24: Lan, Ice, Lava user cuids + `'gateway-system'`)
bypasses the limiter entirely (limit `-1`). State is a flat JSON file
`data/mention-limits.json` (`LIMITS_FILE`, mentionLimiter.ts:5) — **not** a
Prisma table; per-userId `{date, count}` records, read-modify-write per
message; when a user deletes their own account their entry is removed from that
file best effort once the transaction commits (`removeMentionLimitEntry`,
mentionLimiter.ts:148-161, called at `server/src/routes/auth.ts:1002`). Read-only
budget via `getMentionBudget` (mentionLimiter.ts:54-74), consumed by
`server/src/routes/batch.ts:112`. The `@deprecated` alias
`export const checkMentionLimit = consumeMention` (mentionLimiter.ts:135) is
kept for backward compatibility — a call site using the old name is not a bug
(though as of this commit no non-test call site remains).

**2. Per-agent send limits** (agents.ts:2241-2303, in-memory, resets on
restart): sliding 60s window (`AGENT_RATE_LIMIT_WINDOW_MS`, agents.ts:2154)
capped at `config.maxMessagesPerMinute` (default 5, agents.ts:2241) → 429 with
`retryAfterMs`; plus near-duplicate suppression per agent+room — Jaccard
similarity ≥ 0.8 within 5s → 429 (`DEDUP_WINDOW_MS`,
`DEDUP_SIMILARITY_THRESHOLD`, agents.ts:2152-2153, 2285-2299).
