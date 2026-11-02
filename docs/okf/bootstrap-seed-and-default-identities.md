---
type: invariant
title: Bootstrap seed and default identities, what every api start creates or resets
description: The api container runs migrations and prisma/seed.ts on every start. The seed creates the admin from ADMIN_USERNAME/ADMIN_PASSWORD only when that user does not exist, refuses to create it with an unset, example or short ADMIN_PASSWORD, never changes a password, re-asserts the admin flag on every start, creates the sample agents ice and lava (user, token, room memberships) only when their user does not exist and never changes them afterwards, optionally upserts the agent-tasks MCP connection, and never creates the gateway service account. A failed seed stops the container before the server starts.
tags: [seed, bootstrap, admin, agents, deployment, security]
timestamp: 2026-11-02T09:01:43Z
sources:
  - server/entrypoint.sh
  - server/Dockerfile
  - server/package.json
  - server/prisma/seed.ts
  - server/src/connectors/mcp/agentTasksSeed.ts
  - server/src/utils/env-validation.ts
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
- The seed command is `npx ts-node prisma/seed.ts` (`server/entrypoint.sh:14#"npx ts-node prisma/seed.ts"`), run under `set -e` (`server/entrypoint.sh:2#"set -e"`). A seed that exits non-zero stops the entrypoint before `exec npm start`, so the container exits and the server does not start; the seed exits 1 on any error (`server/prisma/seed.ts:212-214#"process.exit(1)"`), including the `ADMIN_PASSWORD` refusal described below. Until the entrypoint dropped its `||` fallback, a failed seed only printed "Seed skipped" and the server started anyway. `ts-node` is a devDependency (`server/package.json:58#"ts-node"`), and the image installs devDependencies because the build runs `npm ci --no-audit --no-fund` without `NODE_ENV` or `--omit=dev` (`server/Dockerfile:19-20#"RUN npm ci --no-audit --no-fund"`), so a missing `ts-node` is not the usual cause of a failure.
- The `api` service reads `.env` as its environment (`docker-compose.yml:77#"env_file: .env"`), so the `ADMIN_*`, `ICE_WEBHOOK_URL`/`LAVA_WEBHOOK_URL` and `AGENT_TASKS_MCP_*` values there reach the seed. The manual path (`npm run db:seed`, `server/package.json:16#"db:seed"`) runs the same script once with whatever `server/.env` sets: the seed loads `.env` from its working directory itself (`server/prisma/seed.ts:5#"dotenv/config"`), and a variable already set in the environment wins over the file.

## What the seed writes

Created when missing (an existing row keeps its values; what a start refreshes is listed under Re-asserted on every start, and what it explicitly never touches under What the seed never changes):

