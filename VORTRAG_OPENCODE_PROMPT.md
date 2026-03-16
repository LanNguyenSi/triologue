# Prompt fuer OpenCode Demo (Vortrag)

Diesen Prompt in OpenCode ausfuehren, nachdem die arc42 als `docs/arc42.md` im Repo liegt.

---

## Prompt

Du arbeitest in einem Symfony/Next.js-Projekt namens "CivicFlow" (digitale Foerderantraege fuer Kommunen).

Im Repo liegt `docs/arc42.md` mit der vollstaendigen Architekturdokumentation. Lies sie.

Erstelle daraus folgende Artefakte:

### 1. `project.md` (Projektscope fuer Menschen + AI)

Leite aus der arc42 ab:
- **Projektziel und Scope** (1-2 Saetze, aus Abschnitt 1.1)
- **Architekturregeln** (aus Abschnitt 4 und 8, als Bullet-Liste)
- **Tech-Stack** (aus Abschnitt 2, kompakt)
- **Qualitaetsanforderungen** (aus Abschnitt 10, als Checkliste)
- **Definition of Done** fuer Tasks (ableiten aus Testkonzept 8.2 und Entwicklungsworkflow 8.4)
- **Projektstruktur** (beschreibe die empfohlene Ordnerstruktur: `tasks/`, `context/`, `tmp/`, `outputs/`)
- **Task-Referenzen** (Verweis auf `tasks/` Ordner)

Halte project.md unter 150 Zeilen. Operativ, nicht beschreibend.

### 2. `agents.md` (Governance fuer AI-Agenten)

Leite aus der arc42 ab:
- **Erlaubt:** Was darf der Agent tun? (aus Abschnitt 4, 8.4, 9)
- **Verboten:** Was darf er nicht? (aus Abschnitt 8.1, 9.6, 11)
- **Reviewpflichtig:** Welche Aenderungen brauchen menschliches Review? (aus 8.4, 10)
- **Testpflichten:** Wann muss der Agent Tests schreiben? (aus 8.2)
- **Sicherheitsgrenzen:** Umgang mit Secrets, Produktivdaten, Deployment (aus 8.1)
- **Arbeitsweise:** Wie arbeitet der Agent mit `tasks/`, `context/`, `tmp/`, `outputs/`?

Halte agents.md unter 80 Zeilen. Klar, keine Prosa.

### 3. Drei Beispiel-Tasks in `tasks/`

Erstelle drei realistische Tasks basierend auf der arc42:

**Task 1: `tasks/001-antrag-statusuebergaenge-tests.md`**
- Ziel: Unit-Tests fuer die Statusuebergaenge im Antragsmodul (aus 5.2)
- Betroffene Bereiche: Domain/Antrag
- Tests: Gueltige und ungueltige Uebergaenge, Randfaelle

**Task 2: `tasks/002-audit-logging-service.md`**
- Ziel: Audit-Service implementieren der fachliche Entscheidungen loggt (aus 5.2, 6)
- Betroffene Bereiche: Domain/Audit, Infrastructure
- Tests: Integrationstests fuer Audit-Eintraege

**Task 3: `tasks/003-nachforderung-benachrichtigung.md`**
- Ziel: Benachrichtigungslogik bei Nachforderung von Unterlagen (aus 6.2)
- Betroffene Bereiche: Domain/Benachrichtigung, Infrastructure/Mail-Adapter
- Tests: Unit-Test fuer Benachrichtigungsregeln, Integrationstest fuer Mail-Adapter

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
- Leite alles aus der arc42 ab, erfinde keine neuen Anforderungen
