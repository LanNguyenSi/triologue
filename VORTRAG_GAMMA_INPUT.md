# Slide Deck: AI Terminal Tools mit OpenCode

Generate a 10-slide presentation in German. Clean, professional design. Dark theme preferred. No em-dashes.

---

## Slide 1: Titel
**AI Terminal Tools mit OpenCode**
Von Architekturkontext zu ausfuehrbaren Tasks in sicherer Ausfuehrungsumgebung

---

## Slide 2: Einordnung - Drei Stufen der AI-Werkzeuge
Drei Spalten nebeneinander:

**Browser-Chat** -- Hilft beim Denken. Erklaerungen, Exploration, Ideenfindung. Kein Dateizugriff.

**IDE-Plugins** -- Hilft beim Schreiben. Inline-Vorschlaege, Autocomplete, Einzeldateien. Copilot, Cursor, Cody.

**AI Terminal Tools** -- Hilft beim Ausfuehren. Repository-Ebene, Planung, Tasks, Artefakte. OpenCode, Claude Code, Codex.

Kernaussage: Je naeher an Ausfuehrung, desto wichtiger werden Regeln und Sicherheit.

---

## Slide 3: Was ist OpenCode?
AI-first Terminal-Workflow auf Repository-Ebene.

Ablauf in vier Schritten:
Plan -> Tasks -> Execute -> Review

Statt Snippets entstehen: Dateien, Plaene, Task-Backlogs, strukturierte Artefakte.

Open Source. Laeuft lokal. Kein Cloud-Lock-in.

---

## Slide 4: Die Dokumentenlogik - Drei Artefakte
Drei Kaesten untereinander:

**arc42** -- Architektur fuer Menschen. Kontext, Strategie, Bausteine, Entscheidungen.

**project.md** -- Projektscope fuer Menschen + AI. Architekturregeln, Tech-Stack, DoD, Task-Referenzen.

**agents.md** -- Governance fuer AI. Erlaubnisse, Verbote, Reviewpflichten, Sicherheitsgrenzen.

Kernaussage: arc42 beschreibt das System. project.md operationalisiert. agents.md begrenzt.

---

## Slide 5: Warum diese Trennung?
Ohne Trennung: Architektur, Projektwissen und Ausfuehrungsregeln vermischt. Unscharfe Ergebnisse.

Mit Trennung:
- Architektur bleibt stabil (arc42)
- Projektscope ist operativ nutzbar (project.md)
- Agentenverhalten ist kontrollierbar (agents.md)

Ergebnis: Besser steuerbarer Workflow fuer Menschen UND AI.

---

## Slide 6: Von Architektur zu Tasks
project.md uebersetzt Architektur in ausfuehrbare Arbeit.

Gute Tasks enthalten:
- Ziel
- Betroffene Dateien/Bereiche
- Umsetzungsschritte
- Referenzen auf Zusatzkontext
- Tests
- Done-Kriterien

Aus Architekturkontext wird konkrete Umsetzung.

---

## Slide 7: Empfohlene Projektstruktur
Vier Bereiche:

**tasks/** -- Versionierte Arbeitspakete. Ziel, Scope, Schritte, Tests, DoD.

**context/** -- Input fuer Analyse. Logs, Screenshots, Payloads, Repro-Schritte.

**tmp/** -- Fluechtiger Arbeitsbereich. Zwischenstaende, Skizzen. Klar getrennt von Projektwissen.

**outputs/** -- Ergebnisse. Analysen, Reports, Plaene, Review-Notizen.

---

## Slide 8: Docker und Sandbox
Zwei Spalten:

**Ohne Sandbox:** Schnell startklar. Aber: Risiko fuer Host-Dateien, schlechte Trennung, schwer standardisierbar.

**Mit Docker/Sandbox:** Isolierter Workspace, kontrollierte Rechte, reproduzierbar, Schutz fuer Secrets. Aber: Setup-Aufwand.

Empfehlung: Docker als Teamstandard. Git-Repository als /workspace mounten.

---

## Slide 9: Use Cases
Vier Zeilen:

Analyse/Planung -- Sandbox: hoch. Viel Kontext, wenig operative Macht noetig.

Implementierung -- Sandbox: hoch. Echter Code wird veraendert.

Tests/Build -- Sandbox: mittel-hoch. Kommandos haben Seiteneffekte.

Deployment -- Sonderfall. Nur stark kontrolliert oder verboten.

---

## Slide 10: Der Workflow - 10 Schritte
Nummerierte Liste:

1. Architekturgrundlage (arc42)
2. project.md ableiten
3. agents.md festlegen
4. Projektstruktur vorbereiten
5. Repo in Docker-Container mounten
6. OpenCode starten
7. Plan und Tasks ableiten
8. Inkrementell umsetzen
9. Tests, Diff, Review
10. PR/Merge durch Menschen
