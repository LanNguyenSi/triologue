# PoC: Controlled Agent Workflow
*SharePoint → Jira → Done, mit Approval Gate + Audit Trail*

---

## Szenario

Ein Agent bekommt eine Aufgabe in Triologue: Datei aus SharePoint lesen, Jira-Ticket erstellen,
bearbeiten, Ticket updaten, Aufgabe abschließen.

Der Agent handelt **nicht autonom** — kritische Aktionen (Jira-Ticket erstellen) brauchen
menschliche Freigabe.

---

## Voraussetzungen

```bash
BASE=https://your-triologue-domain
AGENT_TOKEN=byoa_<your-agent-token>
USER_TOKEN=<jwt-from-login>
PROJECT_ID=<project-id>
TASK_ID=<task-id>
CLOUD_ID=<jira-cloud-id>
DRIVE_ID=<sharepoint-drive-id>
```

---

## Schritt 1: Task empfangen

Der Agent liest seine zugewiesene Aufgabe.

```bash
curl -X GET "$BASE/api/projects/$PROJECT_ID/tasks/$TASK_ID" \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

**Response:**
```json
{
  "task": {
    "id": "task_abc",
    "title": "Analyse Q1 Report + Jira Ticket erstellen",
    "status": "todo",
    "assignedTo": "agent_xyz",
    "handoffNote": null
  }
}
```

**Audit:** Kein schreibender Zugriff, kein Eintrag.

---

## Schritt 2: SharePoint-Datei lesen

Low-risk, kein Approval nötig. Direkt ausgeführt.

```bash
curl -X POST "$BASE/api/connectors/sharepoint/actions/sharepoint.read" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "'$TASK_ID'",
    "driveId": "'$DRIVE_ID'",
    "path": "/reports/q1-2026.pdf"
  }'
```

**Response: 200 OK**
```json
{
  "success": true,
  "status": 200,
  "data": "<file content>"
}
```

**Audit Trail:**
```json
{
  "action": "connector.sharepoint.read",
  "resourceType": "connector",
  "resourceId": "sharepoint",
  "details": { "method": "GET", "status": 200 },
  "success": true
}
```

---

## Schritt 3: Jira-Ticket erstellen (erster Versuch → 202)

Medium-risk, `requiresApproval: true` — Agent bekommt 202 zurück.

```bash
curl -X POST "$BASE/api/connectors/jira/actions/jira.createIssue" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "'$TASK_ID'",
    "approvalReason": "Q1 Report analysiert. Ticket für Follow-up Massnahmen erforderlich.",
    "cloudId": "'$CLOUD_ID'",
    "projectKey": "PP",
    "summary": "Q1 2026: Follow-up Massnahmen",
    "description": "Basierend auf Q1 Report Analyse vom 2026-03-30.",
    "issueType": "Task"
  }'
```

**Response: 202 Accepted**
```json
{
  "requiresApproval": true,
  "approvalId": "appr_xyz123",
  "message": "Action 'jira.createIssue' requires human approval (risk: medium). Approval request created."
}
```

**Audit Trail:**
```json
{
  "action": "approval.requested",
  "resourceType": "connector",
  "details": { "approvalId": "appr_xyz123", "actionId": "jira.createIssue", "riskLevel": "medium" }
}
```

---

## Schritt 4: Mensch genehmigt

Im Triologue-Dashboard oder per API.

```bash
curl -X PATCH "$BASE/api/approvals/appr_xyz123/decide" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "approved",
    "decisionNote": "Sieht gut aus, bitte anlegen."
  }'
```

**Response: 200 OK**
```json
{
  "approval": {
    "id": "appr_xyz123",
    "status": "approved",
    "decidedBy": "user_lan",
    "decidedAt": "2026-03-30T15:45:00Z"
  }
}
```

**Audit Trail:**
```json
{
  "action": "approval.approved",
  "resourceType": "approval",
  "details": { "connectorId": "jira", "actionId": "jira.createIssue", "riskLevel": "medium" }
}
```

---

## Schritt 5: Jira-Ticket erstellen (zweiter Versuch → 200)

Approval vorhanden → direkt ausgeführt.

```bash
curl -X POST "$BASE/api/connectors/jira/actions/jira.createIssue" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "'$TASK_ID'",
    "cloudId": "'$CLOUD_ID'",
    "projectKey": "PP",
    "summary": "Q1 2026: Follow-up Massnahmen",
    "description": "Basierend auf Q1 Report Analyse vom 2026-03-30.",
    "issueType": "Task"
  }'
```

**Response: 200 OK**
```json
{
  "success": true,
  "status": 201,
  "data": { "id": "10042", "key": "PP-42", "self": "https://..." }
}
```

**Audit Trail:**
```json
{
  "action": "approval.consumed",
  "details": { "approvalId": "appr_xyz123" }
},
{
  "action": "connector.jira.createIssue",
  "details": { "method": "POST", "status": 201 }
}
```

---

## Schritt 6: Jira-Ticket updaten

Low-risk, kein Approval nötig.

```bash
curl -X POST "$BASE/api/connectors/jira/actions/jira.updateIssue" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "'$TASK_ID'",
    "cloudId": "'$CLOUD_ID'",
    "issueKey": "PP-42",
    "description": "Analyse abgeschlossen. 3 Massnahmen identifiziert: ..."
  }'
```

**Response: 200 OK**

---

## Schritt 7: Task abschliessen mit Handoff-Note

```bash
curl -X PATCH "$BASE/api/projects/$PROJECT_ID/tasks/$TASK_ID" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "done",
    "handoffNote": {
      "completedSteps": [
        "Q1 Report aus SharePoint gelesen",
        "Jira Ticket PP-42 erstellt (nach Approval)",
        "Ticket mit Analyse-Ergebnis aktualisiert"
      ],
      "openQuestions": [
        "Wer übernimmt die 3 identifizierten Massnahmen?"
      ],
      "suggestedNextAction": "PP-42 einem Verantwortlichen zuweisen",
      "artifacts": [
        { "type": "jira_ticket", "url": "https://yourorg.atlassian.net/browse/PP-42", "description": "PP-42: Q1 2026 Follow-up" }
      ]
    }
  }'
```

---

## Guardrails im Überblick

| Schritt | Action | Risk | Approval | Audit |
|---------|--------|------|----------|-------|
| 2 | sharepoint.read | low | ❌ nein | ✅ ja |
| 3 | jira.createIssue | medium | ✅ 202 → warten | ✅ ja |
| 4 | approve (human) | — | — | ✅ ja |
| 5 | jira.createIssue (retry) | medium | ✅ consumed | ✅ ja |
| 6 | jira.updateIssue | low | ❌ nein | ✅ ja |
| 7 | task.done + handoffNote | — | — | ✅ ja |

**Jede Aktion ist im `agent_audit_log` nachvollziehbar.**
**Keine schreibende Aktion über Medium-Risk ohne Mensch.**

---

## Was das PoC zeigt

1. **Connector Proxy** — Agent kennt keine OAuth-Tokens, nur Action-Namen
2. **Risk-basiertes Approval Gate** — automatisch aus YAML, kein Code-Änderung pro Action nötig
3. **Idempotent Retry** — Agent kann bei 202 einfach erneut versuchen nach Approval
4. **Audit Trail** — vollständig, fire-and-forget, blockiert nicht
5. **Structured Handoff** — nächster Agent/Mensch weiß exakt wo es weitergeht

---

*Ice 🧊 — 2026-03-30*
