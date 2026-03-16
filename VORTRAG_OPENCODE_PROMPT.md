# Prompt fuer OpenCode Demo (Vortrag)

Diesen Prompt in OpenCode ausfuehren, nachdem die arc42 als `docs/arc42.md` im Repo liegt.

---

## Prompt

Im Repo liegt `docs/arc42.md` mit der Architekturdokumentation fuer "CivicFlow Mini" (Microservice fuer kommunale Foerderantraege, Symfony 7). Lies sie als Referenz.

Erstelle daraus `project.md`, `agents.md` und drei Beispiel-Tasks.

### 1. `project.md` erstellen

Projekt:
- Symfony 7 (PHP 8.3)
- CivicFlow Mini: Buerger reichen Foerderantraege ein, Sachbearbeitung prueft und entscheidet
- Fokus: saubere Architektur, Testbarkeit, Nachvollziehbarkeit

Funktionalitaet (aus arc42):
- Antrag einreichen (POST /api/antraege)
- Status aendern (PATCH /api/antraege/{id}/status)
- Definierte Statusuebergaenge mit Validierung
- Audit-Trail fuer jede Statusaenderung
- Benachrichtigung bei Nachforderung

Architektur (aus arc42 Abschnitt 4):
- Controller -> Application -> Domain -> Infrastructure
- Keine Business-Logik in Controllern
- Domain ist framework-unabhaengig
- DDD light

Persistenz:
- PostgreSQL, Doctrine ORM

Security (aus arc42 Abschnitt 8):
- JWT-Authentifizierung
- Keine produktiven Secrets in Containern

Tests (aus arc42 Abschnitt 8):
- Unit-Tests fuer Domain (Statusuebergaenge, Audit)
- Integrationstests fuer Repositories
- API-Tests fuer Endpunkte

Docker:
- Docker Compose (API + PostgreSQL + MailHog)
- Nur fuer lokale Entwicklung

Out of scope:
- Kein Frontend
- Kein Deployment
- Keine Aenderungen an externen Diensten

Arbeitsweise:
- project.md ist die zentrale Steuerungsdatei
- Feature-Branches, PR-Pflicht
- Features gelten nur als fertig wenn Tests vorhanden sind

Projektstruktur:
- `tasks/` fuer Arbeitspakete
- `context/` fuer Logs, Payloads, Repro-Schritte
- `tmp/` fuer Zwischenstaende
- `outputs/` fuer Analysen und Reports

Halte project.md unter 100 Zeilen.

### 2. `agents.md` erstellen

Erlaubt:
- Code lesen, analysieren, refactorn
- Tests schreiben und ausfuehren
- Tasks aus `tasks/` abarbeiten
- Docker-Container starten/stoppen

Verboten:
- Produktive Secrets verwenden
- Aenderungen ausserhalb des Workspaces
- Deployment
- Fachlogik in Controller verschieben

Reviewpflichtig:
- Aenderungen an Auth/JWT
- Neue Datenbankmigrationen
- Aenderungen an API-Endpunkten

Testpflichten:
- Jede Domain-Aenderung braucht Unit-Tests
- Jeder neue Adapter braucht Integrationstests
- Jeder API-Endpunkt braucht API-Tests

Halte agents.md unter 60 Zeilen.

### 3. Drei Tasks in `tasks/`

**Task 1: `tasks/001-statusuebergaenge.md`**
- Ziel: Statusuebergaenge im Antrag implementieren und testen
- Domain-Klasse mit erlaubten Uebergaengen (arc42 Abschnitt 5)
- Unit-Tests: alle gueltigen + ungueltigen Uebergaenge
- Done: Exception bei ungueltigem Uebergang, alle Tests gruen

**Task 2: `tasks/002-audit-service.md`**
- Ziel: Audit-Service der bei jeder Statusaenderung einen Eintrag erzeugt
- Domain-Event + Listener oder direkter Service-Call
- Integrationstests: Audit-Eintrag wird bei Statusaenderung persistiert
- Done: Jede Statusaenderung hat einen Audit-Eintrag in der DB

**Task 3: `tasks/003-benachrichtigung-nachforderung.md`**
- Ziel: Bei Status "nachforderung" wird eine Mail ausgeloest
- Infrastructure/Mail-Adapter mit Interface in Domain
- Unit-Test: Benachrichtigungsregel, Integrationstest: MailHog
- Done: Mail wird gesendet, in MailHog sichtbar

Jede Task enthaelt: Ziel, betroffene Bereiche, Schritte, Tests, Done-Kriterien.

### Reihenfolge
1. project.md
2. agents.md
3. Drei Tasks
4. Kurze Zusammenfassung

### Wichtig
- Deutsche Sprache
- Keine em-dashes
- Kompakt
- arc42 ist Referenz, ergaenze was fehlt
