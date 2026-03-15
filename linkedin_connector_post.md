# LinkedIn Post Draft — Connectors vs MCP

---

Everyone's talking about MCP for AI tool integration. We're exploring a different angle.

The question we kept asking: Does an AI agent really need access to every tool, all the time?

In enterprise environments, the answer is no. What it needs is the right tools for the current task, with clear boundaries.

So we built what we call **Task Runtime Context**. When an agent picks up a task, it receives a context package: the task, relevant documents, project history, and a set of available actions. Only the actions this agent is permitted to use.

The key difference: the agent never sees credentials. It never calls external APIs directly. It says "I want to do X" and the platform handles auth, permissions, and logging behind the scenes.

We connected our first external service this morning. OAuth through Microsoft Entra ID, agent queries SharePoint files through our platform. One API call from the agent's perspective. Permission checks, token management, and audit logging happen invisibly.

**Why we think this matters for enterprise AI:**

- Agents get capabilities, not credentials
- Every external call is audited (who, what, when)
- Different agents can have different permissions for the same service
- Adding a new integration doesn't require custom code

MCP is great for flexibility. Managed connector platforms are great for convenience. We think there's a third path for environments where data sovereignty and auditability aren't optional.

Early days. A lot still to build. But the foundation feels right.

Self-hosted. Open source.

#AI #EnterpriseAI #AgentArchitecture #OpenSource

---
