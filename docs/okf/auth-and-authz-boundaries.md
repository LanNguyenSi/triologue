---
type: invariant
title: Auth and authz boundaries — one middleware, two caller types
description: authenticate resolves both human JWTs and byoa_ agent tokens into an identical req.user (incl. isAdmin), so caller-type separation exists only in requireHuman/requireAdmin/requireAI and route-scoped byoaAuth; the Joi userType default keeps the OMITTED-userType register case gated, and an explicitly self-declared non-HUMAN userType is now rejected outright by the register route (fixed, agent-tasks 0bc4f108).
tags: [auth, authz, agents, byoa, security]
timestamp: 2026-07-09T03:34:19.437907Z
sources:
  - server/src/middleware/auth.ts
  - server/src/middleware/byoaAuth.ts
  - server/src/routes/auth.ts
  - server/src/routes/approvals.ts
  - server/src/routes/agents.ts
  - server/src/utils/validation.ts
  - server/prisma/schema.prisma
  - server/src/index.ts
---

## The invariant

One shared middleware, `authenticate` (server/src/middleware/auth.ts:6-78), authenticates two caller types off the same `Authorization: Bearer` header by token prefix. A `byoa_`-prefixed token (auth.ts:21-51) resolves `prisma.agentToken.findUnique` and populates `req.user` from the agent's OWN `User` record — id, username, userType, displayName, and `isAdmin` (auth.ts:42-48). Everything else is verified as a human JWT (auth.ts:53-72). After `authenticate`, the two caller types are indistinguishable by shape: **any route guarded only by `authenticate` is reachable by a BYOA agent token exactly like a human call.**

Caller-type separation therefore lives exclusively in three gates (auth.ts:109-136):

- `requireHuman` — 403 unless `req.user.userType === 'HUMAN'` (auth.ts:124).
- `requireAdmin` — 403 unless `req.user.isAdmin` (auth.ts:115). This is an entitlement gate, NOT a caller-type gate: the byoa branch copies the agent User's `isAdmin` into `req.user`, so an admin-flagged agent User would pass it.
- `requireAI` — 403 unless userType is in `['AI_AGENT', 'AI_ICE', 'AI_LAVA', 'AI_OTHER']` (auth.ts:132).

Agent Users carry `userType: "AI_AGENT"`: `POST /api/agents` creates them with exactly that value (server/src/routes/agents.ts:644), and `AgentToken.userId` is documented as "The agent's User record (userType=AI_AGENT)" (server/prisma/schema.prisma:240). `AI_ICE` / `AI_LAVA` / `AI_OTHER` are deprecated enum values kept only for migration compatibility (schema.prisma:342-349); `requireAI`'s acceptance of them is defensive handling of legacy rows, and `requireAI` currently has no route consumers at all (grep: no usage outside middleware/auth.ts).

`canTriggerAI` (schema.prisma:32, `Boolean @default(true)`) is a per-human trust flag. Agents created via `POST /api/agents` always get `canTriggerAI: false` — "Agents must not trigger other agents — prevents loops" (agents.ts:646). Note the asymmetry in `authenticate`: the JWT branch puts `canTriggerAI` on `req.user` (auth.ts:71), but the byoa branch's Prisma `select` omits it (auth.ts:26-33), so `req.user.canTriggerAI` is `undefined` for agent callers. Consumers must compare `=== true` (as `isTrustedCreator` does at agents.ts:628), which fails safe for agents; a `!== false` check would not.

## Where it's enforced

- **authenticate** (server/src/middleware/auth.ts:6-78): byoa branch rejects unless `agentToken.isActive && agentToken.status === 'active' && agentToken.agentUser.isActive` (auth.ts:38); JWT branch rejects inactive/missing users (auth.ts:60-62). Credentials are read only from the Authorization header; the old `?token=` query fallback was removed for log/Referer leakage (comment auth.ts:11-15).
- **byoaAuth** (server/src/middleware/byoaAuth.ts:79-109) is a second, agent-exclusive middleware for BYOA-only routes under `/api/agents` (mounted server/src/index.ts:148), e.g. `GET /me/context` (agents.ts:1825), `POST /message` (agents.ts:2290), `POST /mcp/call` (agents.ts:2723). It requires the `Bearer byoa_` prefix (byoaAuth.ts:30-34), attaches `req.agentToken` instead of `req.user`, and returns 403 for pending/rejected/deactivated agents (byoaAuth.ts:57-66). So the surfaces are: `authenticate` = shared (both caller types), `authenticate + requireHuman` = human-only, `byoaAuth` = agent-only.
- **Approvals** (server/src/routes/approvals.ts): `PATCH /api/approvals/:id/decide` is `authenticate, requireHuman` (approvals.ts:118) plus an entitlement check (isAdmin, or project owner/teamMemberIds; unscoped `projectId === null` approvals are admin-only, approvals.ts:50-69). This exists precisely because of the invariant above: `authenticate` alone let ANY authenticated caller — including the requesting agent's own byoa token — decide any approval (broken-access-control gap d065de21, closed in commit 00be0d0, PR #177; rationale documented in the file header approvals.ts:1-31). Full lifecycle in [approvals-lifecycle.md](approvals-lifecycle.md). The header also fixes ordering: the 403 entitlement check runs before the 409 pending-state check so response codes cannot probe approval state (approvals.ts:26-29).
- **Registration** (server/src/routes/auth.ts:62-239): `validate(userSchemas.register)` runs as route middleware before the handler and replaces `req.body` with the Joi-validated value (server/src/utils/validation.ts:190-209, assignment at :208). The register schema gives `userType` `.default('HUMAN')` (validation.ts:39-41), so an omitted `userType` materializes as `'HUMAN'` BEFORE the `REGISTRATION_MODE` gates run (`closed` gate auth.ts:79-80, `invite` gate auth.ts:109-113, both conditioned on `userType === 'HUMAN'`). **An omitted userType is therefore NOT an authz hole — do not "fix" the default or move validation after the gates; the default is what keeps the anonymous no-userType case gated.** As of the fix below, an explicit non-`'HUMAN'` `userType` is also rejected — a dedicated 403 guard (auth.ts:67-77) runs before either gate and before any DB read, independent of `REGISTRATION_MODE` (including `open`), so a self-declared `AI_*` value in the request body can no longer reach either gate at all.
- **REGISTRATION_MODE** resolves once at module import (routes/auth.ts:21-30): unset/empty defaults to `invite` (secure-by-default closed beta), and any other value than `open`/`invite`/`closed` THROWS at boot, so typos like `Open` cannot silently fall through to open registration (comment auth.ts:12-17).

