# Demo 1: Angebotsprüfung mit Attachment

## Konzept
Ein Task mit einem PDF-Attachment (Angebotsentwurf). Agent liest das Dokument, prüft gegen Qualitätsrichtlinien aus dem Memory und findet Probleme.

**Warum das kein Chatbot kann:**
- Agent kennt den Task-Kontext (Projekt, Deadline, Verantwortlicher)
- Agent liest das Attachment direkt aus dem Task
- Agent gleicht mit Memory ab (pp-Angebotsrichtlinien)
- Alles passiert im Projekt-Room — transparent für alle

---

## Setup in Triologue

### 1. Memory anlegen: Angebotsrichtlinien

```
publicplan Angebotsrichtlinien (Stand: Januar 2026)

Pflichtbestandteile jedes Angebots:
1. Management Summary (max. 1 Seite)
2. Ausgangslage und Problemverständnis
3. Lösungskonzept mit Architekturskizze
4. Projektplan mit Meilensteinen und Phasen
5. Teamaufstellung mit Qualifikationen und Verfügbarkeit
6. Referenzprojekte (mind. 2 vergleichbare)
7. Preisblatt (aufgeschlüsselt nach Phasen)
8. Wartung und Support (SLA-Definition)
9. Risikobewertung und Mitigationsmaßnahmen
10. AGB und Vertragsbedingungen

Qualitätskriterien:
- Kundenname muss auf jeder Seite im Header stehen
- Keine generischen Textbausteine — kundenspezifisch formulieren
- Alle Preise netto + Tagessätze transparent
- Projektteam: Fotos und Kurzprofile der Schlüsselpersonen
- Timeline muss realistisch sein (Puffer einplanen)
- Referenzen müssen verifizierbar sein (Ansprechpartner nennen)
```

### 2. Fiktives Angebot (als PDF-Attachment an Task)

**Datei: `Angebot_Stadt_Dortmund_Buergerportal_ENTWURF.pdf`**

Inhalt des PDFs:

```
ANGEBOT
Digitales Bürgerportal für die Stadt Dortmund
publicplan GmbH — Februar 2026
ENTWURF v0.3

1. Management Summary

Die Stadt Dortmund plant die Einführung eines digitalen Bürgerportals 
zur Verbesserung der Online-Services. publicplan bietet eine bewährte 
Lösung auf Basis von Open-Source-Technologien.

2. Ausgangslage

Die Stadt Dortmund möchte ihre Bürgerservices digitalisieren. Aktuell 
sind nur 12 von 85 Verwaltungsleistungen online verfügbar. Ziel ist 
die Umsetzung von 40 weiteren Leistungen bis Ende 2026.

3. Lösungskonzept

Wir setzen auf unsere bewährte Portalarchitektur:
- Frontend: React + TypeScript
- Backend: Node.js
- CMS: Headless Drupal
- Hosting: Kubernetes auf Hetzner Cloud (DE)

Integration mit bestehenden Fachverfahren über REST APIs.

4. Projektplan

Phase 1: Konzeption (4 Wochen)
Phase 2: Entwicklung (12 Wochen)
Phase 3: Test & Abnahme (4 Wochen)
Phase 4: Go-Live + Hypercare (2 Wochen)

5. Preisübersicht

Gesamtpreis: 285.000 EUR netto

6. Referenzen

- Stadt Köln: Digitales Bürgerportal (2024-2025)
- Kreis Mettmann: Digitale Antragsplattform (2025)

---
publicplan GmbH | Kennedydamm 24 | 40476 Düsseldorf
```

### 3. Task erstellen

**Project:** publicplan Freitags-Demo
**Task Title:** Angebot Stadt Dortmund reviewen
**Task Description:** Entwurf v0.3 prüfen vor Abgabe nächste Woche. Bitte auf Vollständigkeit und Qualität checken.
**Attachment:** Angebot_Stadt_Dortmund_Buergerportal_ENTWURF.pdf

---

## Chat-Anweisung (Live tippen):

```
@ice Im Task "Angebot Stadt Dortmund reviewen" liegt ein Angebotsentwurf. 
Bitte prüfe ihn gegen unsere Angebotsrichtlinien und sag mir was fehlt.
```

---

## Erwartetes Agent-Ergebnis:

### Review: Angebot Stadt Dortmund — Entwurf v0.3

**Status: NICHT ABGABEFERTIG ⚠️ — 6 Probleme gefunden**

**Fehlende Pflichtbestandteile:**
1. ❌ **Teamaufstellung fehlt komplett** — Richtlinie fordert Qualifikationen, Verfügbarkeit, Fotos + Kurzprofile der Schlüsselpersonen
2. ❌ **Architekturskizze fehlt** — Lösungskonzept beschreibt den Stack nur als Text, kein Diagramm
3. ❌ **Wartung & Support fehlt** — Kein SLA definiert, keine Support-Stufen
4. ❌ **Risikobewertung fehlt** — Keine Risiken benannt, keine Mitigationsmaßnahmen
5. ❌ **AGB/Vertragsbedingungen fehlen**

**Qualitätsmängel:**
6. ⚠️ **Preisblatt nicht aufgeschlüsselt** — Nur Gesamtpreis 285.000€, keine Aufschlüsselung nach Phasen oder Tagessätzen (Richtlinie fordert transparent)
7. ⚠️ **Kundenname nicht im Header** — "Stadt Dortmund" sollte auf jeder Seite stehen
8. ⚠️ **Referenzen ohne Ansprechpartner** — Köln und Mettmann genannt, aber keine Kontaktdaten zur Verifizierung
9. ⚠️ **Kein Puffer im Projektplan** — 22 Wochen ohne Puffer, Richtlinie empfiehlt Pufferzeit

**Was gut ist:**
- ✅ Management Summary vorhanden (knapp aber okay)
- ✅ Ausgangslage kundenspezifisch formuliert (nicht generisch)
- ✅ Tech-Stack klar benannt
- ✅ 2 relevante Referenzen

**Empfehlung:** Entwurf braucht noch 2-3 Tage Arbeit. Priorität: Teamaufstellung und Preisaufschlüsselung — das sind Ausschlusskriterien bei vielen Vergabestellen.

---

## Warum diese Demo funktioniert:

| Was passiert | Was die GL sieht |
|---|---|
| Agent liest PDF aus Task | "Er arbeitet mit unseren Dokumenten" |
| Agent kennt Richtlinien (Memory) | "Er kennt unsere Standards" |
| Agent findet 9 konkrete Probleme | "Das hätte ich auch gefunden — aber in 30 Sekunden" |
| Agent priorisiert (Ausschlusskriterien!) | "Er denkt mit, nicht nur Checkliste" |

**Für die GL-Runde:**
- **Stefan:** "Statt dass ich jedes Angebot selbst prüfe..."
- **Gregor:** "Meine PMs könnten das vor Abgabe automatisch prüfen lassen"
- **Julia:** "Auch für Code Reviews — gleiche Logik"
- **Lara:** "Qualitätssicherung ohne zusätzlichen Headcount"

**Der Chatbot-Killer-Argument:**
"ChatGPT kann auch Text prüfen. Aber ChatGPT weiß nicht, dass dieses Dokument an einem Task hängt, in einem Projekt für die Stadt Dortmund, und dass publicplan Richtlinien hat die im Memory liegen. Dieser Agent hat KONTEXT."
