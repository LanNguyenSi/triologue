---
type: invariant
title: Bootstrap seed and default identities, what every api start creates or resets
description: The api container runs migrations and prisma/seed.ts on every start. The seed creates the admin from ADMIN_USERNAME/ADMIN_PASSWORD only once and never changes a password, re-asserts the admin flag and the elevated sample agents ice and lava on every start, optionally upserts the agent-tasks MCP connection, and never creates the gateway service account. A failed seed stops the container before the server starts.
tags: [seed, bootstrap, admin, agents, deployment, security]
timestamp: 2026-10-23T04:42:43Z
sources:
  - server/entrypoint.sh
  - server/Dockerfile
  - server/package.json
  - server/prisma/seed.ts
  - server/src/connectors/mcp/agentTasksSeed.ts
  - server/src/connectors/mcp/mcpHealthCheck.ts
  - server/src/lib/serviceAccounts.ts
  - server/src/routes/auth.ts
  - server/src/routes/agents.ts
  - server/src/routes/admin.ts
  - server/prisma/schema.prisma
  - .env.example
  - docker-compose.yml
---

# Bootstrap seed and default identities

Operator steps for the first start live in [deployment.md, First start](../deployment.md#first-start) and the variables in [environment.md](../environment.md). This doc records the cross-file behaviour behind them: which rows the seed writes on every start, which it writes only once, and which identities it never creates.

## When the seed runs

- The image's entrypoint is `server/entrypoint.sh` (`server/Dockerfile:50-51#"ENTRYPOINT"`). It applies migrations, then runs the seed with `ts-node`, then starts the server (`server/entrypoint.sh:10-11#"npx prisma migrate deploy"`, `server/entrypoint.sh:16-17#"exec npm start"`). This happens on every container start, not only the first.
- The seed command is `npx ts-node prisma/seed.ts` (`server/entrypoint.sh:14#"npx ts-node prisma/seed.ts"`), run under `set -e` (`server/entrypoint.sh:2#"set -e"`). A seed that exits non-zero stops the entrypoint before `exec npm start`, so the container exits and the server does not start; the seed exits 1 on any error (`server/prisma/seed.ts:181-183#"process.exit(1)"`). Until the entrypoint dropped its `||` fallback, a failed seed only printed "Seed skipped" and the server started anyway. `ts-node` is a devDependency (`server/package.json:57#"ts-node"`), and the image installs devDependencies because the build runs a plain `npm install` without `NODE_ENV` (`server/Dockerfile:19-20#"RUN npm install"`), so a missing `ts-node` is not the usual cause of a failure.
- The `api` service reads `.env` as its environment (`docker-compose.yml:77#"env_file: .env"`), so the `ADMIN_*`, `ICE_WEBHOOK_URL`/`LAVA_WEBHOOK_URL` and `AGENT_TASKS_MCP_*` values there reach the seed. The manual path (`npm run db:seed`, `server/package.json:16#"db:seed"`) runs the same script once, with whatever `server/.env` sets.

## What the seed writes

Created when missing (an existing row keeps its values unless it is listed under the next heading):

- The `onboarding` room (upsert with an empty update, `server/prisma/seed.ts:48-51#"create: room"`).
- The admin user: username `ADMIN_USERNAME`, password `ADMIN_PASSWORD` (bcrypt cost 12), display name `ADMIN_DISPLAY_NAME`, `userType` `HUMAN` (`server/prisma/seed.ts:61#"bcrypt.hash(password, 12)"`, `server/prisma/seed.ts:65-69#"isAdmin: true"`). Each of the three variables falls back to a built-in value when unset (`server/prisma/seed.ts:57-59#"ADMIN_DISPLAY_NAME"`). The seed sets no email.
- The admin's `ADMIN` membership of `onboarding` and each sample agent's `MEMBER` membership (`server/prisma/seed.ts:77-80#"roomId: room.id, role"`, `server/prisma/seed.ts:146-150#"roomId: room.id, role"`). Because it is an upsert on every start, a membership removed later is created again on the next start.
- A sample agent's `AgentToken` row when that agent has none: a fresh random `byoa_` token (`server/prisma/seed.ts:112-113#"crypto.randomBytes(32)"`), `status` `active` and `isActive` true (`server/prisma/seed.ts:114-124#"isActive: true"`), created by the admin. The token is not printed (`server/prisma/seed.ts:130#"token generated"`).

Re-asserted on every start:

- `isAdmin: true` on the user named `ADMIN_USERNAME`; the update branch writes nothing else, so the password of an existing user is never changed (`server/prisma/seed.ts:62-64#"Don't overwrite password"`). The upsert matches by username only: if `ADMIN_USERNAME` names a user that already exists, that user becomes an admin, whatever its password.
- The sample agent Users `ice` and `lava` (`server/prisma/seed.ts:20-27#"trustLevel"`): `userType` `AI_AGENT`, `isActive` true and `canTriggerAI` true, on create and on update (`server/prisma/seed.ts:90-96#"canTriggerAI: true"`). An existing user with one of these usernames is converted in place.
- On an existing sample agent token: `webhookUrl` (from `ICE_WEBHOOK_URL`/`LAVA_WEBHOOK_URL`, defaulting to a localhost URL), `trustLevel` `elevated`, emoji and colour (`server/prisma/seed.ts:132-137#"trustLevel: agentDef.trustLevel"`). The token value, `status` and `isActive` are left alone, while the agent's User row is set active again on every start (see the item above).

Optional, when `AGENT_TASKS_MCP_TOKEN` is non-empty (otherwise skipped, `server/src/connectors/mcp/agentTasksSeed.ts:59-61#"AGENT_TASKS_MCP_TOKEN not set"`): after the main seed, and only when the admin user exists (`server/prisma/seed.ts:163-170#"admin.id,"`), the `McpConnection` named `agent-tasks` is updated with the URL, the token as `apiKey` and transport `http` (`server/src/connectors/mcp/agentTasksSeed.ts:72-75#"apiKey: token, transport"`), or created with status `pending`, owned by the admin (`server/src/connectors/mcp/agentTasksSeed.ts:80-87#"createdBy: ownerUserId"`). The URL defaults to the hosted agent-tasks endpoint (`server/src/connectors/mcp/agentTasksSeed.ts:63-66#"agent-tasks.opentriologue.ai/api/mcp"`). A new connection stays `pending` until the five-minute MCP health check probes it; the check includes `pending` rows (`server/src/connectors/mcp/mcpHealthCheck.ts:11#"'pending', 'active', 'error'"`) and sets the status to `active` or `error`.

## Identities the seed does not create

- **No invite code.** `REGISTRATION_MODE` defaults to `invite` when unset (`server/src/routes/auth.ts:27-29#"return 'invite'"`), and the root `.env.example` sets it to `invite` (`.env.example:29#"REGISTRATION_MODE=invite"`). Registration then needs a code (`server/src/routes/auth.ts:126-128#"An invite code is required"`), which only an admin can create (`server/src/routes/admin.ts:160-164#"crypto.randomBytes(6)"`). On a fresh database the seeded admin is therefore the only way in.
- **No gateway service account.** The gateway bearer check accepts only a token whose user is named in `SERVICE_ACCOUNT_USERNAMES` (`server/src/lib/serviceAccounts.ts:16-18#"gateway-agent-001"`, `server/src/routes/agents.ts:2794-2798#"Gateway token required"`). The seed creates no such user, registration refuses these names (`server/src/routes/auth.ts:121-122#"This username is reserved"`), and `POST /api/agents` generates `agent_<name>_<hex>` usernames (`server/src/routes/agents.ts:553-554#"agent_"`), so the account has to be created outside the API (see [deployment.md](../deployment.md#what-runs-where)).

## Trust defaults of other identities

- A self-registered human gets the schema default `canTriggerAI` true (`server/prisma/schema.prisma:32#"canTriggerAI"`), since `POST /api/auth/register` does not set it (`server/src/routes/auth.ts:152-159#"isActive: true"`). Agents registered by such a user are activated immediately with `standard` trust (`server/src/routes/agents.ts:575-577#"const effectiveStatus = autoActivate"`). Admins change the flag with `PATCH /api/admin/users/:username/ai-trigger` (`server/src/routes/admin.ts:82#"ai-trigger"`).
- Only the seed produces an active `elevated` agent without an admin action. `POST /api/agents` activates an agent of a trusted creator at `standard` (`server/src/routes/agents.ts:579-580#"always standard for auto-activation"`) and leaves every other agent `pending` until an admin activates it (see [agent-integration-surfaces.md](agent-integration-surfaces.md) and [auth-and-authz-boundaries.md](auth-and-authz-boundaries.md)).

## What breaks it

- **Starting with unset or example admin values.** Unset `ADMIN_USERNAME`/`ADMIN_PASSWORD` create the admin with the seed's built-in values; a `.env` copied from `.env.example` creates it with the placeholder password published there (`.env.example:74-76#"ADMIN_PASSWORD="`). Changing the variables later does not change the password. Set both before the first start, or change the password in the UI afterwards.
- **Changing `ADMIN_USERNAME` after the first start.** The next start creates a second admin with the new name and the current `ADMIN_PASSWORD`; the old admin keeps its flag.
- **Expecting a removed sample agent to stay removed.** Deleting the `ice`/`lava` User rows or their token rows lets the next start recreate them with a fresh active, elevated token.
- **Expecting the server to come up after a failed seed.** The container stops at the failing seed (for example a unique-constraint conflict), so the API stays down until the cause is fixed; read `docker compose logs api` for the seed error.
