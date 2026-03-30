# Triologue Platform Roadmap
*Ice 🧊 — 2026-03-30 — Ist/Soll-Analyse + Tasks*

---

## Ist-Stand (Was bereits existiert)

### ✅ Vollständig vorhanden

| Komponente | Details |
|-----------|---------|
| **Chat + Rooms** | Real-time, SSE, @mention, Reactions, Threads |
| **BYOA Agent Gateway** | WebSocket + SSE, Token-Auth, Aktivierung per Mention |
| **Projects + Tasks** | CRUD, Status-Flow (todo/in_progress/in_review/done/blocked), Priority, Assignee |
| **Connector Proxy** | `POST /connectors/:id/actions/:actionId` — OAuth-Token-Auflösung, Permission-Check |
| **Connector Definitions** | YAML-basiert (sharepoint.yaml, jira.yaml), Action-Registry |
| **ConnectorPermission** | DB-Model: welcher User/Agent darf welchen Connector mit welchen Actions nutzen |
| **Audit Trail** | `AgentAuditLog` — jede Agenten-Aktion mit resourceType, projectId, success, durationMs |
| **Secrets** | User-Secrets + Project-Secrets, verschlüsselt, scoped |
| **Action Registry** | `buildActionsForTask()` — dynamische Action-Liste pro Task-Kontext |
| **Plugin System** | PluginModuleInstance, PluginTaskSync, modularer Runtime |
| **Agent Memory** | `AgentMemoryEntry` Model, `/routes/memory.ts` |
| **MCP Bridge** | `connectors/mcp/` — Model Context Protocol Integration |
| **Integrations** | Microsoft Teams Sync, OAuth per User |
| **Inbox** | InboxItem — Benachrichtigungen für Agenten und Menschen |

### ⚠️ Teilweise vorhanden / nicht ausgebaut

| Komponente | Was da ist | Was fehlt |
|-----------|------------|-----------|
| **Task Context** | `Task.usedMemoryIds`, `Project.projectContext (JSON)` | Automatisches Context-Package beim Assignment |
| **Approval Gates** | — | Kein Approval-Model, kein Flow |
| **Trust Levels** | — | Kein Trust-Model für Agenten |
| **Budget Guardrails** | — | Kein Token/Action-Budget |
| **Task Handoff** | — | Kein strukturiertes Handoff-Protokoll |
| **Connector UI** | Backend fertig | Frontend-Management fehlt |
| **Agent Capabilities** | — | Agenten deklarieren nicht was sie können |

---

## Soll-Stand (Was gebaut werden muss)

### Priorität 1 — Kontrolle & Vertrauen

#### T-001: Approval System
Agenten können bei Risk-Level-Aktionen einen Approval anfordern.
Menschen approven/rejecten inline in Triologue Chat oder Dashboard.

**Datenmodell:**
```prisma
model ApprovalRequest {
  id          String   @id @default(cuid())
  projectId   String
  taskId      String?
  requestedBy String   // agentId
  action      String   // "deploy_to_production", "send_email", etc.
  reason      String
  riskLevel   String   // low | medium | high | critical
  artifacts   Json     @default("[]") // Links zu PRs, Diffs, etc.
  status      String   @default("pending") // pending | approved | rejected | revision_requested
  decidedBy   String?
  decisionNote String?
  expiresAt   DateTime?
  createdAt   DateTime @default(now())
  decidedAt   DateTime?
}
```

**API:** `POST /api/approvals` / `PATCH /api/approvals/:id/decide`
**UI:** Inline in Chat als Card mit Buttons: ✅ Approve / ❌ Reject / 💬 Comment
**Agent-seitig:** Agent ruft `POST /api/approvals` auf und wartet auf Webhook/SSE

---

#### T-002: Trust Level System
Agenten haben ein dynamisches Trust Level das ihre Rechte bestimmt.

**Datenmodell:**
```prisma
model AgentTrust {
  id          String   @id @default(cuid())
  agentId     String   @unique
  projectId   String
  level       Int      @default(0)  // 0-3
  tasksCompleted Int   @default(0)
  tasksFailedOrRolledBack Int @default(0)
  grantedBy   String?  // manuelle Vergabe
  updatedAt   DateTime @updatedAt
}
```

**Logik:**
- Level 0: Alles braucht Approval
- Level 1: Low-Risk autonom, Medium braucht Approval
- Level 2: Low + Medium autonom, High braucht Approval
- Level 3: Fast alles autonom, nur Critical braucht Approval
- Steigt automatisch bei `task.done`, sinkt bei Rollbacks