## What breaks it

- Guarding an agent-sensitive route with `authenticate` alone. That is the approvals bug class (d065de21): a byoa token satisfies `authenticate` and arrives with a fully populated `req.user`. Any new human-only route MUST add `requireHuman`.
- Treating `requireAdmin` as a human gate. It only checks `isAdmin`, which the byoa branch copies from the agent's User record; combine with `requireHuman` when admin-and-human is meant.
- Reading `req.user.canTriggerAI` with anything but `=== true`. It is `undefined` for byoa callers (omitted from the select at auth.ts:26-33), and agent Users are persistently `canTriggerAI: false` (agents.ts:646); loosening either side re-opens agent-triggers-agent loops.
- Weakening the register Joi default. The omitted-userType case must keep resolving to `'HUMAN'` before the gates; that default is what keeps anonymous no-userType registration gated.
- Removing or narrowing the non-HUMAN userType guard (auth.ts:67-77). Both `REGISTRATION_MODE` gates are still conditioned on `userType === 'HUMAN'` (`closed` at auth.ts:79-80, `invite` at auth.ts:109-113); the guard is the only thing stopping a self-declared `AI_*` value from walking straight past both. It must keep running before either gate and before any DB read, and must not itself become conditioned on `REGISTRATION_MODE` (it applies in `open` mode too, since `/api/auth/register` is not how `AI_*` accounts are provisioned — see below).

**FIXED (agent-tasks `0bc4f108`):** both registration-mode gates fire only for `userType === 'HUMAN'` (`closed` at routes/auth.ts:79-80, `invite` at :109-113), and the public register route carries no `authenticate` middleware (auth.ts:62) while the Joi schema still permits `AI_*` values (utils/validation.ts:39-41). Previously an anonymous caller in `REGISTRATION_MODE=closed` or `=invite` could create an active account by sending `userType: 'AI_AGENT'` and receive a 30-day JWT (auth.ts:223, `expiresIn: userType === 'HUMAN' ? '7d' : '30d'`; `passwordHash` stays null, auth.ts:129-132), with the only mitigation being `registerLimit`, 3 requests/hour/IP (auth.ts:50-59, skipped under `NODE_ENV=test`) — no invite code, no email verification, no admin approval. `AI_*` accounts are provisioned exclusively through the authenticated BYOA agent-token flow, `POST /api/agents` (agents.ts:644, req.user-gated), never through this public route (the `it.skip`'d "register an AI user" case in `server/src/__tests__/auth.test.ts` is QUARANTINED for exactly this reason). The fix adds a dedicated guard (auth.ts:67-77) that rejects any client-supplied non-`'HUMAN'` `userType` with 403 before either mode gate or any Prisma call runs, independent of `REGISTRATION_MODE` (so `open` mode also rejects a self-declared `AI_*` registration now, not just `closed`/`invite`). Regression coverage: `server/src/__tests__/authRegistrationModes.test.ts` (route-level, mocked prisma, no DB needed — covers closed/invite/open rejection of `AI_AGENT`/`AI_ICE`/`AI_LAVA`/`AI_OTHER`, plus the unchanged HUMAN closed/invite/omitted-userType behavior).
- Removing the deprecated `AI_ICE`/`AI_LAVA`/`AI_OTHER` branches from `requireAI` or the `UserType` enum while legacy rows still carry those values (schema.prisma:345 keeps them explicitly for migration compatibility).
- Reintroducing a query-string token fallback in `authenticate`; header-less browser cases (image src, OAuth start) opt in locally at their own routes only (auth.ts:11-15).
