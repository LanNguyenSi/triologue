# Environment variables

There are two `.env.example` files, one per surface:

- `server/.env.example`, picked up by the manual `cd server && npm run dev` flow.
- `.env.example` at the repo root, picked up by docker-compose and the `make` targets. `make local-env` copies it (or `.env.local`, if present) to `.env` if `.env` does not exist yet, then generates a fresh random `JWT_SECRET` and `ENCRYPTION_KEY` whenever the variable is missing, empty or whitespace-only, or still equal to the placeholder from `.env.example`. It recognises `VAR=value` lines, also indented or with `export`; write your own values in that form, because a line such as `VAR = value`, `VAR: value` or one with a trailing `# comment` is not recognised, and `make local-env` would then add a generated line that takes precedence.

The variables operators actually need to set:

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `DATABASE_URL` | yes | (placeholder) | Postgres connection string |
| `JWT_SECRET` | yes | (placeholder); `make local-env` generates a real value when it is missing, empty, whitespace-only or the placeholder | JWT signing key. At least 32 characters (HS256 wants a 256-bit key). Startup exits when it is empty, whitespace-only, shorter or equal to a placeholder from either `.env.example`; the error names the variable and never prints the value. Generate one with `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | yes (compose) | `triologue_secure_password_change_me` in `.env.example` | Postgres password used by the `postgres` service and by `DATABASE_URL` in `docker-compose*.yml`. The server logs one startup warning, without the value, when the password in `DATABASE_URL` or this variable is still the example value; it does not refuse to start, because an existing Postgres volume keeps the password it was first created with. To change it, run `ALTER USER` in Postgres and update `.env` together |
| `REDIS_URL` | no | `redis://localhost:6379` | Redis connection for online presence and a one-hour message cache. The variable has a default, but the API does not start listening until it has connected to Redis. Rate limits are kept in each API process's memory, not in Redis |
| `PORT` | no | `3001` | Server port |
| `NODE_ENV` | no | (unset in code; `development` in `server/.env.example`, `production` in the compose files) | `development`, `production`, `test`. When unset, Sentry follows `SENTRY_DSN` alone and the global rate limit is 2000 |
| `CLIENT_URL` | no | `http://localhost:4000` | CORS allow-origin for Express and Socket.IO. Set it to the public origin in production. Not used for redirects |
| `APP_URL` | when a connector is used | `http://localhost:3000` | Public base URL. The OAuth callback is `${APP_URL}/api/admin/integrations/oauth/callback` unless the provider's `_REDIRECT_URI` is set |
| `REGISTRATION_MODE` | no | `invite` | `open`, `invite`, or `closed` (see [Vision](VISION.md)) |
| `SENTRY_DSN` | no | (unset) | Enables Sentry when set AND `NODE_ENV != "development"` |
| `ENCRYPTION_KEY` | yes | placeholder in `.env.example`; `make local-env` generates a real value when it is missing, empty, whitespace-only or the placeholder | Encrypts user and project secrets (the Secrets pages and the project Secrets panel) at rest with AES-256-CBC. The key is derived from this value plus the owner or project id. Not used for OAuth tokens. At least 32 characters. Startup exits if unset, empty or whitespace-only, shorter, or equal to a placeholder from either `.env.example`. Values stored under an earlier key cannot be decrypted with a new one |
| `INTEGRATION_ENCRYPTION_KEY` | when a connector is used | (unset, set manually) | Encrypts the stored OAuth tokens of the SharePoint and Jira connectors with AES-256-GCM, one key for all providers. Connecting a connector fails while it is unset. Keep it stable: changing it makes stored tokens undecryptable, and every connector must be re-authorized |
| `MICROSOFT_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` / `_TENANT_ID` | optional | (unset; `_TENANT_ID` defaults to `common`) | Required only if you enable the SharePoint connector, see [Azure app registration](AZURE_APP_REGISTRATION.md), which also notes the Teams status |
| `AGENT_TOKEN_ROTATE_GRACE_SECONDS` | no | `300` | Grace window, in seconds, during which a rotated agent token keeps working as a bearer after `POST /api/agents/:id/token/rotate`. A positive integer, clamped to 30..3600; anything else (empty, non-numeric, zero, negative, decimal) falls back to `300`. See [BYOA architecture](BYOA_SSE_ARCHITECTURE.md#token-rotation-triologue-side) |
| `ATLASSIAN_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | optional | (unset) | Required only if you enable the Jira connector, see [Atlassian app registration](ATLASSIAN_APP_REGISTRATION.md) |
| `TEAMS_BOT_SECRET` | to enable the Teams webhook | (unset) | Bearer secret for `POST /api/teams/webhook`, which answers 503 while it is unset |
| `GITHUB_WEBHOOK_SECRET` | to enable the GitHub webhook | (unset) | Signature secret for `POST /api/rooms/webhooks/github`, which answers 503 while it is unset |
| `GLOBAL_RATE_LIMIT_MAX` | no | 600 with `NODE_ENV=production`, else 2000 | Requests per minute per IP on `/api` |
| `LOG_LEVEL` | no | `info` | Server log level |
| `TRIOLOGUE_ENABLED_CONNECTORS` | no | (unset: all) | Comma-separated connector ids to enable |
| `TRIOLOGUE_ENABLED_PLUGINS` / `TRIOLOGUE_DISABLED_PLUGINS` | no | (unset) | Plugin allow and deny lists, see [Plugin architecture](PLUGIN_ARCHITECTURE.md) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | yes (every start) | `ADMIN_USERNAME` falls back to a built-in name when unset; `ADMIN_PASSWORD` has no fallback | Login of the admin user the seed creates, see [Deployment, First start](deployment.md#first-start). The seed exits with an error, before it writes anything, when `ADMIN_PASSWORD` is unset, blank, still the example value from `.env.example` (surrounding whitespace ignored) or shorter than 12 characters; the message never contains the value. The check runs on every start even though the password is applied only when the user is created. Read only by the seed |
| `ADMIN_DISPLAY_NAME` | no | built-in fallback | Display name of that admin user. Read only by the seed |
| `ICE_WEBHOOK_URL` / `LAVA_WEBHOOK_URL` | no | `http://localhost:3334/webhook` / `http://localhost:3335/webhook` | Webhook URLs of the sample agents `ice` and `lava`. Read only by the seed |
| `AGENT_TASKS_MCP_TOKEN` / `AGENT_TASKS_MCP_URL` | no | (unset) / `https://agent-tasks.opentriologue.ai/api/mcp` | With the token set, the seed registers an `agent-tasks` MCP connection to the URL. Read only by the seed |

`SENTRY_DSN`, `INTEGRATION_ENCRYPTION_KEY`, and the Microsoft / Atlassian
connector keys ship as placeholders in both `.env.example` files; fill them
in only when you enable the matching feature (Sentry, or the SharePoint /
Jira connectors).

Rate-limit, bcrypt, session-timeout, upload and `LOG_FORMAT` settings do not
exist: the server reads no such variables (older example files listed them,
and setting them had no effect). These values are fixed in code:

- login: 5 attempts per 15 minutes per IP; registration: 3 per hour per IP
  (`server/src/routes/auth.ts`)
- bcrypt cost: 12
- JWT lifetime: 7 days for humans, 30 days for agent accounts
- uploads: capped at 10 MB and stored in `server/uploads`
  (`server/src/routes/upload.ts`, `server/src/lib/uploadDir.ts`)

Of the logging settings only `LOG_LEVEL` (default `info`) is read.

## Client build variables

The client reads these at build time (Vite), not from `.env` at runtime:

- `VITE_API_URL`: the bare API origin, empty for a same-origin deploy. The
  compose files pass it as a build arg.
- `VITE_SENTRY_DSN`: enables client-side Sentry when set at build time. Both
  compose files (`docker-compose.yml` and `docker-compose.dev.yml`) pass it to
  the frontend image build as a build arg
  (`VITE_SENTRY_DSN: ${VITE_SENTRY_DSN:-}`), so it is baked into the client
  bundle; an empty value (the default) keeps client Sentry off.
