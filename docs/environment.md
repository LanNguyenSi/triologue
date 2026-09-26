# Environment variables

There are two `.env.example` files, one per surface:

- `server/.env.example`, picked up by the manual `cd server && npm run dev` flow.
- `.env.example` at the repo root, picked up by docker-compose and the `make` targets. `make local-env` copies it (or `.env.local`, if present) to `.env` if `.env` does not exist yet, then generates a fresh `ENCRYPTION_KEY` only if the variable is missing from `.env` entirely; the root `.env.example` already ships a placeholder `ENCRYPTION_KEY`, so a fresh `.env` keeps that placeholder until you replace it yourself.

The variables operators actually need to set:

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `DATABASE_URL` | yes | (placeholder) | Postgres connection string |
| `JWT_SECRET` | yes | (placeholder) | JWT signing key, replace in production |
| `POSTGRES_PASSWORD` | yes (compose) | `triologue_secure_password_change_me` in `.env.example` | Postgres password used by the `postgres` service and by `DATABASE_URL` in `docker-compose*.yml` |
| `REDIS_URL` | no | `redis://localhost:6379` | Redis connection, used for rate limits and session caches |
| `PORT` | no | `3001` | Server port |
| `NODE_ENV` | no | `development` | `development`, `production`, `test` |
| `CLIENT_URL` | no | `http://localhost:4000` | Public client URL; drives redirects and the CORS allow-origin (Express + Socket.IO) |
| `REGISTRATION_MODE` | no | `invite` | `open`, `invite`, or `closed` (see [Vision](VISION.md)) |
| `SENTRY_DSN` | no | (unset) | Enables Sentry when set AND `NODE_ENV != "development"` |
| `ENCRYPTION_KEY` | yes | placeholder in `.env.example`; `make local-env` generates a real value only if the variable is unset entirely | At-rest encryption for stored OAuth credentials; startup exits if unset in any environment |
| `INTEGRATION_ENCRYPTION_KEY` | prod | (unset, set manually) | Per-integration encryption key, distinct from `ENCRYPTION_KEY`, used by the connectors layer |
| `MICROSOFT_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` / `_TENANT_ID` | optional | (unset) | Required only if you enable the Teams / SharePoint connector, see [Azure app registration](AZURE_APP_REGISTRATION.md) |
| `ATLASSIAN_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | optional | (unset) | Required only if you enable the Jira connector, see [Atlassian app registration](ATLASSIAN_APP_REGISTRATION.md) |

`SENTRY_DSN`, `INTEGRATION_ENCRYPTION_KEY`, and the Microsoft / Atlassian
connector keys ship as placeholders in both `.env.example` files; fill them
in only when you enable the matching feature (Sentry, or the Teams /
SharePoint / Jira connectors). The remaining rate-limit, session-timeout,
upload, and logging knobs in `server/.env.example` ship with sensible
defaults and only need editing for production hardening.