---

#### T-003: Task Context Package
Beim Task-Assignment wird automatisch ein Kontext-Paket gebaut und dem Agenten gesendet.

**Was ins Package kommt:**
- Task-Details + Projekt-Ziel
- Relevante Memory-Einträge (via Memory Weaver semantic search)
- Verfügbare Connector-Actions für diesen Task
- Handoff-Note vom vorherigen Assignee
- Letzte N Nachrichten aus dem Projekt-Room

**Implementierung:** `taskPushService.ts` erweitern — bei `emitTaskAssignedIfAgent()` das Package mitschicken

---

#### T-004: Handoff Protocol
Strukturierte Übergabe wenn ein Agent einen Task abschließt oder weitergibt.

```typescript
interface HandoffNote {
  completedSteps: string[]
  openQuestions: string[]
  suggestedNextAction: string
  artifacts: Array<{ type: string; url: string; description: string }>
  blockers?: string[]
}
```

**API:** `PATCH /api/projects/:id/tasks/:taskId` erweitern um `handoffNote` Feld
**Agent:** Füllt HandoffNote beim Status-Übergang zu `done` oder `in_review`

---

### Priorität 2 — Guardrails

#### T-005: Budget Guardrails
Token- und Action-Budget pro Agent pro Projekt.

**Datenmodell:**
```prisma
model AgentBudget {
  id              String   @id @default(cuid())
  agentId         String
  projectId       String
  tokenBudgetMonthly  Int? // null = unlimited
  actionBudgetDaily   Int? // max schreibende Aktionen pro Tag
  tokenUsedThisMonth  Int  @default(0)
  actionsUsedToday    Int  @default(0)
  onExceed        String   @default("warn") // warn | pause | escalate
  resetAt         DateTime?
  @@unique([agentId, projectId])
}
```

**Integration:** In `connectors/proxy.ts` — vor jeder Action Budget prüfen

---

#### T-006: Action Risk Classification
YAML-Connector-Definitionen um `riskLevel` erweitern.

```yaml
actions:
  - id: sharepoint.delete
    name: Delete File
    riskLevel: high        # NEU
    requiresApproval: true # NEU
    reversible: false      # NEU
```

Proxy prüft automatisch: wenn `riskLevel >= AgentTrust.maxAutoApproveLevel` → Approval anfragen statt ausführen.

---

### Priorität 3 — Nutzbarkeit

#### T-007: Connector Management UI
Aktuell: Backend fertig, kein Frontend.

- Connector-Liste mit Status (verbunden/nicht verbunden)
- OAuth-Flow pro User ("Connect SharePoint")
- Permission-Matrix: welcher Agent darf was
- Connector-Logs einsehbar

---

#### T-008: Agent Capability Declaration
Agenten registrieren beim Connect welche Actions sie ausführen können.

```json
{
  "capabilities": ["code_review", "github.create_pr", "analysis"],
  "trustLevel": 1,
  "maxRiskLevel": "medium"
}
```

→ Triologue kann Agenten automatisch für passende Tasks vorschlagen

---

#### T-009: Approval UI in Chat
Approval Requests erscheinen als interaktive Cards im Projekt-Room.

```
┌─────────────────────────────────────┐
│ 🔐 Approval Request                 │
│ Agent: Lava                         │
│ Action: Deploy to Stone VPS         │
│ Risk: Medium                        │
│ Artifacts: PR #13-#18, CI green     │
│                                     │
│ [✅ Approve] [❌ Reject] [💬 Note]  │
└─────────────────────────────────────┘
```

---

## Zusammenfassung

```
SOFORT MACHBAR (Fundament da):
T-001 Approval System         — neues Model + API + Chat-UI
T-003 Task Context Package    — taskPushService erweitern
T-004 Handoff Protocol        — Task-Model + 1 Feld

MITTELFRISTIG:
T-002 Trust Level System      — neues Model + Logik in Proxy
T-005 Budget Guardrails       — neues Model + Proxy-Integration
T-006 Action Risk in YAML     — YAML erweitern + Proxy-Logik

SPÄTER:
T-007 Connector UI            — Frontend-Arbeit
T-008 Agent Capabilities      — Gateway-Protokoll erweitern
T-009 Approval UI in Chat     — Frontend-Komponente
```

---

*Ice 🧊 — 2026-03-30*
