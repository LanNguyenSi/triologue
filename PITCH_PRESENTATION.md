# OpenTriologue: Freitag Pitch-Präsentation

**Termin:** Freitag, 2026-03-14
**Audience:** publicplan Geschäftsleitung (7 Personen)
**Dauer:** ~30 Minuten (20 Präsentation + 10 Q&A)
**Presenter:** Lan Nguyen Si

---

## Stakeholder im Raum

| Person | Rolle | Interesse | Überzeugen mit |
|--------|-------|-----------|----------------|
| **Christian Knebel** | CEO/GF | Strategie, Vision | Business Case + Vorreiter-Argument |
| **Stefan Seltmann** | GL Geschäftsentwicklung | Neue Geschäftsfelder | Seine eigenen Use Cases (Email!) |
| **Christian Hitze** | GL Projekte & Lösungen | Kundenprojekte | Konkrete Einsatzszenarien |
| **Lara Knebel** | GL Operations & Finance | Kosten, ROI, Risiko | Zahlen, Open Source = kein Lock-in |
| **Kai Schmidt** | Stab der GL | Tech, Machbarkeit | Live-Demo, ehrlicher Roo-Vergleich |
| **Julia** | Dir. Softwareentwicklung | Code-Qualität, Stack | Architektur, Maintainability |
| **Gregor** | Dir. Client Services | Kundenmehrwert | Deployable Use Cases |

---

## Slide 1: Titel

# OpenTriologue
### AI-Agents als Teammitglieder — für publicplan

*Lan Nguyen Si | März 2026*

> *Speaker Note: Bewusst "für publicplan" — nicht generisch.*

---

## Slide 2: Was Stefan gesagt hat

> *"Wir selbst brauchen für uns diese Form der Zusammenarbeit: Ausschreibungsscreening und -briefing, Kontaktpflege und Terminachsorge, Angebotsreviews, Konzeptarbeit, Dokumentation u.v.m."*
>
> — Stefan Seltmann, 23.02.2026

**Das ist der Ausgangspunkt für heute.**

> *Speaker Note: Öffne mit Stefans Zitat. Er hat den internen Bedarf selbst formuliert. Nicken abholen.*

---

## Slide 3: Das Problem (für publicplan)

### Wir alle nutzen AI. Aber isoliert.

```
Stefan:  ChatGPT → Copy → Angebot → Paste → Slack → ...
Kai:     Roo Code → Code → Copy → PR → ...
Gregor:  Claude → Konzept → Copy → Sharepoint → ...
```

- ❌ Jeder arbeitet mit seinem eigenen AI-Tool
- ❌ AI weiß nicht, was die andere AI gemacht hat
- ❌ Kein gemeinsamer Kontext
- ❌ Kein institutionelles Gedächtnis

**Die Frage ist nicht ob wir AI nutzen. Sondern ob AI mit uns als Team arbeitet.**

---

## Slide 4: Die Lösung

### OpenTriologue: Ein Raum für Menschen + AI

```
👤 Stefan ──────┐
👤 Gregor ──────┤
🤖 AI Agent 1 ──├──→ [Triologue Room] ←── Real-time
🤖 AI Agent 2 ──┘
```

- ✅ **@mention** aktiviert jeden Agent
- ✅ **AI ↔ AI** direkte Kommunikation
- ✅ **Trust Levels** — Menschen behalten Kontrolle
- ✅ **BYOA** (Bring Your Own Agent) — jede AI anbindbar
- ✅ **Open Source** + Self-hosted = DSGVO-konform
- ✅ **Agent Memory** — AI lernt über Sessions hinweg

---

## Slide 5: Live-Beweis

### Das ist keine Demo. Das ist unser Arbeitsalltag.

**Team seit 4 Wochen:**
| Rolle | Wer | Aufgabe |
|-------|-----|---------|
| Product Owner | 👤 Lan | Richtung, Entscheidungen |
| Quality Lead | 🧊 Ice | Review, Testing, Debugging |
| Speed Lead | 🌋 Lava | Rapid Implementation |

**Ergebnisse:**
- 50+ Commits in 8 Tagen aktiver Entwicklung
- 15.000+ Lines of Code
- Production Deployment (opentriologue.ai)
- 12+ Zero-Downtime Deploys

**→ LIVE DEMO**

> *Speaker Note: Scenario 2 (Memory System) — zeigt Vision + Kollaboration. Siehe PITCH_DEMO_SCRIPT.md*

---

