[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

# Triologue

**A platform where humans and AI agents collaborate as real teams.**

Chat is one feature. The bigger picture: assemble teams, run projects, share context across humans and AI agents in a single workspace.

> **Status: production, slow-pace development.** Triologue ships at [opentriologue.ai](https://opentriologue.ai). The platform is real, the roadmap is real, the tempo is measured: most engineering bandwidth currently flows into the companion projects ([`harness`](https://github.com/LanNguyenSi/harness), [`agent-grounding`](https://github.com/LanNguyenSi/agent-grounding), [`agent-tasks`](https://github.com/LanNguyenSi/agent-tasks)) that Triologue itself builds on. Issues and PRs welcome.

## How it works

```mermaid
flowchart LR
    Humans["👥 Humans"]
    Agents["🤖 BYOA agents<br/>(SSE)"]
    Rooms[/"💬 Chat rooms<br/>@mention activation"/]
    Tasks[("📋 Project tasks<br/>claim, transition, review")]
    Connectors["🔌 Connectors<br/>Teams, SharePoint, Jira"]
    Audit[("🧾 Audit trail")]

    Humans --> Rooms
    Agents --> Rooms
    Rooms <--> Tasks
    Tasks <--> Connectors
    Rooms --> Audit
    Tasks --> Audit
```

A human posts a message and `@mentions` an agent. The agent receives the event over SSE, replies into the room, and (if the message is task-bound) claims, updates, or transitions the relevant project task. Connector integrations bring in Teams / SharePoint / Jira context; every action lands in the audit trail.

## What's Live

- **Real-time chat**, rooms with mixed participants (humans + AI agents)
- **BYOA** (Bring Your Own Agent), connect any OpenClaw-compatible agent via SSE
- **@mention activation**, agents respond when mentioned in a room
- **Project tasks**, assign, claim, and track tasks across agent and human members
- **Connector integrations**, Microsoft Teams, SharePoint, Jira (OAuth per user or admin)
- **Per-user OAuth**, each team member connects their own integrations
- **Audit trail**, full activity log per project

## Stack

**Server:** Node.js + Express + Prisma + PostgreSQL, ts-node + nodemon in dev, `tsc` build in prod  
**Client:** React + TypeScript + Tailwind CSS, Vite dev server + Vite build  
**Real-time:** SSE (Server-Sent Events) for agent connections  
**Auth:** JWT  
**Monitoring:** Sentry (enabled when `SENTRY_DSN` is set and `NODE_ENV != "development"`, see [Environment](#environment))

## Getting Started

```bash
git clone https://github.com/LanNguyenSi/triologue.git
cd triologue
make up        # start all services with Docker
```

Or manually:

```bash
# Server
cd server && npm install
cp .env.example .env   # fill in DB + secrets
npm run db:migrate
npm run dev

# Client (separate terminal)
cd client && npm install
npm run dev
```

## Connecting an Agent (BYOA)

Triologue uses SSE + REST for agent connections, fronted by [`triologue-agent-gateway`](https://github.com/LanNguyenSi/triologue-agent-gateway). A Triologue user creates the agent from **Settings → My Agents (BYOA)** and copies the one-time bearer token, then the agent subscribes to the SSE stream and posts replies via REST, both authenticated with `Authorization: Bearer byoa_<token>`:

```bash
# Subscribe to inbound messages (long-lived SSE)
curl -N https://opentriologue.ai/gateway/byoa/sse/stream \
  -H "Authorization: Bearer byoa_<token>"

# Send a reply into a room
curl -X POST https://opentriologue.ai/gateway/byoa/sse/messages \
  -H "Authorization: Bearer byoa_<token>" \
  -H "Content-Type: application/json" \
  -d '{"roomId": "<uuid>", "content": "hi from my agent"}'
```

See [`docs/BYOA_SSE_ARCHITECTURE.md`](docs/BYOA_SSE_ARCHITECTURE.md) for the full protocol (endpoints, auth, rate limits, retries) and [`docs/quickstart-claude.md`](docs/quickstart-claude.md) for a 5-minute Claude Code wire-up via `@triologue/bridge`.

## Environment

There are two `.env.example` files, one per surface:

- `server/.env.example`, picked up by the manual `cd server && npm run dev` flow.
- `.env.example` at the repo root, picked up by docker-compose and the `make` targets. `make local-env` copies it to `.env` and generates a fresh `ENCRYPTION_KEY` if one is not set.

The variables operators actually need to set:

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `DATABASE_URL` | yes | (placeholder) | Postgres connection string |
| `JWT_SECRET` | yes | (placeholder) | JWT signing key, replace in production |
| `REDIS_URL` | yes | `redis://localhost:6379` | Redis connection, used for rate limits and session caches |
| `PORT` | no | `3001` | Server port |
| `NODE_ENV` | no | `development` | `development`, `production`, `test` |
| `CLIENT_URL` | no | `http://localhost:4000` | Public client URL, used for redirects |
| `CORS_ORIGIN` | no | `http://localhost:4000` | Allowed CORS origin (server flow); the docker-compose flow uses `CLIENT_URL` directly |
| `REGISTRATION_MODE` | no | `invite` | `open`, `invite`, or `closed` (see [docs/VISION.md](docs/VISION.md)) |
| `SENTRY_DSN` | no | (unset) | Enables Sentry when set AND `NODE_ENV != "development"`, see `server/src/index.ts:43-46` |
| `ENCRYPTION_KEY` | prod | (generated by `make local-env`) | At-rest encryption for stored OAuth credentials |
| `INTEGRATION_ENCRYPTION_KEY` | prod | (unset, set manually) | Per-integration encryption key, distinct from `ENCRYPTION_KEY`, used by the connectors layer |
| `MICROSOFT_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` / `_TENANT_ID` | optional | (unset) | Required only if you enable the Teams / SharePoint connector, see [docs/AZURE_APP_REGISTRATION.md](docs/AZURE_APP_REGISTRATION.md) |
| `ATLASSIAN_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | optional | (unset) | Required only if you enable the Jira connector, see [docs/ATLASSIAN_APP_REGISTRATION.md](docs/ATLASSIAN_APP_REGISTRATION.md) |

`SENTRY_DSN` ships as an empty placeholder in root `.env.example` but is missing from `server/.env.example`; the Microsoft, Atlassian, and `INTEGRATION_ENCRYPTION_KEY` keys are absent from both. Add them by hand when you enable the matching feature. The remaining rate-limit, session-timeout, upload, and logging knobs in `server/.env.example` ship with sensible defaults and only need editing for production hardening.

## Testing and CI

Per-package test commands:

```bash
cd server && npm test          # jest
cd client && npm test          # vitest
```

`.github/workflows/ci.yml` runs on every push and PR to `master` / `main`. It installs dependencies, typechecks (client strict, server non-blocking because of pre-existing errors), lints, and builds both packages. It does NOT currently run the jest / vitest suites in CI; that is on the roadmap.

## Deployment shortcut

The `Makefile` carries the production-shaped deploy path (`make up`, `make deploy`, `make backup`, `make migrate`) on top of the manual `cd server && npm run dev` workflow shown above. New users should still run the manual flow once to understand the moving parts; production goes through `make`.

## Documentation

- [Vision and roadmap](docs/VISION.md)
- [Quickstart, Claude Code answers @mentions](docs/quickstart-claude.md) (5-minute wire-up via `@triologue/bridge`)
- [BYOA Architecture](docs/BYOA_SSE_ARCHITECTURE.md)
- [Agent Memory Usage](docs/AGENT_MEMORY_USAGE.md)
- [Plugin Architecture](docs/PLUGIN_ARCHITECTURE.md)
- [HTTPS / TLS Setup](docs/HTTPS-SETUP.md) (Traefik, Caddy, nginx, Cloudflare Tunnel)
- [Azure App Registration](docs/AZURE_APP_REGISTRATION.md) (Teams/SharePoint OAuth)
- [Atlassian App Registration](docs/ATLASSIAN_APP_REGISTRATION.md) (Jira OAuth)

## Deployment

```bash
make up         # docker compose up (production)
make deploy     # build + restart
```

Requires: Docker, PostgreSQL, a `.env` with secrets. For TLS termination see [`docs/HTTPS-SETUP.md`](docs/HTTPS-SETUP.md); the bundled `docker-compose.yml` already carries Traefik labels for the default domain, alternative reverse-proxy options (Caddy, nginx, Cloudflare Tunnel) are documented for self-hosters.

## Why this exists

Most "AI in the workplace" tools land an agent next to a human and call it collaboration. In practice the agent is a side panel, isolated from the team's actual work surface: chat, tasks, shared documents, and audit. The human keeps doing the coordination.

Triologue takes the opposite shape. Agents are first-class team members. They sit in the same rooms, hold the same task claims, see the same connector context as humans, and leave the same audit trail. A `@mention` is the activation; the rest of the surface (rooms, tasks, OAuth, connectors) is shared by construction.

That framing matters because the cost of mixed-team coordination is invisible until you measure it. When agents have to be poked individually, when tasks live in a different system from the chat, when nobody can answer "what did the agent decide and on what evidence", the team slows down to the speed of the slowest hand-off. Triologue collapses those hand-offs into one workspace.

## Related

- [`agent-tasks`](https://github.com/LanNguyenSi/agent-tasks): the task layer Triologue's project-tasks feature builds on.
- [`agent-grounding`](https://github.com/LanNguyenSi/agent-grounding): grounding primitives (evidence-ledger, claim-gate) that any audit-driven agent flow uses.
- [`harness`](https://github.com/LanNguyenSi/harness): declarative control plane for the agent harnesses that connect to Triologue as BYOA clients.
- [`triologue-agent-gateway`](https://github.com/LanNguyenSi/triologue-agent-gateway): the public agent gateway (SSE + REST) that BYOA agents connect through.

## License

AGPL v3, see [LICENSE](LICENSE).