- The `onboarding` room (upsert with an empty update, `server/prisma/seed.ts:68-71#"create: room"`).
- The admin user: username `ADMIN_USERNAME`, password `ADMIN_PASSWORD` (bcrypt cost 12), display name `ADMIN_DISPLAY_NAME`, `userType` `HUMAN` (`server/prisma/seed.ts:92#"bcrypt.hash(process.env"`, `server/prisma/seed.ts:89-93#"isAdmin: true"`). `ADMIN_USERNAME` and `ADMIN_DISPLAY_NAME` fall back to a built-in value when unset (`server/prisma/seed.ts:56#"ADMIN_USERNAME"`, `server/prisma/seed.ts:77#"ADMIN_DISPLAY_NAME"`); `ADMIN_PASSWORD` has no fallback. Before anything is written, the seed looks the user up by username and asks `decideAdminPasswordAction` what to do (`server/prisma/seed.ts:57-63#"console.warn"`, `server/src/utils/env-validation.ts:72-89#"keep a strong ADMIN_PASSWORD"`). When the user does not exist and `ADMIN_PASSWORD` is unset, blank after trimming, equal to the `.env.example` placeholder (surrounding whitespace ignored) or shorter than 12 characters, it throws an error that names the rule and never the value, and the container stops (`server/src/utils/env-validation.ts:45-54#"return null"` holds the rule). When the user already exists the start continues: a set but weak value logs one warning (which says to keep a strong value set, because it is needed again if `ADMIN_USERNAME` is changed or the user is deleted), an unset or blank value is silent, and the password is never applied. "Exists" means the user named `ADMIN_USERNAME`, looked up by username only (`server/prisma/seed.ts:57#"findUnique"`): after a rename or a deletion the next start is the create case again. The seed sets no email.
- The admin's `ADMIN` membership of `onboarding` (`server/prisma/seed.ts:101-104#"roomId: room.id, role"`). Because it is an upsert on every start, a membership removed from the admin later is created again on the next start.
- The sample agent Users `ice` and `lava` (`server/prisma/seed.ts:26-33#"trustLevel"`), created with `userType` `AI_AGENT`, `isActive` true and `canTriggerAI` true (`server/prisma/seed.ts:163-170#"canTriggerAI: true"`), and with their `MEMBER` membership of the default rooms (`server/prisma/seed.ts:177-181#"roomId: room.id, role"`). All of this, memberships included, is written only in the run that finds no user with the agent's username; an existing user is never converted, reactivated or re-added to a room (create-only, see the heading below).
- A sample agent's `AgentToken` row when that agent has none (`server/prisma/seed.ts:124#"crypto.randomBytes(32)"`): a fresh random `byoa_` token, `status` `active` and `isActive` true (`server/prisma/seed.ts:125-139#"isActive: true"`), created by the admin, with the webhook URL from `ICE_WEBHOOK_URL`/`LAVA_WEBHOOK_URL` (defaulting to a localhost URL), `trustLevel` `elevated`, emoji and colour. This also covers an existing agent user whose token row was deleted (`server/prisma/seed.ts:156-158#"exists, token created"`); that run creates the token and nothing else, so the agent's room memberships stay as they are. The token is not printed (`server/prisma/seed.ts:174#"token generated"`).

## What the seed never changes

- An existing sample agent User and its token: no write of `displayName`, `userType`, `isActive` or `canTriggerAI` on the user, and none of `webhookUrl`, `trustLevel`, `status`, `isActive`, emoji, colour, description or name on the token. Every one of these is settable through the admin UI (`PATCH /api/agents/:id` writes `webhookUrl`, `isActive` and `description`; the rooms route and the activate endpoint write memberships and `status`), so an admin's deactivation, trust-level change, webhook edit or room removal of `ice`/`lava` survives every restart and redeploy (`server/prisma/seed.ts:146-160#"exists, left unchanged"`). A removed sample agent stays removed as long as its User row exists; deleting the User row makes the next start create that agent (with token and memberships) again.

## Re-asserted on every start

- `isAdmin: true` on the user named `ADMIN_USERNAME`; the update branch writes nothing else, so the password of an existing user is never changed (`server/prisma/seed.ts:82-84#"Don't overwrite password"`). The upsert matches by username only: if `ADMIN_USERNAME` names a user that already exists, that user becomes an admin, whatever its password. Sample agent users and tokens are deliberately not in this list: the seed is create-only for them.

Optional, when `AGENT_TASKS_MCP_TOKEN` is non-empty (otherwise skipped, `server/src/connectors/mcp/agentTasksSeed.ts:59-61#"AGENT_TASKS_MCP_TOKEN not set"`): after the main seed, and only when the admin user exists (`server/prisma/seed.ts:194-201#"admin.id,"`), the `McpConnection` named `agent-tasks` is updated with the URL, the token as `apiKey` and transport `http` (`server/src/connectors/mcp/agentTasksSeed.ts:72-75#"apiKey: token, transport"`), or created with status `pending`, owned by the admin (`server/src/connectors/mcp/agentTasksSeed.ts:80-87#"createdBy: ownerUserId"`). The URL defaults to the hosted agent-tasks endpoint (`server/src/connectors/mcp/agentTasksSeed.ts:63-66#"agent-tasks.opentriologue.ai/api/mcp"`). A new connection stays `pending` until the five-minute MCP health check probes it; the check includes `pending` rows (`server/src/connectors/mcp/mcpHealthCheck.ts:11#"'pending', 'active', 'error'"`) and sets the status to `active` or `error`.

## Identities the seed does not create

