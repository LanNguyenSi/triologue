# Prompt fuer OpenCode Demo (Vortrag)

Diesen Prompt in OpenCode ausfuehren, nachdem die arc42 als `docs/arc42.md` im Repo liegt.

---

## Prompt

Im Repo liegt `docs/arc42.md` mit der Architekturdokumentation fuer "CivicFlow" (digitale Foerderantraege fuer Kommunen). Lies sie als Referenz.

Erstelle daraus `project.md`, `agents.md` und drei Beispiel-Tasks. Leite alles aus der arc42 ab. Was dort nicht explizit steht, ergaenze sinnvoll passend zum Projektkontext.

### 1. `project.md` erstellen

Erstelle ein project.md mit folgenden Vorgaben:

Projekt:
- Symfony-Backend, Next.js-Frontend (aus arc42 Abschnitt 2)
- CivicFlow: Digitale Beantragung, Pruefung und Freigabe kommunaler Foerderantraege
- Fokus: saubere Architektur, Testbarkeit, Nachvollziehbarkeit

Funktionalitaet (aus arc42 Abschnitt 1.1, 5, 6):
- Antragsstellung durch Buerger
- Pruefung und Statusverwaltung durch Sachbearbeitung
- Nachforderung von Unterlagen
- Bewilligung / Ablehnung mit Audit-Trail

Architektur (aus arc42 Abschnitt 4):
- klare Trennung: Controller -> Application -> Domain -> Infrastructure
- keine Business-Logik in Controllern
- Domain ist framework-unabhaengig
- DDD light: Module nach Fachlichkeit

Persistenz (aus arc42 Abschnitt 2):
- PostgreSQL
- Doctrine ORM (Symfony-Standard)

Security (aus arc42 Abschnitt 8.1):
- OIDC / JWT Authentifizierung
- Least Privilege
- Keine produktiven Secrets in Entwicklungscontainern
- Agenten duerfen keine produktiven Zugangsdaten verwenden

Tests (aus arc42 Abschnitt 8.2):
- Unit-Tests fuer Domain-Logik
- Integrationstests fuer Adapter/Infrastruktur
- API-Tests fuer Endpunkte
- Kritische Fehlerbilder als Regressionstests

Docker (aus arc42 Abschnitt 7):
- Docker Compose fuer lokale Entwicklung
- Frontend-Container, API-Container, PostgreSQL-Container
- AI-Werkzeuge laufen nicht auf Produktivsystemen

Out of scope:
- kein Deployment auf Produktivsysteme
- keine Aenderungen an OIDC-Provider oder Dokumentenspeicher
- keine Aenderungen ausserhalb des CivicFlow-Repositorys

Arbeitsweise (aus arc42 Abschnitt 8.4):
- project.md ist die zentrale Steuerungsdatei
- Arbeit in Feature-Branches, PR-Pflicht
- Architektur- und Sicherheitsreview bei relevanten Aenderungen
- Features gelten nur als fertig wenn Tests vorhanden sind
- Annahmen muessen dokumentiert werden

Projektstruktur:
- `tasks/` fuer versionierte Arbeitspakete
- `context/` fuer Logs, Screenshots, Payloads, Repro-Schritte
- `tmp/` fuer fluechtigen Arbeitsbereich
- `outputs/` fuer Analysen, Reports, Plaene

Halte project.md unter 150 Zeilen. Operativ, nicht beschreibend.

### 2. `agents.md` erstellen

Erstelle agents.md als Governance-Datei fuer AI-Agenten. Leite die Regeln aus der arc42 ab, ergaenze wo noetig:

Erlaubt:
- Code lesen, analysieren, refactorn
- Tests schreiben und ausfuehren
- Tasks aus `tasks/` abarbeiten
- Dateien in `tmp/` und `outputs/` erstellen
- Docker-Container starten/stoppen

Verboten:
- Produktive Secrets verwenden oder lesen
- Aenderungen ausserhalb des Projekt-Workspaces
- Deployment oder produktionsnahe Eingriffe
- Sicherheitskritische Aenderungen ohne Review
- Fachlogik in Controller oder Adapter verschieben

Reviewpflichtig:
- Aenderungen an Sicherheitslogik (Auth, JWT, Rollen)
- Neue Datenbankmigrationen
- Aenderungen an API-Schnittstellen
- Architekturentscheidungen

Testpflichten:
- Jede Domain-Aenderung braucht Unit-Tests
- Jeder neue Adapter braucht Integrationstests
- Jeder neue API-Endpunkt braucht API-Tests

Sicherheitsgrenzen:
- Nur .env.example committen, nie .env
- Keine echten Benutzerdaten in Tests
- Least Privilege fuer alle Zugriffe

Arbeitsweise mit Ordnern:
- Tasks aus `tasks/` lesen und abarbeiten
- Zusatzkontext aus `context/` nutzen
- Zwischenstaende in `tmp/` ablegen
- Ergebnisse und Analysen in `outputs/`

Halte agents.md unter 80 Zeilen. Klar, keine Prosa.

### 3. Drei Beispiel-Tasks in `tasks/`

Erstelle drei realistische Tasks basierend auf der arc42:

**Task 1: `tasks/001-antrag-statusuebergaenge-tests.md`**
- Ziel: Unit-Tests fuer die Statusuebergaenge im Antragsmodul (aus arc42 5.2: "Ein Antrag kann nur in definierten Statusuebergaengen veraendert werden")
- Betroffene Bereiche: Domain/Antrag
- Tests: Gueltige und ungueltige Uebergaenge, Randfaelle
- Done: Alle definierten Statusuebergaenge haben Tests, ungueltige Uebergaenge werfen Exceptions

**Task 2: `tasks/002-audit-logging-service.md`**
- Ziel: Audit-Service implementieren der fachliche Entscheidungen loggt (aus arc42 5.2: "Fachliche Entscheidungen erzeugen Audit-Eintraege", und 6.1/6.3)
- Betroffene Bereiche: Domain/Audit, Infrastructure
- Tests: Integrationstests fuer Audit-Eintraege bei Antragseinreichung und Bewilligung
- Done: Jede fachliche Entscheidung erzeugt einen Audit-Eintrag, Tests beweisen es

**Task 3: `tasks/003-nachforderung-benachrichtigung.md`**
- Ziel: Benachrichtigungslogik bei Nachforderung von Unterlagen (aus arc42 6.2)
- Betroffene Bereiche: Domain/Benachrichtigung, Infrastructure/Mail-Adapter
- Tests: Unit-Test fuer Benachrichtigungsregeln, Integrationstest fuer Mail-Adapter
- Done: Bei Status "Nachforderung" wird Benachrichtigung ausgeloest, Mail-Adapter ist getestet

Jede Task-Datei enthaelt: Ziel, betroffene Dateien/Bereiche, Umsetzungsschritte, Tests, Done-Kriterien.

### Reihenfolge

1. Zuerst `project.md` erstellen
2. Dann `agents.md` erstellen
3. Dann die drei Tasks in `tasks/`
4. Am Ende: kurze Zusammenfassung was erstellt wurde

### Wichtig

- Keine em-dashes verwenden
- Deutsche Sprache
- Kompakt, nicht ausufernd
- arc42 ist die Referenz, ergaenze was dort nicht steht aber zum Projekt passt
- Erfinde keine Anforderungen die dem arc42-Kontext widersprechen
