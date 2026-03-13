# Task Runtime Context — Architektur-Entwurf

*Stand: 2026-03-13 | Autor: Ice*

## Problem

Agents bekommen heute eine Chat-Nachricht und muessen sich ihren Arbeitskontext selbst zusammensuchen:
- Welche Task? → Chat parsen
- Welches PDF? → Endpoint raten
- Welche Regeln? → Memory hoffen
- Wohin das Ergebnis? → Trial and Error

**Ergebnis:** Funktioniert im Test, versagt unter Druck.

## Vision

Die Plattform liefert dem Agent einen vollstaendigen **Task Execution Context**, sobald er eine Aufgabe uebernimmt. Der Agent denkt nicht ueber Infrastruktur nach — nur ueber die Aufgabe.

## Architektur

```
┌─────────────────────────────────────────────────────┐
│                    TRIOLOGUE                         │
│                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌───────────┐ │
│  │  Task     │───▶│ Context      │───▶│  Agent    │ │
│  │  Board    │    │ Builder      │    │  Runtime  │ │
│  └──────────┘    └──────────────┘    └───────────┘ │
│       │                │                    │       │
│       │          ┌─────┴─────┐              │       │
│       │          │ Assembles │              │       │
│       │          └─────┬─────┘              │       │
│       │                │                    │       │
│       │    ┌───────────┼───────────┐        │       │
│       │    │           │           │        │       │
│       ▼    ▼           ▼           ▼        ▼       │
│  ┌────────────┐ ┌──────────┐ ┌─────────┐ ┌──────┐ │
│  │ Attachments│ │ Memories │ │ Actions │ │Result│ │
│  │ (parsed)   │ │ (scoped) │ │ (typed) │ │Router│ │
│  └────────────┘ └──────────┘ └─────────┘ └──────┘ │
└─────────────────────────────────────────────────────┘
```

## Task Execution Context (Payload)

Wenn ein Agent eine Task uebernimmt (Status → in_progress), baut der **Context Builder** diesen Payload:

```json
{
  "task": {
    "id": "cmmn4atdg...",
    "title": "Screening-Kriterium: Risiken und Go/No-Go",
    "description": "Bewerte dieses Kriterium mit Quellenbezug...",
    "priority": "medium",
    "status": "in_progress",
    "assignedTo": "lava",
    "createdAt": "2026-03-12T07:45:00Z"
  },

  "project": {
    "id": "cmmmcwmie...",
    "name": "Screening",
    "description": "Ausschreibungsscreening fuer publicplan"
  },

  "attachments": [
    {
      "id": "att-001",
      "filename": "Ausschreibung_NRW_KI.pdf",
      "mimeType": "application/pdf",
      "content": "... (server-parsed text) ...",
      "downloadUrl": "/api/files/144ec83d.pdf"
    }
  ],

  "memories": [
    {
      "id": "mem-firmenprofil",
      "title": "publicplan Firmenprofil",
      "content": "GovTech, 120 MA, 12 Mio Umsatz...",
      "scope": "PROJECT",
      "pinned": true
    },
    {
      "id": "mem-workflow",
      "title": "Agent Task-Workflow (Standard)",
      "content": "1. Task pruefen, 2. in_progress...",
      "scope": "GLOBAL",
      "pinned": true
    }
  ],

  "actions": {
    "updateStatus": {
      "method": "PATCH",
      "url": "/api/projects/{projectId}/tasks/{taskId}",
      "params": { "projectId": "cmmmcwmie...", "taskId": "cmmn4atdg..." },
      "schema": { "status": "enum: todo|in_progress|in_review|done|blocked" }
    },
    "uploadAttachment": {
      "method": "POST",
      "url": "/api/projects/{projectId}/tasks/{taskId}/attachments",
      "params": { "projectId": "cmmmcwmie...", "taskId": "cmmn4atdg..." },
      "accept": ["text/markdown", "application/pdf", "image/*"],
      "maxSize": "12MB"
    },
    "postMessage": {
      "method": "POST",
      "url": "/api/rooms/{roomId}/messages",
      "params": { "roomId": "cmmmcwmie-room-..." }
    },
    "readAttachment": {
      "method": "GET",
      "url": "/api/agents/projects/{projectId}/tasks/{taskId}/attachments/{attachmentId}/content",
      "note": "Server parst PDF/Bilder und gibt Text zurueck"
    }
  },

  "constraints": {
    "maxResponseLength": 4000,
    "workflow": "Ergebnis als Attachment hochladen, dann Status auf in_review setzen",
    "qualityCriteria": "Quellenbezug, Ampelstatus pro Kriterium, Empfehlung"
  }
}
```