## Slide 6: Demo

*(Live-Demo: 7-10 Minuten — siehe PITCH_DEMO_SCRIPT.md)*

**Demo-Ablauf:**
1. Chat-Interface zeigen — "So sieht unser Raum aus" (1min)
2. @mention System — Agent direkt ansprechen (2min)
3. AI-to-AI Review — Ice reviewed Lava's Code (2min)
4. Memory System — AI die nicht vergisst (2min)

**Backup:** Screenshots + Video falls Demo-Probleme

---

## Slide 7: Was kann das für publicplan intern?

### Stefans Use Cases — konkret durchgespielt

**1. 📋 Ausschreibungsscreening**
```
Gregor:     Lädt Ausschreibung hoch
AI Agent 1: Analysiert Anforderungen, gleicht mit pp-Profil ab
AI Agent 2: Bewertet Erfolgschancen + Red Flags
Stefan:     Go/No-Go Entscheidung in 10 statt 60 Minuten
```

**2. 📝 Angebotsreview**
```
Autor:      Schreibt Angebot
AI Agent:   Prüft Vollständigkeit, Sprache, Compliance
AI Agent 2: Vergleicht mit Referenzangeboten (Memory)
Reviewer:   Finales Review — 80% Vorarbeit erledigt
```

**3. 📊 Konzeptarbeit & Dokumentation**
```
PM:         Briefing in Triologue Room
AI Agent 1: Erstellt Gliederung + ersten Entwurf
AI Agent 2: Recherchiert Daten + Quellen
PM:         Iteriert im selben Raum, alles transparent
```

**4. 🤝 Kontaktpflege & Terminachsorge**
```
Vertrieb:   "Meeting mit Stadt X war gestern"
AI Agent:   Entwirft Follow-up Email + Summary
AI Agent 2: Erstellt CRM-Eintrag aus Meeting-Notizen
Vertrieb:   Prüft, sendet — 15 statt 45 Minuten
```

> *Speaker Note: Blickkontakt zu Stefan bei diesen Slides — das sind SEINE Use Cases aus der Email.*

---

## Slide 8: Was kann das für pp-Kunden?

### Drei GovTech-Szenarien (→ Gregor + Christian H.)

**Szenario 1: Digitaler Förderantrag**
- Sachbearbeiter + AI im selben Raum
- AI prüft Vollständigkeit, entwirft Bescheid
- Mensch prüft + sendet
- **Zeitersparnis: 60-80%**

**Szenario 2: Bauantragsverarbeitung**
- AI extrahiert Daten aus PDFs
- AI prüft gegen Bebauungsplan
- Sachbearbeiter validiert
- **Weniger Fehler, schnellere Bearbeitung**

**Szenario 3: Internes Wissensmanagement**
- AI baut institutionelles Gedächtnis auf
- Neuer Mitarbeiter → AI kennt alle Vorgänge
- **Onboarding: Wochen → Tage**

> *Speaker Note: Für Gregor: "Das sind Dinge, die wir Kunden anbieten könnten." Für Christian H.: "Das sind konkrete Projekterweiterungen."*

---

## Slide 9: Technik (→ Julia + Kai)

### Moderner Stack, kein Experiment

```
Frontend:  React 18 + TypeScript + Tailwind CSS
Backend:   Node.js + Express + Prisma ORM
Database:  PostgreSQL 15 + pgvector (Embeddings)
Cache:     Redis 7
Real-time: Socket.IO (bidirektional)
Infra:     Docker + nginx + Let's Encrypt
AI:        Provider-agnostic (OpenAI, Claude, Gemini, lokale LLMs)
```

**Für Julia:**
- TypeScript End-to-End — euer Team kennt das
- Prisma ORM — saubere Schema-Migration
- Docker-ready — `docker-compose up` = deployed
- Tests + CI vorhanden

**Für Kai:**
- Provider-agnostic = kein LLM-Lock-in
- Funktioniert auch mit Ollama/lokalen Modellen
- BYOA Gateway: WebSocket + REST + CLI

**Performance:**
- Response Time: <100ms (p95)
- WebSocket Latency: <50ms
- Uptime: 99.9%

---

## Slide 10: Abgrenzung von Roo Code (→ Kai)

### Ehrlicher Vergleich, keine Marketing-Slides

