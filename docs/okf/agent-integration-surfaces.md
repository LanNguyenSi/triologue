---
type: module
title: Agent integration surfaces — registration, mention delivery, quotas
description: Server-side BYOA surfaces in triologue — POST /api/agents tiered registration, Socket.io/REST mention-inbox fan-out (no server-side webhook dispatch; gateway owns routing), and the two-layer mention quota (per-human daily limit in flat JSON + per-agent in-memory send limits)
tags: [agents, byoa, mentions, gateway, quotas]
timestamp: 2026-11-10T08:08:32Z
sources:
  - server/src/lib/serviceAccounts.ts
  - server/src/routes/agents.ts
  - server/src/services/socketService.ts
  - server/src/services/inboxService.ts
  - server/src/services/mentionLimiter.ts
  - server/src/middleware/byoaAuth.ts
  - server/src/middleware/auth.ts
  - server/src/connectors/proxy.ts
  - server/src/routes/files.ts
  - server/src/services/agentTokenRotation.ts
  - server/src/routes/agentPresence.ts
  - server/src/services/agentPresence.ts
  - server/src/routes/rooms.ts
  - server/prisma/schema.prisma
  - server/src/routes/upload.ts
  - server/src/routes/batch.ts
  - server/src/routes/auth.ts
  - server/src/routes/rooms.ts
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

Data model: `AgentToken` (`server/prisma/schema.prisma:253-283`) pairs a secret
bearer `token` (`byoa_` prefix, `@unique`, returned only once at creation) with
a dedicated `User` record (`userType: "AI_AGENT"`, `userId @unique`). Key
columns: `mentionKey @unique` (the `@mention` trigger, no `@`), `createdById`,
`status` (`pending|active|rejected|revoked`; `revoked` is written by
`DELETE /api/agents/:id`, `agents.ts:1244#"revoked"`), `isActive`, `trustLevel`
(`standard|elevated`, see below), `visibility`
(`private|public|shared`) + `sharedWith[]`, `quotaExempt` (default `false`,
schema.prisma:270), `receiveMode` (`mentions|all`), `delivery`, `webhookUrl?`,
`webhookSecret?`, `config Json`, plus the rotation pair `previousToken? @unique` and
`previousTokenExpiresAt?` (schema.prisma:276-277, see "Token rotation" below).
`trustLevel` does not change which messages an agent receives (see
`docs/BYOA_SSE_ARCHITECTURE.md`). The gateway reads it from `gateway-config`
(`agents.ts:508#"trustLevel"`) for its per-agent send rate limit, and the agent invite rule of
`POST /api/rooms/:roomId/invite` (`server/src/routes/rooms.ts:666-683#"You can only invite your own agents to rooms"`) lets any
room owner or admin invite an elevated agent, while any other agent can be
invited only by its creator or a system admin. Agent REST calls authenticate via `byoaAuth`
middleware (`server/src/middleware/byoaAuth.ts:78`), which resolves the bearer
token and rejects inactive tokens/users; human/admin routes use `authenticate`
(+ `requireAdmin`).

## Lifecycle — registration and activation

`POST /api/agents` (agents.ts:536, docblock 522-534): any authenticated user
may create an agent. Flow:

1. `mentionKey = toMentionKey(name)` — lowercase, strip everything outside
   `[a-z0-9_]` (agents.ts:102-104). Agent `User.username` is
   `agent_<mentionKey>_<4-byte-hex>` (agents.ts:567-568), so agent usernames
   never collide.
2. mentionKey uniqueness is checked **only against `AgentToken.mentionKey`**
   (agents.ts:573-585, 409 `AGENT_MENTION_KEY_TAKEN`).
3. Tiered activation (agents.ts:586-597): if the creator has
   `canTriggerAI === true` (agents.ts:589), the agent is auto-activated -
   `status: "active"`, `isActive: true` on both `AgentToken` and its `User`
   (agents.ts:591, 592, 604-605) - and `trustLevel` is **capped to
   `"standard"`**; elevated always requires an admin (agents.ts:593-597).
   Untrusted creators get `status: "pending"`, `isActive: false`, and their
   requested `trustLevel` recorded.
4. The agent's `User` is created with `canTriggerAI: false` — "Agents must not
   trigger other agents - prevents loops" (agents.ts:607).
5. Atomic transaction adds the agent to the hidden `"registration"` staging
   room, plus optionally one more room (agents.ts:600-659). `delivery` defaults
   to `"sse"` at this route (accepted set `["sse","webhook","openclaw-inject"]`,
   agents.ts:628-630); `receiveMode` defaults `"mentions"` (agents.ts:625-627).

