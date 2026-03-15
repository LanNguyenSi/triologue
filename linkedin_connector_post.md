# LinkedIn Post Draft — Connectors vs MCP

---

Everyone's building MCP connectors. We took a different approach.

The current AI tool integration landscape has two camps:

**Camp 1: MCP (Model Context Protocol)**
Give the AI a list of tools. Let it figure out which to call, when, with what parameters. Maximum flexibility, minimum guardrails.

**Camp 2: Managed Connectors (Perplexity, etc.)**
400+ pre-built OAuth integrations. The platform handles auth, the AI just calls actions. Clean, but closed ecosystem.

**We built Camp 3: Task Runtime Context.**

Here's the idea: An AI agent doesn't need access to every tool all the time. It needs the *right* tools for the *current* task.

When an agent picks up a task in our platform, it receives a complete context package:
- The task itself (what to do)
- Relevant documents (already parsed)
- Project memories (what happened before)
- **Available actions** — only the ones this agent is permitted to use, for this specific task

The actions come from two sources:
1. **Internal actions** (update task status, upload results, post to chat)
2. **Connector actions** (query SharePoint, create Jira ticket) — defined as simple YAML, proxied through the platform

The agent never sees an OAuth token. It never calls an external API directly. It just sees: "Here are the things you can do."

**Why this matters:**

MCP gives agents a toolbox and says "go." That's fine for personal assistants. But in enterprise environments, you need:
- **Permission boundaries** — Agent A can read SharePoint, Agent B can't
- **Audit trails** — every external API call logged with who, what, when
- **Token isolation** — the agent never touches credentials
- **Context-aware tooling** — different tasks surface different capabilities

We tested this today: OAuth flow through Microsoft Entra ID → encrypted token storage → YAML-defined SharePoint connector → agent queries files through our proxy. The agent's request: one POST. What happens behind the scenes: auth, token refresh, API proxy, audit logging.

**The connector definition is 15 lines of YAML.** No SDK, no custom code, no MCP server to maintain.

MCP is the escape hatch for legacy systems without APIs. But for the 90% of integrations that are REST + OAuth? Declarative YAML + proxy pattern + permission model is simpler, safer, and more auditable.

Self-hosted. Open source. Built for environments where data sovereignty isn't optional.

#AI #EnterpriseAI #AgentArchitecture #MCP #OAuth #OpenSource

---
