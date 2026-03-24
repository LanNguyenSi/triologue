# Task Status — Wave 1-5

*Letzte Prüfung: 2026-03-24 (Ice)*

## Wave 1 — Fundament

| Task | Titel | Status | Notizen |
|------|-------|--------|---------|
| 1.1 | Task Runtime Context API | ✅ DONE | `/tasks/:taskId/context` existiert (agents.ts:1671), gibt 404 für ungültige IDs |
| 1.2 | Audit Trail | 🟡 PARTIAL | +3 Actions: task.claim, task.update, memory.read hinzugefuegt. Fehlt noch: attachment.upload, screening.run |, `/api/agents/audit` Endpoint READ-Seite prüfen |
| 1.3 | PDF-Analyse stabilisieren | ✅ DONE | Bereits implementiert: 30s Timeout, 12MB Max-Size, strukturierte Fehler (too_large/error/unsupported), Fallback-URL. Getestet mit Angebot Dortmund PDF. |
| 1.4 | Agent Message Hygiene | ✅ DONE | A+B: CONTROL_STRINGS + Dedup agents.ts ✅. C: Global Memory "Agent Chat-Regeln" in DB ✅. D: send-to-triologue.sh ✅ |
| 1.5 | Ice Session-Split | ✅ DONE | SESSION_KEY=agent:triologue seit mehreren Wochen konfiguriert |

## Wave 2 — Workflow

| Task | Titel | Status | Notizen |
|------|-------|--------|---------|
| 2.1 | Reviewer Feld | 🟡 PARTIAL | Schema + resolveTaskReviewer vorhanden. Fehlt: Inbox-Notification bei in_review, Frontend |
| 2.2 | Task Assignment Push | ❌ OFFEN | SSE Event bei Task-Zuweisung an Agent fehlt |
| 2.3 | Result Router | ❌ OFFEN | Keine Notification-Logik bei Status-Wechsel |
| 2.4 | Audit Trail UI | ❌ OFFEN | Frontend-Seite fehlt (2.1 Audit-Service ist Voraussetzung) |
| 2.5 | Agent Konfiguration UI | 🟡 PARTIAL | Backend (agentConfig, rate limiting) vorhanden. Frontend fehlt |

## Wave 3 — Connectors Backend

| Task | Titel | Status | Notizen |
|------|-------|--------|---------|
| 3.0 | OAuth Token Management | ❓ UNGEPRÜFT | |
| 3.1 | Connector Framework | 🟡 PARTIAL | MCP Bridge + connectors/registry vorhanden (admin.ts) |
| 3.2 | SharePoint Connector | ❓ UNGEPRÜFT | |
| 3.3 | Jira Connector | ❓ UNGEPRÜFT | |
| 3.4 | MS Teams Channel | ❓ UNGEPRÜFT | |
| 3.5 | MCP Bridge | 🟡 PARTIAL | mcpBridge.ts + admin routes vorhanden |

## Wave 4 — Connector UI

| Task | Titel | Status | Notizen |
|------|-------|--------|---------|
| 4.0 | OAuth Flow UI | ❓ UNGEPRÜFT | |
| 4.1 | Connector Permission UI | ❓ UNGEPRÜFT | |
| 4.2 | MCP Connection UI | ❓ UNGEPRÜFT | |
| 4.3 | Connector Test UI | ❓ UNGEPRÜFT | |

## Wave 5 — Per-User

| Task | Titel | Status | Notizen |
|------|-------|--------|---------|
| 5.0 | Per-User OAuth | ❓ UNGEPRÜFT | |

## Legende

- ✅ DONE — vollständig implementiert
- 🟡 PARTIAL — Backend/Teile vorhanden, noch nicht komplett
- ❌ OFFEN — noch nicht implementiert
- ❓ UNGEPRÜFT — nicht analysiert