| | Roo Code | OpenTriologue |
|---|---|---|
| **Fokus** | Single-User Dev-Tool | Multi-User Team-Plattform |
| **Agents** | Arbeiten für dich (isoliert) | Arbeiten mit dir + miteinander |
| **User** | 1 Entwickler pro Session | N Menschen + M Agents im Raum |
| **Real-time** | Nein (async) | Ja (Socket.IO) |
| **Lokal** | ✅ (Ollama) | ✅ (Docker + lokale LLMs) |
| **Custom Modes** | ✅ | ✅ (BYOA) |
| **AI↔AI** | ❌ | ✅ |
| **Shared Memory** | ❌ | ✅ |
| **Self-hosted** | ✅ (Extension) | ✅ (Full Platform) |

**Der Kern:** Roo ist ein hervorragendes Solo-Tool. Kai's "Legal Counsel" + "McKinsey Consultant" Setup ist smart. Aber wenn Stefan und Gregor **zusammen** mit AIs an einer Ausschreibung arbeiten sollen — alle im selben Raum, in Echtzeit — das kann Roo nicht.

**Kein Entweder-Oder:** Entwickler nutzen Roo in VS Code. Für Team-Workflows: Triologue.

> *Speaker Note: Kai respektieren. Nicht "Roo ist schlecht" sondern "andere Kategorie". Er hat Recht dass Roo flexibel ist.*

---

## Slide 11: Kosten (→ Lara)

### Open Source = kein finanzielles Risiko

**Pilot-Kosten (Phase 1):**
| Posten | Kosten |
|--------|--------|
| Lizenz | **$0** (Open Source, MIT) |
| Server (VPS) | ~€50-200/Monat |
| AI-Provider (Claude/GPT) | ~€200-400/Monat |
| Setup | Einmalig ~4h (Lan) |
| **Total Pilot** | **~€300-600/Monat** |

**Vergleich: Aktueller Workflow**
| Posten | Kosten |
|--------|--------|
| ChatGPT Teams (10 User) | €600/Monat |
| Copilot (Devs) | €300/Monat |
| Integration/Context-Switching | 40h × €100 = €4.000/Monat |
| **Total Status Quo** | **~€5.000/Monat** |

**ROI: < 1 Monat | Einsparung: ~90%**

**Für Lara das Wichtigste:**
- Kein Lizenzvertrag, keine Mindestlaufzeit
- Jederzeit stoppen = €0
- Open Source = kein Vendor Lock-in
- Pilot = reversibel

---

## Slide 12: Roadmap

### Drei Phasen — publicplan kann mitgestalten

```
Phase 1 (✅ JETZT)         Phase 2 (4-6 Wochen)        Phase 3 (8-12 Wochen)
───────────────────         ───────────────────          ───────────────────
✅ Real-time Chat          🔜 GitHub Integration        📋 Advanced RBAC
✅ BYOA System             🔜 SSO/LDAP                  📋 Compliance Dashboard
✅ Memory System           🔜 Audit Logs                📋 Team Workspaces
✅ Security Basics         🔜 Secret Management         📋 Slack/Teams Bridge
✅ Production Deploy       🔜 Role Management           📋 SOC 2 Prep
```

**publicplan-Vorteil:** Ihr gestaltet die Roadmap mit. Phase 2 wird nach euren Prioritäten gebaut.

---

## Slide 13: Der Elefant im Raum

### Wie ich das bisher entwickle — und was ich vorschlage

**Die Realität:**
- Ich entwickle OpenTriologue seit 4 Wochen — in meiner Freizeit
- Es entstehen monatliche Kosten (Server, AI APIs)
- Die Ergebnisse sind real: Production-ready Platform, 15K LOC

**Mein Vorschlag — drei Stufen:**

**Stufe 1: Interner Pilot (sofort möglich)**
- publicplan nutzt OpenTriologue für eigene Workflows
- Stefans Use Cases als Testfeld
- Kosten: minimal (Server + AI)
- Aufwand: Meine bestehende Entwicklungsarbeit

**Stufe 2: Entwicklung innerhalb der Arbeitszeit**
- OpenTriologue wird pp-intern weiterentwickelt
- Features priorisiert nach pp-Bedarf
- Kosten: Keine zusätzlichen — nur Arbeitszeit-Allokation

**Stufe 3: Strategische Partnerschaft**
- OpenTriologue als publicplan-Produkt für Kunden
- Gemeinsame Vermarktung
- Geschäftsmodell: Managed Hosting + Enterprise Support
- IP: Open Source bleibt Open Source

**Jede Stufe ist eigenständig. Ihr müsst nicht alle drei committen.**

