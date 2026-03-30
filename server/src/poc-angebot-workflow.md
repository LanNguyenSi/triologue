# PoC: Angebot überprüfen — Test-Workflow
*Ice 🧊 — 2026-03-30*

---

## Szenario

Ein Agent bekommt die Aufgabe, ein Angebot aus SharePoint zu lesen und eine strukturierte Review
in Jira als Ticket abzulegen — mit Freigabe durch den Menschen, bevor etwas in Jira geschrieben wird.

---

## Voraussetzungen (einmalig konfigurieren)

```bash
# Triologue API
BASE=https://opentriologue.ai
AGENT_TOKEN=<dein Agent-Token aus Triologue>
USER_TOKEN=<dein JWT aus Login>

# Aus deiner Jira-Verbindung in Triologue (Connector Settings)
CLOUD_ID=<atlassian-cloud-id>
PROJECT_KEY=<jira-projektschlüssel, z.B. "PP">

# Aus deiner SharePoint-Verbindung in Triologue (Connector Settings)
DRIVE_ID=<sharepoint-drive-id>
ANGEBOT_PATH=/angebote/angebot-2026-03.pdf   # Pfad zur Datei die du hinzufügst

# IDs aus dem Triologue-Projekt das du konfigurierst
PROJECT_ID=<projekt-id>
TASK_ID=<task-id>
```

---

## Schritt 1: Task empfangen

Der Agent liest seine zugewiesene Aufgabe. Du hast in der Task beschrieben:
- Quelle: SharePoint-Datei (Pfad angegeben)
- Ziel: Jira Review-Ticket erstellen

```bash
curl -X GET "$BASE/api/projects/$PROJECT_ID/tasks/$TASK_ID" \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

**Erwartete Response:**
```json
{
  "task": {
    "id": "...",
    "title": "Angebot überprüfen: angebot-2026-03.pdf",
    "description": "Prüfe das Angebot aus SharePoint und erstelle ein Jira-Review-Ticket.",
    "status": "todo",
    "handoffNote": null
  },
  "context": {
    "availableConnectorActions": [
      { "id": "sharepoint.read", "riskLevel": "low", "requiresApproval": false },
      { "id": "jira.createIssue", "riskLevel": "medium", "requiresApproval": true }
    ]
  }
}
```

---

## Schritt 2: Angebot aus SharePoint lesen

Low-risk → kein Approval, direkt 200.

```bash
curl -X POST "$BASE/api/connectors/sharepoint/actions/sharepoint.read" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "'$TASK_ID'",
    "driveId": "'$DRIVE_ID'",
    "path": "'$ANGEBOT_PATH'"
  }'
```

**Erwartete Response: 200 OK**
```json
{
  "success": true,
  "status": 200,
  "data": "<Dateiinhalt oder Download-URL>"
}
```

Audit-Eintrag: `connector.sharepoint.read` ✅

---

## Schritt 3: Jira Review-Ticket erstellen (→ 202, Approval nötig)

Medium-risk → Agent bekommt 202 + `approvalId`.
Im Projekt-Room erscheint automatisch eine System-Message: **"Approval angefordert"**.

```bash
curl -X POST "$BASE/api/connectors/jira/actions/jira.createIssue" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "'$TASK_ID'",
    "approvalReason": "Angebot analysiert. Erstelle Review-Ticket mit Zusammenfassung und offenen Fragen.",
    "cloudId": "'$CLOUD_ID'",
    "projectKey": "'$PROJECT_KEY'",
    "summary": "Angebot Review: angebot-2026-03.pdf",
    "description": "**Zusammenfassung:**\n- Angebotswert: ...\n- Laufzeit: ...\n- Offene Punkte: ...\n\n**Empfehlung:** Rückfrage zu Punkt 3 notwendig.",
    "issueType": "Task"
  }'