## Ablauf

```
1. Mensch erstellt Task und weist Agent zu
          │
2. Agent erhaelt Notification
   (heute: Chat-Nachricht, morgen: strukturiertes Event)
          │
3. Agent setzt Status → in_progress
          │
4. Context Builder assembliert Task Execution Context:
   ├── Task-Details (aus DB)
   ├── Projekt-Attachments (parsed via Content-Endpoint)
   ├── Memories (PROJECT + GLOBAL, gefiltert, sortiert)
   ├── Actions (pre-built URLs mit Auth)
   └── Constraints (aus Workflow-Memories + Plugin-Config)
          │
5. Agent erhaelt vollstaendigen Context
   → Muss NICHTS suchen, NICHTS raten
          │
6. Agent arbeitet:
   ├── Liest Attachments (Content schon im Payload)
   ├── Analysiert gegen Memories (schon im Payload)
   ├── Erstellt Ergebnis
   ├── Ladet hoch via actions.uploadAttachment (URL fertig)
   └── Setzt Status via actions.updateStatus (URL fertig)
          │
7. Result Router:
   ├── Benachrichtigt Reviewer (wenn gesetzt)
   ├── Postet Summary in Room
   └── Updated Task-Board
```

## Trigger-Varianten

### A) Task Assignment Trigger (empfohlen)
```
Agent wird einer Task zugewiesen
  → Plattform sendet Task Execution Context an Agent
  → Agent entscheidet: annehmen oder ablehnen
  → Bei Annahme: automatisch in_progress
```

### B) Chat Command Trigger (aktuell)
```
"@lava bearbeite die Ausschreibung"
  → Agent muss Task selbst finden
  → Agent muss Context selbst zusammensuchen
  → Fehleranfaellig
```

### C) Hybrid (Uebergang)
```
"@lava bearbeite die Ausschreibung"
  → Plattform erkennt Task-Referenz in Chat
  → Plattform baut Context automatisch
  → Agent bekommt beides: Chat + strukturierten Context
```

## Was sich aendert

| Heute | Morgen |
|-------|--------|
| Agent parst Chat-Nachricht | Agent bekommt strukturierte Task |
| Agent sucht Endpoints | Actions sind pre-built mit URLs |
| Agent hofft auf Memory | Memories sind im Payload |
| Agent raet Attachment-Pfad | Content ist schon geparsed |
| Agent weiss nicht wohin mit Ergebnis | Result Router definiert |
| Fehler bei jedem Schritt moeglich | Fehler nur noch in der Analyse |

## Implementation (Phasen)

### Phase 1: Context Builder API (1-2 Tage)
- Neuer Endpoint: `GET /api/agents/tasks/{taskId}/context`
- Gibt Task + Attachments (parsed) + Memories + Actions zurueck
- Agent ruft das auf BEVOR er anfaengt zu arbeiten
- **Sofort nutzbar** — Agent muss nur 1 Endpoint kennen statt 10

### Phase 2: Push statt Pull (3-5 Tage)
- Task Assignment Event via SSE/WebSocket
- Context wird automatisch gepusht wenn Agent zugewiesen wird
- Agent muss nichts mehr aktiv abfragen

### Phase 3: Result Router (3-5 Tage)
- Automatische Benachrichtigung bei Status-Aenderung
- Reviewer-Assignment auf Tasks
- Summary-Post im Room nach Task-Completion

### Phase 4: Constraint Engine (nice-to-have)
- Plugin-spezifische Qualitaetskriterien
- Automatische Validierung von Agent-Output
- Reject + Retry bei unzureichender Qualitaet

## Warum das den Unterschied macht

**Analogie:** Heute ist es wie einem Handwerker zu sagen "renovier das Bad" ohne ihm zu sagen wo das Material liegt, welche Werkzeuge er hat und was die Bauvorschriften sind.

Der Task Execution Context ist das **Briefing** das jeder Handwerker bekommt bevor er anfaengt:
- Hier ist der Grundriss (Task + Projekt)
- Hier ist das Material (Attachments, parsed)
- Hier sind deine Werkzeuge (Actions, mit URLs)
- Hier sind die Vorschriften (Memories, Constraints)
- Hier bringst du das Ergebnis hin (Result Router)

**Der Agent wird nicht schlauer — er bekommt bessere Arbeitsbedingungen.**
