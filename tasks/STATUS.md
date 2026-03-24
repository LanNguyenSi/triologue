# Task Status — Wave 1-5

*Letzte Prüfung: 2026-03-24 (Ice)*

## Wave 1 — Fundament

| Task | Titel | Status | Notizen |
|------|-------|--------|---------|
| 1.1 | Task Runtime Context API | ✅ DONE | `/tasks/:taskId/context` existiert (agents.ts:1671), gibt 404 für ungültige IDs |
| 1.2 | Audit Trail | ✅ DONE | 9 Actions geloggt: attachment.read(2x), context.fetch, message.send, task.claim, task.update, memory.read, attachment.upload, screening.run |, `/api/agents/audit` Endpoint READ-Seite prüfen |
| 1.3 | PDF-Analyse stabilisieren | ✅ DONE | Bereits implementiert: 30s Timeout, 12MB Max-Size, strukturierte Fehler (too_large/error/unsupported), Fallback-URL. Getestet mit Angebot Dortmund PDF. |
| 1.4 | Agent Message Hygiene | ✅ DONE | A+B: CONTROL_STRINGS + Dedup agents.ts ✅. C: Global Memory "Agent Chat-Regeln" in DB ✅. D: send-to-triologue.sh ✅ |
| 1.5 | Ice Session-Split | ✅ DONE | SESSION_KEY=agent:triologue seit mehreren Wochen konfiguriert |

## Wave 2 — Workflow

| Task | Titel | Status | Notizen |
|------|-------|--------|---------|
| 2.1 | Reviewer Feld | ✅ DONE | Schema, API, Frontend, Notifications (task.review_requested) alle implementiert |
| 2.2 | Task Assignment Push | ✅ DONE | taskPushService.ts (Backend) + Gateway bridge (socket+inject) |
| 2.3 | Result Router | ✅ DONE | resultRouterService.ts + onTaskStatusChanged in projects.ts |
| 2.4 | Audit Trail UI | ✅ DONE | ProjectActivityPage.tsx (284 lines) mit Filter, Timeline, Pagination |
| 2.5 | Agent Konfiguration UI | ✅ DONE | AgentConfigPage.tsx (447 lines) + agentConfigApi.ts |

## Wave 3 — Connectors Backend

| Task | Titel | Status | Notizen |
|------|-------|--------|---------|
| 3.0 | OAuth Token Management | ✅ DONE | IntegrationToken Schema + admin OAuth routes (oauthNonces) |
| 3.1 | Connector Framework | ✅ DONE | registry.ts + types.ts + definitions/ + proxy.ts |
| 3.2 | SharePoint Connector | ✅ DONE | connectors/definitions/sharepoint.yaml |
| 3.3 | Jira Connector | ✅ DONE | connectors/definitions/jira.yaml |
| 3.4 | MS Teams Channel | ❓ UNGEPRÜFT | Definition file check needed |
| 3.5 | MCP Bridge | ✅ DONE | mcpBridge.ts + mcpHealthCheck.ts + admin routes |

## Wave 4 — Connector UI

| Task | Titel | Status | Notizen |
|------|-------|--------|---------|
| 4.0 | OAuth Flow UI | 🟡 PARTIAL | ConnectorAdminPage.tsx exists, needs OAuth flow verification |
| 4.1 | Connector Permission UI | ✅ DONE | connectorApi.ts has ConnectorPermission + fetchConnectorPermissions |
| 4.2 | MCP Connection UI | ✅ DONE | connectorApi.ts: McpConnection + fetchMcpConnections + createMcpConnection |
| 4.3 | Connector Test UI | ✅ DONE | ConnectorTestPage.tsx exists |

## Wave 5 — Per-User

| Task | Titel | Status | Notizen |
|------|-------|--------|---------|
| 5.0 | Per-User OAuth | ❓ UNGEPRÜFT | Needs deeper analysis — no clear per-user oauth code found |

## Legende

- ✅ DONE — vollständig implementiert
- 🟡 PARTIAL — Backend/Teile vorhanden, noch nicht komplett
- ❌ OFFEN — noch nicht implementiert
- ❓ UNGEPRÜFT — nicht analysiert