- **No invite code.** `REGISTRATION_MODE` defaults to `invite` when unset (`server/src/routes/auth.ts:27-29#"return 'invite'"`), and the root `.env.example` sets it to `invite` (`.env.example:29#"REGISTRATION_MODE=invite"`). Registration then needs a code (`server/src/routes/auth.ts:126-128#"An invite code is required"`), which only an admin can create (`server/src/routes/admin.ts:160-164#"crypto.randomBytes(6)"`). On a fresh database the seeded admin is therefore the only way in.
- **No gateway service account.** The gateway bearer check accepts only a token whose user is named in `SERVICE_ACCOUNT_USERNAMES` (`server/src/lib/serviceAccounts.ts:16-18#"gateway-agent-001"`, `server/src/routes/agents.ts:2794-2798#"Gateway token required"`). The seed creates no such user, registration refuses these names (`server/src/routes/auth.ts:121-122#"This username is reserved"`), and `POST /api/agents` generates `agent_<name>_<hex>` usernames (`server/src/routes/agents.ts:553-554#"agent_"`), so the account has to be created outside the API (see [deployment.md](../deployment.md#what-runs-where)).

## Trust defaults of other identities

- A self-registered human gets the schema default `canTriggerAI` true (`server/prisma/schema.prisma:32#"canTriggerAI"`), since `POST /api/auth/register` does not set it (`server/src/routes/auth.ts:152-159#"isActive: true"`). Agents registered by such a user are activated immediately with `standard` trust (`server/src/routes/agents.ts:575-577#"const effectiveStatus = autoActivate"`). Admins change the flag with `PATCH /api/admin/users/:username/ai-trigger` (`server/src/routes/admin.ts:82#"ai-trigger"`).
- Only the seed produces an active `elevated` agent without an admin action. `POST /api/agents` activates an agent of a trusted creator at `standard` (`server/src/routes/agents.ts:579-580#"always standard for auto-activation"`) and leaves every other agent `pending` until an admin activates it (see [agent-integration-surfaces.md](agent-integration-surfaces.md) and [auth-and-authz-boundaries.md](auth-and-authz-boundaries.md)).

## What breaks it

- **Starting a fresh database with an unset or example `ADMIN_PASSWORD`.** The seed stops with an error and the container exits; a `.env` copied from `.env.example` carries the placeholder password published there (`.env.example:77-79#"ADMIN_PASSWORD="`), which is refused, as is an unset value (it used to create the admin with a built-in password). An unset `ADMIN_USERNAME` still creates the admin under the built-in name. Once the admin exists, the same weak value no longer stops the start: the seed logs one warning without the value, and it changes nothing, so an admin created earlier with the example password keeps it until the password is changed in the UI.
- **Running with the example database password.** Not a seed failure: the server only logs one startup warning, without the value, while the password in `DATABASE_URL` or `POSTGRES_PASSWORD` is one of the example passwords (the one in `.env.example`, or `password` from `server/.env.example`) (`server/src/utils/env-validation.ts:174-181#"Change it in Postgres"`). An existing Postgres volume keeps its first password, so the value must be changed in Postgres and in `.env` together.
- **Changing `ADMIN_USERNAME` after the first start, or deleting the admin user.** The lookup is by username, so the next start is the create case: with a strong `ADMIN_PASSWORD` it creates an admin with the new name (or re-creates the deleted one) and that password, the old admin keeps its flag; with the variable removed, blank, the example value or short, the seed refuses and the container stops. Removing `ADMIN_PASSWORD` after setup is therefore only safe while neither happens. Nothing exempts the admin from self-deletion (`server/src/routes/auth.ts:748#"router.delete('/me'"`).
- **Expecting a removed sample agent to stay removed.** Deleting the `ice`/`lava` User rows lets the next start recreate the agent with a fresh active, elevated token and room memberships; deleting only the token row recreates the token. Deleting an agent in the admin UI is a soft delete (`server/src/routes/agents.ts`: the user row stays with `isDeleted` set and the token is revoked, not removed), so the seed does not recreate such an agent; only removing the rows from the database does. Short of that the seed is create-only: a deactivated, trust-lowered or room-removed sample agent is left exactly as the admin set it.
- **Expecting the server to come up after a failed seed.** The container stops at the failing seed (for example a unique-constraint conflict), so the API stays down until the cause is fixed; read `docker compose logs api` for the seed error.
