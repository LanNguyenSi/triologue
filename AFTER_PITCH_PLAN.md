# After Pitch Plan — OpenTriologue v2 Roadmap

*Stand: 2026-03-13 | Nach GL-Feedback*

## Feedback-Zusammenfassung

- **GL-Urteil:** Idee gut, fuer Pilotierung noch nicht reif genug
- **Christian H.:** Will konfigurierbare Agents in MS Teams, SharePoint-Ablage, Jira-Integration
- **Kernproblem im Demo:** Agent-Zuverlaessigkeit unter Druck (PDF-Fehler, Doppel-Nachrichten)

## Identifizierte Needs

### Von der GL / Stakeholdern:
1. **Zuverlaessigkeit** — Agents muessen konsistent funktionieren, nicht nur im Test
2. **Enterprise-Integration** — MS Teams, SharePoint, Jira (Christians Zielbild)
3. **Nachvollziehbarkeit** — Wer hat was wann entschieden? (Audit Trail)
4. **Kontrolle** — Agents konfigurierbar, steuerbar, begrenzbar

### Technisch (aus der Demo gelernt):
5. **Task Runtime Context** — Agent bekommt vollstaendigen Arbeitskontext
6. **Robuste Tool-Schicht** — Ein Weg fuer PDF-Analyse, nicht drei
7. **Agent-Disziplin** — Keine Doppel-Nachrichten, keine Meta-Reflexionen im Chat
8. **Reviewer-Workflow** — Tasks brauchen Reviewer-Feld + Notifications

---

## Roadmap

### Phase 1: Fundament (KW 12-13, sofort)
**Ziel: Die Probleme aus dem Pitch fixen**

| # | Feature | Aufwand | Prio |
|---|---------|---------|------|
| 1.1 | **Task Runtime Context API** | 2 Tage | KRITISCH |
| | `GET /api/agents/tasks/{id}/context` — ein Endpoint, alles drin | | |
| 1.2 | **Audit Trail** | 3 Tage | KRITISCH |
| | Jede Agent-Aktion loggen: wer, was, wann, welche Task, welches Ergebnis | | |
| 1.3 | **PDF-Analyse stabilisieren** | 1 Tag | KRITISCH |
| | Ein zuverlaessiger Weg: Content-Endpoint serverseitig, Fallback dokumentiert | | |
| 1.4 | **Agent Message Hygiene** | 1 Tag | HOCH |
| | Meta-Nachrichten unterdruecken, Doppel-Posts verhindern | | |
| 1.5 | **Ice Session-Split** | 1 Tag | HOCH |
| | Triologue auf eigene Session, Telegram nicht mehr blockiert | | |

**Ergebnis Phase 1:** Naechste Demo laeuft fehlerfrei durch.

---

### Phase 2: Workflow-Reife (KW 14-15)
**Ziel: Produktionsreife Workflows**

| # | Feature | Aufwand | Prio |
|---|---------|---------|------|
| 2.1 | **Reviewer-Feld auf Tasks** | 2 Tage | HOCH |
| | assignedTo + reviewedBy, Notifications bei Status-Wechsel | | |
| 2.2 | **Task Assignment Push** | 2 Tage | HOCH |
| | Agent bekommt automatisch Context wenn Task zugewiesen wird | | |
| 2.3 | **Result Router** | 2 Tage | MITTEL |
| | Nach Task-Completion: Reviewer benachrichtigen, Summary in Room posten | | |
| 2.4 | **Audit Trail UI** | 3 Tage | MITTEL |
| | Timeline-View: was ist in diesem Projekt passiert, wer hat was getan | | |
| 2.5 | **Agent-Konfiguration UI** | 2 Tage | MITTEL |
| | Pro Agent: erlaubte Actions, Nachrichtenfrequenz, Proaktivitaet | | |

**Ergebnis Phase 2:** Kompletter Workflow ohne manuelle Eingriffe.

---

### Phase 3: Enterprise-Integration (KW 16-19)
**Ziel: Christians Zielbild — MS Teams + SharePoint + Jira**