Admin activation/rejection: `PATCH /api/agents/:id/activate` (agents.ts:1165)
sets `status`/`isActive` and mirrors `isActive` onto the agent's `User` record
in one transaction. Soft-delete: `DELETE /api/agents/:id` (agents.ts:1210),
creator or admin only. The gateway bootstraps its agent roster from
`GET /api/agents/gateway-config` (agents.ts:479-521) - gateway-token-gated
(agent username must be one of `SERVICE_ACCOUNT_USERNAMES` from
`server/src/lib/serviceAccounts.ts`, i.e. `gateway` or `gateway-agent-001`,
which public registration refuses; checked by the shared
helper `authenticateGatewayCaller`, agents.ts:2920-2945, username check
agents.ts:2932-2936; gateway-config calls it with `requireActive: false`, so
the gateway's own row is not checked for `isActive`), returns tokens,
mentionKeys, webhook fields, trust, receiveMode for all
`isActive && status:"active"` agents plus `previousToken` /
`previousTokenExpiresAt` per agent (agents.ts:513; both null outside a rotation
grace window); this replaced a static `agents.json`.

## Token rotation

`POST /api/agents/:id/token/rotate` (agents.ts:2967-3031, appended after the
last route) rotates an agent's bearer token. It is deliberately NOT behind
`authenticate`: a `byoa_` token satisfies that middleware (see
[auth-and-authz-boundaries.md](auth-and-authz-boundaries.md)). Authorization is
two headers at once: the gateway's own token in `Authorization`, via
`authenticateGatewayCaller` with `requireActive: true` (the gateway's row must
be `isActive` and `status: "active"`, agents.ts:2938-2943), AND the agent's
CURRENT token in `X-Agent-Token`, compared in constant time (`tokensEqual`,
agents.ts:2948-2952; the check is agents.ts:2993-2995). The previous token is
never accepted as proof, so a retry with the old token gets 403 and the route
is not idempotent by design. `X-Agent-Token` is a confirmation, not an
independent second credential: `gateway-config` hands every active agent's
current token to the gateway bearer, so the gateway token is the effective
authority. Recovery for a compromised gateway token is not a revoke:
`gateway-config` calls `authenticateGatewayCaller` with `requireActive: false`
and matches the gateway row by `token` value alone, so an API revoke
(`DELETE /api/agents/:id`, which sets `isActive: false` and `status`
`"revoked"`, `agents.ts:1244#"revoked"`) or an admin suspend
(`PATCH /api/agents/:id` with `isActive: false`) leaves the leaked bearer
working at `gateway-config`. What locks it out is changing the row's `token`
value or deleting the row. The route that exists today: rotate the gateway's
own row through this same route (`:id` = the gateway agentToken id, the
current gateway token in both `Authorization` and `X-Agent-Token`). Rotate
before any revoke or suspend: the caller side needs the gateway row active
too (`requireActive: true`), so a revoked, suspended or deleted row can no
longer rotate itself (403 at the caller check). At the swap the leaked value
stops working at `gateway-config` and at this route, because
`authenticateGatewayCaller` never honours `previousToken`; it stays a valid
bearer for the grace window everywhere `findAgentTokenByRawToken` is used (the
`authenticate` byoa branch, `byoaAuth`, the connector proxy, files; see the
previous-token section below). To end that window early, an admin suspends
and then unsuspends the gateway row (`PATCH /api/agents/:id` with
`isActive: false`, then `true`; the suspend nulls the previous-token slot,
`agents.ts:990#"previousToken: null"`), which posts an `agent:warning` into each
of the gateway's rooms. The alternative is to update or delete that row directly in the
database (the API `DELETE` only soft-deletes), where the gateway account was
created outside the API anyway (the seed never creates it, see
[bootstrap-seed-and-default-identities.md](bootstrap-seed-and-default-identities.md)).
A leaked gateway token has also exposed every active agent's current token
through `gateway-config`, so those tokens need rotating as well.
Unknown agent or deleted agent user is 404; a row that is not `isActive`/`active`,
or whose agent `User` is not active, is 403 (agents.ts:2984-2990).

The swap is `rotateAgentToken` (services/agentTokenRotation.ts:97), an
`updateMany` whose `where` is `{ id, token: currentToken, isActive: true,
status: "active" }`: a compare-and-swap, so of two concurrent rotations exactly
one matches and the loser gets 409, and a rotation that raced an admin reject or
a delete matches nothing and does not commit either
(`RotateConflictError`, agents.ts:3018). It moves the old token into
`AgentToken.previousToken` with `previousTokenExpiresAt = now + grace`; a second
rotation overwrites that slot, so at most one previous token exists. Grace is
300 s by default, `AGENT_TOKEN_ROTATE_GRACE_SECONDS` clamped to 30..3600
(`rotateGraceMs`, services/agentTokenRotation.ts:30). Success is 200 with
`Cache-Control: no-store` and `{ agentId, token, previousTokenExpiresAt,
graceSeconds }`, and one `agent.token.rotate` audit row (agents.ts:3002-3008)
whose details carry `graceSeconds` and the expiry, never a token value.

The previous token is honoured only at the bearer lookup sites, all through
`findAgentTokenByRawToken` (services/agentTokenRotation.ts:61): a single
`findUnique` on `token`, and only on a miss a `findFirst` on `previousToken`
with `previousTokenExpiresAt > now` (dead at the exact expiry instant,
`isPreviousTokenLive`, services/agentTokenRotation.ts:45). Sites:
`resolveActiveAgentToken` for `byoaAuth` (middleware/byoaAuth.ts:47), the
`authenticate` byoa branch (middleware/auth.ts:23), the connector proxy
(connectors/proxy.ts:35) and the files route (routes/files.ts:110). Every
one keeps its status/`isActive` checks on the resolved row, so an admin reject
or a delete revokes the current and the previous token together (both writes
also null the previous-token slot, agents.ts:1185 and 1220). An admin suspend
(`PATCH /api/agents/:id` with `isActive: false`, agents.ts:990) nulls the slot
too, so a later unsuspend brings back only the current token. Login by
`aiToken` (routes/auth.ts) and the gateway's own bearer lookup do not accept
the previous token. Expired previous tokens are inert and there is no cleanup
job; the next rotation overwrites the slot.

Listings never carry a secret: `GET /api/agents/mine` (agents.ts:710) and
the admin list `GET /api/agents` (agents.ts:769) pass every row through
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
(`server/src/routes/auth.ts:95-106`) checks only `User.username`/`email`
uniqueness; agent registration checks only `AgentToken.mentionKey`
(agents.ts:574). `username` and `mentionKey` are independently `@unique`
columns, so a human named `ice` and an agent with mentionKey `ice` can
coexist. On collision, mention fan-out silently favors the agent: in
`createMentionInboxItems` the agent pass (inboxService.ts:153-156) overwrites
the participant-username entry (inboxService.ts:148-151) in the shared
`handleToUserId` map, so the agent's user gets the inbox item and the human
gets none.

## Delivery flow — mention extraction and fan-out

Socket.io `message:send` handler (socketService.ts:139-363): validates room
participation (146-160) and linked-project write-block (162-174), refuses a
`threadId` that is not a non-empty string without NUL or lone surrogate naming a thread of the room (176-201,
before the mention quota is consumed and before any write; the error event reads
`threadId must name a thread in this room`), runs the mention quota (see below,
203-258), persists the `Message` (260-308; a thread reply increments the
thread's `messageCount` and sets `lastActivity` in the same `$transaction` as
the insert), bumps `Room.lastActivity`/`messageCount` (310-317), emits
`message:new` to the room (320), fires the `message.created` plugin event
(322-328), calls `createMentionInboxItems` (330-338), caches the message in
Redis for 1h (340-353, now non-blocking via `.catch()` per PR #192 so a Redis
outage no longer mis-reports a sent message as failed) — and then **stops**:
`// AI webhook dispatch disabled — Agent Gateway handles all routing.`
(socketService.ts:371). The server never pushes to `AgentToken.webhookUrl`;
`webhookUrl`, `webhookSecret`, and `delivery` (schema.prisma:258, 267, 272)
are vestigial for this path — they are still stored and exported via
`gateway-config` (agents.ts:505-507) for the gateway to interpret. Actual
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
(socketService.ts:346), agent REST sends `POST /api/agents/message`
(agents.ts:2515), and file uploads with captions
(`server/src/routes/upload.ts:156`).

Agent outbound sends (`POST /api/agents/message`, byoaAuth, agents.ts:2298-2534)
additionally enforce: control-string filter (`NO_REPLY`, `HEARTBEAT_OK` →
422, agents.ts:2207, 2364-2373), room participation (2391-2399), an optional
`threadId` that must name a thread of the room (looked up only after the
participation check, 2411-2421; a malformed value, including one with a NUL
character or a lone surrogate, is refused earlier, 2350-2360),
and create the message as `messageType: "AI_RESPONSE"` (2435) with audit
logging (2477, `threadId` in the details when one was used). A thread reply is
inserted and the thread's `messageCount`/`lastActivity` bumped in one
`$transaction` (2454-2467); a top-level message skips it.

## Agent presence

The gateway reports a running session's status with `POST /api/agents/me/presence`,
a byoaAuth-only router mounted ahead of `/api/agents`
(`server/src/index.ts:198#"app.use(\"/api/agents/me/presence\", agentPresenceRoutes);"`).
The status (`online`, `working`, `waiting_approval`, `error`; `offline` deletes)
is written to Redis under `agent_presence:<agentUserId>` with the caller's
TTL, 30 to 300 seconds, default 120
(`server/src/services/agentPresence.ts:16#"export const AGENT_PRESENCE_TTL_DEFAULT_SECONDS = 120;"`,
`server/src/routes/agentPresence.ts:107#"await redis.set(key, JSON.stringify(stored), { EX: ttl.value });"`),
keyed by the token's user and never by the body
(`server/src/routes/agentPresence.ts:102#"const key = agentPresenceKey(agentToken.userId);"`).
A failed write answers 503 and broadcasts nothing
(`server/src/routes/agentPresence.ts:110#"logger.warn(\"[agents] presence store write failed:\", err);"`).
The report is then pushed as `agent:presence`, once, to every room the agent
participates in except `PRESENCE_EXCLUDED_ROOM_IDS`, for which the room
detail route skips the lookup as well
(`server/src/routes/agentPresence.ts:126#".filter((roomId) => !PRESENCE_EXCLUDED_ROOM_IDS.includes(roomId));"`).
`GET /api/rooms/:roomId` reads the keys of all agent participants in one
`mGet` (`server/src/routes/rooms.ts:317#"if (agentUserIds.length > 0 && !PRESENCE_EXCLUDED_ROOM_IDS.includes(roomId)) {"`)
and lets a stored status win over the `online_users` / `lastUsedAt`
guess, mapped to `working`, `waiting`, `error` or `online` with
`presenceMeta`; a Redis failure or a malformed value falls back to the guess
(`server/src/routes/rooms.ts:318-320#".catch(() => [] as (string | null)[]);"`,
`server/src/services/agentPresence.ts:72#"export function toParticipantPresence(status: AgentPresenceStatus): ParticipantPresence {"`).
No table and no migration are involved; the writer (the gateway's session
registry) is described in the Sessions section of
`docs/BYOA_SSE_ARCHITECTURE.md` (gateway-side, documented in the gateway
repo, not re-verified here).

## Quota rules

Two independent layers.

**1. Per-human daily mention quota** (`mentionLimiter.ts` + caller in
socketService.ts). Applied only when `socket.userType === 'HUMAN'`
(socketService.ts:220). A message consumes one credit iff it contains a
*billable* mention of an active in-room agent — the mention is skipped when
the agent is the sender's own (`createdById === socket.userId`) **or** the agent has `quotaExempt: true` (socketService.ts:236-243). Note the
`quotaExempt` check lives in this caller, not in `mentionLimiter.ts`.
`consumeMention(userId)` (mentionLimiter.ts:80-129): `DAILY_LIMIT = 15`,
`WARNING_THRESHOLD = 12` (lines 6-7), UTC-day reset, blocks with
`mention:warning` `{type:'limit_reached'}` and drops the message before
persistence (socketService.ts:248-258); at exactly 12/15 emits
`{type:'threshold'}` (216-228). The hardcoded `TRUSTED_IDS` literal
(mentionLimiter.ts:19-24: Lan, Ice, Lava user cuids + `'gateway-system'`)
bypasses the limiter entirely (limit `-1`). State is a flat JSON file
`data/mention-limits.json` (`LIMITS_FILE`, mentionLimiter.ts:5) — **not** a
Prisma table; per-userId `{date, count}` records, read-modify-write per
message; when a user deletes their own account their entry is removed from that
file best effort once the transaction commits (`removeMentionLimitEntry`,
mentionLimiter.ts:148-161, called at `server/src/routes/auth.ts:1102`). Read-only
budget via `getMentionBudget` (mentionLimiter.ts:54-74), consumed by
`server/src/routes/batch.ts:112`. The `@deprecated` alias
`export const checkMentionLimit = consumeMention` (mentionLimiter.ts:135) is
kept for backward compatibility — a call site using the old name is not a bug
(though as of this commit no non-test call site remains).

**2. Per-agent send limits** (agents.ts:2302-2389, in-memory, resets on
restart): sliding 60s window (`AGENT_RATE_LIMIT_WINDOW_MS`, agents.ts:2210)
capped at `config.maxMessagesPerMinute` (default 5, agents.ts:2302) → 429 with
`retryAfterMs`; plus near-duplicate suppression per agent+room — Jaccard
similarity ≥ 0.8 within 5s → 429 (`DEDUP_WINDOW_MS`,
`DEDUP_SIMILARITY_THRESHOLD`, agents.ts:2208-2209, 2375-2389; the remembered
text is recorded only after the message is stored, 2472-2475, so a send
refused with 400 or 403 does not turn its corrected retry into a duplicate).
