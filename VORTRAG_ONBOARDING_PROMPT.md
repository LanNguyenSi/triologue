# Prompt: Bestehendes Projekt fuer AI-Agenten onboarden

Diesen Prompt in OpenCode ausfuehren, wenn ein bestehendes Projekt mit agentic coding fortgefuehrt werden soll.

---

## Prompt

Du bist in einem bestehenden Projekt-Repository. Deine Aufgabe ist es, das Projekt fuer AI-gestuetzte Entwicklung vorzubereiten.

### Schritt 1: Repo analysieren und `project.md` erstellen

Analysiere das Repository:
- Lies README.md, package.json / composer.json / pom.xml / etc.
- Erkenne Tech-Stack, Frameworks, Sprache
- Verstehe die Projektstruktur (src/, tests/, config/, etc.)
- Lies vorhandene Dokumentation (docs/, ARCHITECTURE.md, ADRs, etc.)
- Pruefe CI/CD Konfiguration (.github/workflows, Dockerfile, docker-compose.yml)
- Schau dir die letzten 20 Commits an (Arbeitsweise, Konventionen)

Erstelle daraus `project.md` mit:
- Projektziel und Scope (1-2 Saetze)
- Tech-Stack (Sprache, Framework, DB, Infrastruktur)
- Architekturregeln (aus Code-Struktur und Doku abgeleitet)
- Qualitaetsanforderungen
- Definition of Done
- Projektstruktur-Beschreibung
- Bekannte Konventionen (Naming, Branching, Test-Patterns)

Markiere Stellen wo du Annahmen triffst mit `[ANNAHME]`. Der Mensch muss diese vor dem Weitermachen pruefen.

Halte project.md unter 120 Zeilen.

**STOPP nach diesem Schritt. project.md muss vom Menschen reviewed werden bevor es weitergeht.**

---

### Schritt 2: `agents.md` erstellen (nach Review von project.md)

Erstelle agents.md als Single Source of Truth fuer den AI-Agenten.

Oben: Referenzen auf vorhandene Dokumentation:
- `project.md` fuer Scope und Regeln
- `README.md` fuer Setup und Commands
- Weitere relevante Docs die du gefunden hast (z.B. docs/architecture.md, CONTRIBUTING.md)
- `tasks/` fuer Arbeitspakete

Dann:
- Erlaubt (was darf der Agent)
- Verboten (was nicht)
- Reviewpflichtig (welche Aenderungen brauchen einen Menschen)
- Testpflichten (wann muessen Tests geschrieben werden)
- Arbeitsweise mit tasks/, context/, tmp/, outputs/

Leite die Regeln aus den Projektkonventionen ab. Wenn das Projekt z.B. strenge Typisierung nutzt, schreibe das als Regel. Wenn es eine PR-Pflicht gibt, uebernimm das.

Halte agents.md unter 60 Zeilen.

---

### Schritt 3: Init-Tasks erstellen

Erstelle drei initiale Tasks in `tasks/`:

**Task 1: `tasks/init-001-docs-audit.md`**
- Ziel: Projektdokumentation pruefen und ergaenzen
- README.md: Stimmen Setup-Anweisungen? Fehlen Schritte?
- API-Dokumentation: Vorhanden? Aktuell?
- Fehlende Inline-Kommentare an komplexen Stellen identifizieren
- Ergebnis in `outputs/docs-audit.md` ablegen

**Task 2: `tasks/init-002-security-audit.md`**
- Ziel: Sicherheitspruefung des Repositories
- Secrets in Code oder Git-History? (.env eingecheckt, API-Keys, Passwoerter)
- Dependency-Schwachstellen (npm audit / composer audit / etc.)
- Auth-Logik pruefen (JWT-Validierung, Session-Handling, CORS)
- Ergebnis in `outputs/security-audit.md` ablegen

**Task 3: `tasks/init-003-test-coverage.md`**
- Ziel: Testabdeckung analysieren und Luecken identifizieren
- Vorhandene Tests ausfuehren, Coverage-Report erstellen
- Identifizieren: Welche Module/Klassen haben keine Tests?
- Priorisieren: Wo fehlen Tests am kritischsten? (Business-Logik > Helper)
- Ergebnis in `outputs/test-coverage-report.md` ablegen

Jede Task enthaelt: Ziel, betroffene Bereiche, Schritte, erwartetes Ergebnis, Done-Kriterien.

---

### Ordnerstruktur anlegen

Erstelle die Ordner falls sie nicht existieren:
```
tasks/
context/
tmp/
outputs/
```

Fuege eine `.gitkeep` in jeden leeren Ordner und eine Zeile `tmp/` in `.gitignore`.

---

### Zusammenfassung

Am Ende: Kurz auflisten was erstellt wurde und welche Stellen in project.md mit `[ANNAHME]` markiert sind und vom Menschen geprueft werden muessen.