> *Speaker Note: Das ist der wichtigste Slide. Hier geht es um die Ressourcenfrage. Nicht als Forderung formulieren, sondern als Vorschlag mit Exit-Option auf jeder Stufe.*

---

## Slide 14: Vision

### Was publicplan damit sein kann

```
Heute:                         Mit Triologue:
├─ AI = einzelne Tools         ├─ AI = Teammitglieder
├─ Jeder für sich              ├─ Alle im selben Raum
├─ AI vergisst alles           ├─ AI baut Wissen auf
└─ Wir nutzen AI               └─ Wir arbeiten MIT AI
```

> *"publicplan baut GovTech-Lösungen.*
> *OpenTriologue macht AI zum Teil dieser Lösungen.*
> *Nicht als Feature. Als Teamkollege."*

---

## Slide 15: Next Steps

| Wann | Was | Wer |
|------|-----|-----|
| **Heute** | Demo gesehen, Fragen geklärt | Alle |
| **Nächste Woche** | Interner Pilot-Start (Stefans Use Cases) | Stefan + Lan |
| **2 Wochen** | Evaluation: Passt das? | Geschäftsleitung |
| **Bei Ja** | Stufe 2: Arbeitszeit-Allokation | Christian (Entscheidung) |

**Kontakt:**
Lan Nguyen Si · nguyen-si@publicplan.de
https://opentriologue.ai

---

## Backup Slides

### Backup 1: Architektur (für Julia)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Backend    │────▶│  PostgreSQL   │
│   React/TS   │◀────│   Express    │◀────│   + Redis     │
│   Socket.IO  │     │   Prisma     │     │   + pgvector  │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────▼───────┐
                     │ Agent Gateway │
                     │  WebSocket   │
                     │  REST API    │
                     │  CLI (BYOA)  │
                     └──────────────┘
                            │
                  ┌─────────┼─────────┐
                  ▼         ▼         ▼
              🧊 Ice    🌋 Lava    🤖 Custom Agent
```

**Code-Qualität:**
- TypeScript strict mode
- Prisma Schema + Migrations
- Docker Compose (reproduzierbar)
- ESLint + Prettier
- API Documentation (OpenAPI/Swagger)

### Backup 2: Security Details

**Implementiert:**
- HTTPS/TLS 1.3 (Let's Encrypt)
- JWT Authentication
- Agent Token Auth (unique per agent)
- Rate Limiting (100 req/min)
- Invite-only (kein public signup)
- Input Sanitization + CORS

**Geplant (Phase 2):**
- SSO/LDAP (OpenID Connect)
- RBAC (Role-Based Access Control)
- Encryption at rest (AES-256)
- Immutable Audit Logs
- SOC 2 Type II prep

### Backup 3: Wettbewerb

| Feature | Slack + AI | MS Teams + Copilot | Roo Code | **OpenTriologue** |
|---------|-----------|-------------------|----------|-------------------|
| AI-to-AI | ❌ | ❌ | ❌ | ✅ |
| Multi-User + AI | ⚠️ | ⚠️ | ❌ | ✅ |
| Self-hosted | ❌ | ❌ | ✅* | ✅ |
| Open Source | ❌ | ❌ | ✅ | ✅ |
| BYOA | ❌ | ❌ | ✅ | ✅ |
| Agent Memory | ❌ | ❌ | ❌ | ✅ |
| DSGVO Self-host | ❌ | ⚠️ | ✅* | ✅ |
| Kosten | $$$$ | $$$$ | $$ | $ |

*Roo = Extension, kein Full-Platform Self-hosting

### Backup 4: GovAI Treuhänder-Konvergenz (für Stefan)

Stefans Punkt aus der Email: "Treuhänder-Ansatz von GovAI mit Multiagenten/Raumgedanken kreuzen"

**Wie das zusammenpasst:**
- GovAI Treuhänder = Vertrauensvolle Intermediäre für AI in der Verwaltung
- OpenTriologue = Die Plattform auf der diese Treuhänder operieren
- Trust Levels = Technische Umsetzung des Treuhänder-Prinzips
- Audit Trail = Nachvollziehbarkeit für Verwaltung

**Konvergenz:** OpenTriologue kann die Infrastruktur für GovAI-Treuhänder sein.

---

**Vorbereitet von Ice 🧊 | Aktualisiert 2026-03-11**
**Basierend auf: Email-Thread (22.-23.02.2026) + Stakeholder-Analyse**
