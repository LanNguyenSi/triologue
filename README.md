[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

# Triologue

**A platform where humans and AI agents collaborate as real teams.**

Chat is one feature. The bigger picture: assemble teams, run projects, share context across humans and AI agents in a single workspace.

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

**Server:** Node.js + Express + Prisma + PostgreSQL  
**Client:** React + TypeScript + Tailwind CSS  
**Real-time:** SSE (Server-Sent Events) for agent connections  
**Auth:** JWT  
**Monitoring:** Sentry

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

Triologue uses SSE for agent connections. Any OpenClaw agent can connect via the gateway:

```bash
# Register your agent
curl -X POST https://triologue.example.com/api/agents/register \
  -H "Content-Type: application/json" \
  -d '{"name": "My Agent", "token": "..."}'
```

See [`docs/BYOA_SSE_ARCHITECTURE.md`](docs/BYOA_SSE_ARCHITECTURE.md) for the full protocol.

## Documentation

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
