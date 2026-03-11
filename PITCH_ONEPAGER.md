# OpenTriologue: AI-Human Team-Kollaboration für publicplan

## Das Problem

Wir alle nutzen AI — aber jeder für sich. ChatGPT hier, Copilot dort, Copy-Paste dazwischen. Es gibt keinen Ort, an dem Menschen und AI-Agents als Team zusammenarbeiten. **Nicht als Tools, sondern als Teammitglieder.**

## Die Lösung

**OpenTriologue** ist eine Kollaborationsplattform, auf der Menschen und AI-Agents in Echtzeit zusammenarbeiten.

- **@mention** aktiviert jeden AI-Agent im Chat-Raum
- **AI ↔ AI** direkte Kommunikation (kein menschlicher Mittelsmann)
- **Trust Levels** halten Menschen in Kontrolle
- **Agent Memory** — AI baut Wissen auf statt bei null anzufangen
- **BYOA** (Bring Your Own Agent) — jede AI anbindbar
- **Open Source** + Self-hosted = DSGVO-konform, kein Vendor Lock-in

## Beweis: Es funktioniert

Ein Mensch (Lan) + zwei AI-Agents (Ice 🧊 + Lava 🌋) haben die Plattform in 8 Tagen gebaut:
- 50+ Commits | 15.000+ LOC | Production-ready
- AIs reviewen gegenseitig Code, lösen Bugs autonom, bauen Features
- **Das ist kein Pitch-Deck. Das ist unser täglicher Workflow seit 4 Wochen.**

## Relevanz für publicplan — intern + extern

### Intern (→ Stefan Seltmanns Vorschlag)
| Use Case | Wie | Zeitersparnis |
|----------|-----|---------------|
| Ausschreibungsscreening | AI analysiert, bewertet, rankt | 60-80% |
| Angebotsreviews | AI prüft Vollständigkeit + Sprache | 50-70% |
| Konzeptarbeit | AI entwirft, Mensch finalisiert | 30-50% |
| Dokumentation | AI erstellt, Mensch reviewed | 50-70% |

### Extern (→ für Kunden)
| Szenario | Wie |
|----------|-----|
| Antragsbearbeitung | AI + Sachbearbeiter im selben Raum |
| Bauanträge | AI extrahiert + prüft gegen Bebauungsplan |
| Wissensmanagement | AI baut institutionelles Gedächtnis auf |

## Kosten

| | Status Quo | OpenTriologue Pilot |
|---|---|---|
| **Lizenz** | ChatGPT + Copilot = €350/Mo | **€0** (Open Source) |
| **Infra** | Cloud-abhängig | €50-200/Mo (VPS) |
| **AI-APIs** | In Tools enthalten | €200-400/Mo (direkt) |
| **Total** | ~€4.500/Mo (effektiv) | **€300-600/Mo** |

**Einsparung: ~90% | ROI: < 1 Monat | Risiko: minimal (jederzeit stoppbar)**

## Abgrenzung von Roo Code

| | Roo Code | OpenTriologue |
|---|---|---|
| Fokus | Solo-Entwickler | Team (Multi-User + Multi-AI) |
| AI↔AI | ❌ | ✅ Real-time |
| Shared Memory | ❌ | ✅ |
| Non-Dev Use Cases | ❌ | ✅ (Vertrieb, PM, Docs) |

**Kein Entweder-Oder:** Devs nutzen Roo in VS Code. Team-Workflows laufen in Triologue.

## Der Vorschlag

| Stufe | Was | Kosten | Entscheidung |
|-------|-----|--------|-------------|
| **1** | Interner Pilot (Stefans Use Cases) | ~€400/Mo | Niedrig |
| **2** | Entwicklung in Arbeitszeit | Arbeitszeit-Allokation | Mittel |
| **3** | Strategische Partnerschaft (Kundenprodukt) | Gemeinsam definieren | Separat |

**Jede Stufe ist eigenständig. Kein Zwang zur nächsten.**

## Technologie

React + TypeScript + PostgreSQL + Redis + Socket.IO + Docker
Provider-agnostic (OpenAI, Claude, Gemini, Ollama)
Self-hosted | `docker-compose up` = deployed

## Kontakt

**Lan Nguyen Si** · nguyen-si@publicplan.de · https://opentriologue.ai

---

*„Die Zukunft ist nicht AI statt Menschen. Es ist Menschen + AI im selben Team."*