| # | Feature | Aufwand | Prio |
|---|---------|---------|------|
| 3.1 | **MS Teams Bot Connector** | 5 Tage | HOCH |
| | Agent via @mention in Teams ansprechbar | | |
| 3.2 | **SharePoint Integration** | 3 Tage | HOCH |
| | Dateien lesen/schreiben via Graph API, OAuth Flow | | |
| 3.3 | **Jira Integration** | 3 Tage | MITTEL |
| | Tasks sync: Triologue Tasks <-> Jira Issues | | |
| 3.4 | **OAuth Token Management** | 2 Tage | HOCH |
| | Zentrale Token-Verwaltung, Refresh, pro Integration | | |
| 3.5 | **Action Registry** | 2 Tage | MITTEL |
| | Plugin-System fuer externe Tools (SharePoint, Jira, etc.) | | |

**Ergebnis Phase 3:** Agent in Teams, Ergebnisse in SharePoint, Tickets in Jira.

---

### Phase 4: Skalierung & Pitch #2 (KW 20+)
**Ziel: Zweite Praesentation mit Live-Pilot**

| # | Feature | Aufwand | Prio |
|---|---------|---------|------|
| 4.1 | **Multi-Tenant** | 5 Tage | HOCH |
| | Separate Datenbanken/Bereiche pro Team/Kunde | | |
| 4.2 | **Memory Weaver v3** | laufend | MITTEL |
| | Persistentes Agent-Gedaechtnis, Cross-Session | | |
| 4.3 | **Constraint Engine** | 3 Tage | NICE |
| | Automatische Output-Validierung, Reject + Retry | | |
| 4.4 | **Metriken-Dashboard** | 3 Tage | NICE |
| | Agent-Performance, Task-Durchlaufzeiten, Erfolgsraten | | |

---

## Audit Trail — Detail-Entwurf

### Was wird geloggt:

```
agent_audit_log:
  id: string
  timestamp: datetime
  agentId: string          — wer
  action: string           — was (task.claim, task.update, attachment.upload, message.send, api.call)
  resourceType: string     — worauf (task, attachment, message, memory)
  resourceId: string       — welches Objekt
  projectId: string        — in welchem Projekt
  roomId: string           — in welchem Room
  details: jsonb           — Kontext (alte/neue Werte, Fehlermeldungen)
  success: boolean         — hat es funktioniert
  durationMs: number       — wie lange
```

### Beispiel-Eintraege:

```json
{"action": "task.claim", "agent": "lava", "task": "Go/No-Go Entwurf", "success": true}
{"action": "attachment.read", "agent": "lava", "file": "Ausschreibung_NRW.pdf", "success": false, "error": "API key invalid"}
{"action": "attachment.upload", "agent": "lava", "file": "review.md", "task": "Go/No-Go Entwurf", "success": true}
{"action": "task.update", "agent": "lava", "field": "status", "old": "in_progress", "new": "done", "success": true}
```

### Warum das wichtig ist:

1. **Debugging:** Wenn die Demo bricht, sehen wir sofort wo und warum
2. **Compliance:** GL will wissen wer was entschieden hat
3. **Performance:** Wie lange braucht ein Agent pro Task? Wo sind Bottlenecks?
4. **Vertrauen:** Nachvollziehbarkeit schafft Vertrauen bei Stakeholdern

---

## Timeline-Uebersicht

```
Maerz KW12-13:  Phase 1 — Fundament (Task Context, Audit, Stabilitaet)
April KW14-15:  Phase 2 — Workflow-Reife (Reviewer, Push, Result Router)
April KW16-19:  Phase 3 — Enterprise (Teams, SharePoint, Jira)
Mai   KW20+:    Phase 4 — Skalierung + Pitch #2
```

## Nächste Schritte (Montag)

1. [ ] Task Runtime Context API bauen (Phase 1.1)
2. [ ] Audit Trail Schema + Migration (Phase 1.2)
3. [ ] Lavas PDF-Problem debuggen und fixen (Phase 1.3)
4. [ ] LinkedIn Post mit Architektur-Diagrammen veroeffentlichen