```

**Erwartete Response: 202 Accepted**
```json
{
  "requiresApproval": true,
  "approvalId": "appr_xyz123",
  "message": "Action 'jira.createIssue' requires human approval (risk: medium). Approval request created."
}
```

Audit-Eintrag: `approval.requested` ✅
Room-Message: System-Notification an Projekt-Room ✅

---

## Schritt 4: Du genehmigst (oder lehnst ab)

**Per API:**
```bash
curl -X PATCH "$BASE/api/approvals/appr_xyz123/decide" \
  -H "Authorization: Bearer $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "approved",
    "decisionNote": "Passt, bitte Ticket anlegen."
  }'
```

**Erwartete Response: 200 OK**
```json
{
  "approval": {
    "id": "appr_xyz123",
    "status": "approved",
    "decidedBy": "...",
    "decidedAt": "2026-03-30T..."
  }
}
```

Audit-Eintrag: `approval.approved` ✅

**Alternativ ablehnen:**
```bash
-d '{ "status": "rejected", "decisionNote": "Ticket noch nicht fertig, bitte nochmal überarbeiten." }'
```

---

## Schritt 5: Jira Ticket erstellen (Retry → 200)

Agent ruft identisch nochmal an. Approval ist vorhanden → direkt ausgeführt.

```bash
curl -X POST "$BASE/api/connectors/jira/actions/jira.createIssue" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "'$TASK_ID'",
    "cloudId": "'$CLOUD_ID'",
    "projectKey": "'$PROJECT_KEY'",
    "summary": "Angebot Review: angebot-2026-03.pdf",
    "description": "**Zusammenfassung:**\n- Angebotswert: ...\n- Laufzeit: ...\n- Offene Punkte: ...\n\n**Empfehlung:** Rückfrage zu Punkt 3 notwendig.",
    "issueType": "Task"
  }'
```

**Erwartete Response: 200 OK**
```json
{
  "success": true,
  "status": 201,
  "data": {
    "id": "10099",
    "key": "PP-99",
    "self": "https://yourorg.atlassian.net/browse/PP-99"
  }
}
```

Audit-Einträge: `approval.consumed` + `connector.jira.createIssue` ✅

---

## Schritt 6: Task abschließen mit Handoff-Note

```bash
curl -X PATCH "$BASE/api/projects/$PROJECT_ID/tasks/$TASK_ID" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "done",
    "handoffNote": {
      "completedSteps": [
        "Angebot angebot-2026-03.pdf aus SharePoint gelesen",
        "Jira Review-Ticket PP-99 erstellt (nach menschlicher Freigabe)"
      ],
      "openQuestions": [
        "Rückfrage zu Punkt 3 noch offen — wer beantwortet?"
      ],
      "suggestedNextAction": "PP-99 zuweisen und Rückfrage klären",
      "artifacts": [
        {
          "type": "sharepoint_file",
          "url": "https://...",
          "description": "Angebot-2026-03.pdf (Original)"
        },
        {
          "type": "jira_ticket",
          "url": "https://yourorg.atlassian.net/browse/PP-99",
          "description": "PP-99: Angebot Review"
        }
      ]
    }
  }'
```

---

## Guardrails auf einen Blick

| Schritt | Action | Risk | Approval | Audit |
|---------|--------|------|----------|-------|
| 2 | sharepoint.read | low | ❌ direkt | ✅ |
| 3 | jira.createIssue | medium | ✅ 202 → warten | ✅ |
| 4 | Mensch entscheidet | — | — | ✅ |
| 5 | jira.createIssue (Retry) | medium | ✅ consumed | ✅ |
| 6 | task.done + handoffNote | — | — | ✅ |

---

## Nächste Schritte zum Testen

1. **In Triologue:** Neues Projekt anlegen, SharePoint + Jira als Connectors konfigurieren
2. **SharePoint:** Testdatei hochladen (z.B. `angebote/angebot-2026-03.pdf`)
3. **Task anlegen:** Titel + Beschreibung mit SharePoint-Pfad und Jira-Projekt, Agent zuweisen
4. Schritte 1–6 mit curl oder direkt über den Agenten durchlaufen
5. Approval per API (Schritt 4) oder warte auf Frontend-UI

*Ice 🧊 — 2026-03-30*
