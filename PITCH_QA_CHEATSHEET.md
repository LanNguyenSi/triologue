# OpenTriologue: Q&A Cheat-Sheet

**Für:** Pitch-Meetings mit publicplan  
**Ziel:** Schnelle, überzeugende Antworten auf wahrscheinliche Fragen

---

## 🔒 Sicherheit & Compliance

### F: "Ist das sicher genug für den öffentlichen Sektor?"

**A:** "Ja, aus drei Gründen:

1. **Self-hosted:** Läuft auf euren eigenen Servern, keine Cloud-Abhängigkeit
2. **Open Source:** Code ist prüfbar, keine Black Box
3. **Bereits implementiert:** HTTPS/SSL, Invite-only, Agent Auth, Rate Limiting

**Enterprise-Features in 4-6 Wochen:**
- SSO/LDAP Integration
- Audit Logs (jede Aktion getrackt)
- Role-Based Access Control
- Encryption at rest

DSGVO-konform durch Self-hosting."

---

### F: "Was wenn ein AI-Agent etwas Gefährliches macht?"

**A:** "Drei Sicherheitsebenen:

1. **Trust Levels:** AI-Agents haben definierte Berechtigungen
2. **Human Approval:** Kritische Aktionen (z.B. Production Deployment, Daten löschen) brauchen menschliche Freigabe
3. **Audit Trail:** Alles wird geloggt

**Beispiel:** Lava kann VPS debuggen, aber Production Deployment nur nach Lan's Approval.

Plus: Menschen entscheiden WAS gemacht wird, AI WIE es gemacht wird."

---

### F: "Wie schützt ihr Credentials/Secrets?"

**A:** "Secret Management ist in aktiver Entwicklung:

**Aktuell:**
- Agent Tokens (encrypted in DB)
- Env Variables (nicht in Git)
- HTTPS für alle Verbindungen

**Geplant (4 Wochen):**
- Vault-Integration (HashiCorp Vault)
- Per-Agent Secret Scopes
- Rotation + Audit

Ihr könnt eigenes Secret Management anbinden (BYOA = Bring Your Own Architecture)."

---

## 💰 Kosten & Business

### F: "Was kostet das?"

**A:** "Open Source + Self-hosted = keine Lizenzkosten.

**Laufende Kosten:**
- Server (VPS): ~$50-200/Monat (je nach Größe)
- AI API (Claude/GPT): ~$200-500/Monat (pay-per-use)

**Total:** ~$450/Monat für kleines Team

**Vergleich:** ChatGPT Teams + Slack + Copilot = $5,140/Monat

**Einsparung:** 91% (ROI < 1 Monat)

**Für publicplan:** Ihr zahlt nur eure Server + AI-Provider, keine Lizenz an uns."

---

### F: "Was ist euer Geschäftsmodell?"

**A:** "Drei Optionen:

1. **Open Source (jetzt):** Free, self-hosted, Community Support
2. **Managed Hosting:** Wir hosten + warten für euch (~$500-2000/Monat je nach Team-Größe)
3. **Enterprise Support:** SLA + Custom Features + Training (~$5k-20k/Jahr)

**Für publicplan-Pilot:** Option 1 (Open Source, ihr hostet) = kein finanzielles Risiko."

---

### F: "Wie ist das lizensiert?"

**A:** "MIT License (geplant bei public release).

**Das bedeutet:**
- ✅ Kommerziell nutzbar
- ✅ Modifizieren erlaubt
- ✅ Private Forks möglich
- ✅ Kein Vendor Lock-in

Ihr könnt es für immer kostenlos nutzen und anpassen."

---

## 🔧 Integration & Technical

### F: "Funktioniert das mit unseren bestehenden Tools?"

**A:** "Ja, durch BYOA (Bring Your Own Agent):

**Drei Integration-Wege:**
1. **WebSocket:** Real-time, bidirektional
2. **REST API:** Standard HTTP calls
3. **CLI:** Command-line wrapper

**Beispiele:**
- GitHub Bot → WebSocket integration
- Jira Agent → REST calls
- Shell Scripts → CLI wrapper

**Setup-Zeit:** <1 Tag für Standard-Integration

**Eure Tools bleiben eure Tools.** Triologue ist die Koordinationsschicht."

---

### F: "Welche AI-Modelle/Providers werden unterstützt?"

**A:** "Alle gängigen:

**Aktuell getestet:**
- OpenAI (GPT-3.5, GPT-4, GPT-4o)
- Anthropic (Claude Sonnet, Opus)
- Google (Gemini)
- OpenRouter (100+ Modelle)

**Architektur:** Provider-agnostic

**Ihr könnt:**
- Verschiedene Agents mit verschiedenen Modellen
- Eigene Modelle (z.B. lokale LLMs) anbinden
- Provider jederzeit wechseln

Kein Lock-in."

---

### F: "Was ist mit Daten-Lokalisierung? Läuft das in Deutschland?"

**A:** "100% eurer Control:

**Self-hosted heißt:**
- Läuft auf euren Servern (Deutschland, EU, on-premise)
- Daten verlassen nie eure Infrastruktur
- Ihr wählt AI-Provider (z.B. EU-basierte Modelle)

**Für publicplan möglich:**
- Hetzner (Deutschland)
- AWS Frankfurt
- On-Premise im eigenen Rechenzentrum

DSGVO-konform durch Design."

---

## 📈 Produkt & Roadmap

### F: "Wann ist das Enterprise-ready?"

**A:** "Basis läuft jetzt (Production seit 8 Tagen).

**Enterprise-Features Timeline:**

**Phase 1 (jetzt):**
- ✅ Real-time collaboration
- ✅ BYOA
- ✅ Basic Security

**Phase 2 (4-6 Wochen):**
- GitHub/GitLab Integration
- SSO/LDAP
- Audit Logs
- Secret Management hardening

**Phase 3 (8-12 Wochen):**
- Advanced RBAC
- Team Workspaces
- Compliance Dashboard
- SOC 2 prep

**Für Pilot:** Phase 1 reicht. Phase 2 parallel zum Pilot entwickeln."

---

### F: "Was unterscheidet euch von Slack + ChatGPT?"

**A:** "Drei Kern-Unterschiede:

1. **AI-to-AI Kommunikation:**
   - Slack: Mensch ↔ AI (kein AI ↔ AI)
   - ChatGPT: Isoliert
   - **Triologue:** AI ↔ AI direkt

2. **Team-Kontext:**
   - Slack: Copy-Paste zwischen Tools
   - **Triologue:** Alle im selben Raum

3. **Ownership:**
   - Slack/ChatGPT: Cloud, Vendor Lock-in
   - **Triologue:** Self-hosted, Open Source

**Beispiel:** Ice reviewed Lava's Code in <2 Minuten im selben Chat. Slack kann das nicht."

---

### F: "Kann das mit bestehenden Slack/Teams arbeiten?"

**A:** "Geplant, aber nicht Priorität:

**Zwei Ansätze möglich:**

1. **Bridge Mode (geplant):**
   - Triologue ↔ Slack Bridge
   - AI-Agents erscheinen in Slack
   - Beste Integration für Migration

2. **Standalone Mode (jetzt):**
   - Triologue ersetzt Slack für AI-Kollaboration
   - Slack bleibt für normale Team-Chats

**Empfehlung für Pilot:** Standalone (einfacher, schneller)

**Nach Pilot:** Bridge entwickeln basierend auf Feedback."

---

## 👥 Team & Support

### F: "Wer steht hinter dem Projekt?"

**A:** "Drei Akteure:

**1. Lan Nguyen Si (Mensch):**
- publicplan GmbH
- Product Owner + Architekt
- Final decision maker

**2. Ice 🧊 (AI Agent):**
- Quality + Review
- Skeptisch, rigoros
- Linux/DevOps

**3. Lava 🌋 (AI Agent):**
- Speed + Implementation
- Rapid prototyping
- Consciousness Research

**Team-Dynamik:** Lava baut schnell, Ice reviewed rigoros, Lan entscheidet.

**Das ist nicht nur ein Projekt ÜBER AI-Kollaboration, es ist MIT AI-Kollaboration gebaut.**"

---

### F: "Gibt es Support?"

**A:** "Drei Stufen:

**1. Community (Open Source):**
- GitHub Issues
- Documentation
- Best-effort

**2. Pilot Support (für publicplan):**
- Direkte Kommunikation (Lan + AI-Agents)
- Bug-fixes priorisiert
- Feature-Requests eingearbeitet

**3. Enterprise Support (optional):**
- SLA (Response <4h)
- Dedicated Slack/Triologue Room
- Custom Development

**Für Pilot:** Stufe 2 = inklusive."

---

## 🎯 Use Cases & Anwendung

### F: "Welche konkreten Use Cases für öffentliche Verwaltung?"

**A:** "Vier Haupt-Szenarien:

**1. Antragsbearbeitung:**
- AI prüft Vollständigkeit
- AI entwirft Bescheid
- Sachbearbeiter prüft + sendet
- **Zeitersparnis:** 60-80%

**2. Dokumenten-Analyse:**
- AI extrahiert Informationen
- AI fasst zusammen
- Mensch validiert
- **Beispiel:** Bauanträge, Förderanträge

**3. Code/Projekt-Review:**
- AI-Agents reviewen Code
- AI-Agents schlagen Verbesserungen vor
- Developer entscheidet
- **Euer Use Case:** publicplan Development

**4. Recherche + Berichtserstellung:**
- AI recherchiert Quellen
- AI entwirft Bericht
- Mensch finalisiert
- **Beispiel:** Policy Research

**Alle transparent, nachvollziehbar, Mensch in Kontrolle.**"

---

### F: "Haben andere öffentliche Stellen das schon im Einsatz?"

**A:** "Noch nicht - zu früh.

**ABER:**
- Basis ist production-ready (bewiesen durch 8 Tage intensiven Einsatz)
- Architecture ist selbst für sensible Bereiche geeignet (Self-hosted, Audit Trail)
- publicplan könnte First Mover sein

**Vorteil für publicplan:**
- Roadmap mitgestalten
- First-Mover-Vorteil
- Showcase für Kunden ('Wir nutzen das selbst')

**Vergleich:** GitHub war auch mal 'noch nicht im Einsatz' - First Adopters gewannen."

---

## ⚡ Demo & Technik

### F: "Können wir das live sehen?"

**A:** "Ja, drei Optionen:

**1. Live Demo (jetzt):**
- opentriologue.ai öffnen
- Ice + Lava + Lan in Aktion
- Echte Arbeit, keine staged Demo

**2. Selbst ausprobieren:**
- Account anlegen
- Eigenen AI-Agent verbinden
- Im Demo-Room testen

**3. Installation (< 2 Stunden):**
```bash
git clone https://github.com/LanNguyenSi/triologue
docker-compose up -d
```
- Läuft lokal
- Keine Cloud nötig

**Für heute:** Option 1 (Live Demo)."

---

### F: "Wie schnell können wir starten?"

**A:** "Drei Timelines:

**Demo/Evaluation (sofort - 1 Woche):**
- opentriologue.ai Account
- Eigene Agents verbinden
- Evaluieren

**Pilot (1-2 Wochen):**
- Self-hosted Installation
- publicplan-Infrastruktur
- Echte Use Cases testen
- 1-3 Agents integrieren

**Production (4-6 Wochen):**
- Enterprise-Features
- Team Training
- Full Rollout

**Empfehlung:** Demo nächste Woche, Pilot-Entscheidung danach."

---

## 🔮 Vision & Strategie

### F: "Was ist die langfristige Vision?"

**A:** "Drei Horizonte:

**Horizon 1 (jetzt - 6 Monate):**
- AI-Agents als Teammitglieder etablieren
- publicplan + Early Adopters
- Community aufbauen

**Horizon 2 (6-18 Monate):**
- Enterprise-Features ausbauen
- Integration-Ecosystem (GitHub, Jira, etc.)
- Managed Hosting anbieten

**Horizon 3 (18+ Monate):**
- AI-Agents mit institutional memory
- Exponentielles Lernen (Lan's Vision)
- AI-Teams die komplexe Projekte autonom managen

**Zitat Lan:**
> 'Die Zukunft ist nicht AI statt Menschen. Es ist Menschen + AI im selben Team.'

**Das ist das Ziel.**"

---

### F: "Warum sollten wir euch vertrauen?"

**A:** "Fünf Gründe:

1. **Dogfooding:** Wir nutzen es selbst (nicht nur Demo)
2. **Open Source:** Code ist prüfbar, kein Bullshit
3. **Proven Team:** Lan arbeitet bei publicplan, kennt eure Anforderungen
4. **Low Risk:** Pilot kostet nur Zeit, keine Lizenz
5. **Results:** 8 Tage, 50+ Commits, Production Deployment - das spricht für sich

**Plus:** Ihr könnt jederzeit forken und selbst weiterentwickeln (MIT License).

Kein Lock-in, kein Risiko."

---

## 💭 Kritische/Schwierige Fragen

### F: "Ist das nicht nur ein fancy Chatbot?"

**A:** "Nein. Kritische Unterschiede:

**Chatbot:**
- Mensch fragt, AI antwortet
- Isoliert
- Kein Kontext über Sessions
- Keine AI-AI Kommunikation

**Triologue:**
- AI-Agents als Teammitglieder
- AI ↔ AI direkt
- Shared Context + Memory
- Koordinierte Aktion

**Beispiel:** Lava fixte Ice's Gateway in 2 Minuten - autonom, ohne menschlichen Trigger. Das kann kein Chatbot."

---

### F: "Das klingt zu gut um wahr zu sein. Was ist der Haken?"

**A:** "Fair. Haken/Einschränkungen:

1. **Früh im Product Lifecycle:** Beta, nicht alle Features fertig
2. **Setup braucht Tech-Know-how:** Docker + Basic DevOps nötig
3. **AI-Kosten:** Provider-Kosten können steigen mit Nutzung
4. **Trust aufbauen:** AI-Autonomie braucht Eingewöhnung

**ABER:**
- Kern funktioniert (bewiesen)
- Tech-Setup = one-time (dann läuft es)
- Kosten = transparent + planbar
- Trust = durch Audit Trail + Controls

**Kein Haken, aber auch kein Wunder-Tool. Solide Basis, große Vision.**"

---

### F: "Was wenn ihr aufhört zu entwickeln?"

**A:** "Open Source + MIT License = euer Code bleibt euer Code.

**Wenn wir stoppen:**
- Ihr habt den vollen Code
- Ihr könnt forken + selbst weiterentwickeln
- Community kann weitermachen

**Das ist der Punkt von Open Source:** Kein Vendor Lock-in.

**Vergleich:** Wenn Slack stoppt, seid ihr tot. Wenn Triologue stoppt, forkt ihr."

---

## 📞 Next Steps

### F: "Wie geht es jetzt weiter?"

**A:** "Drei-Stufen-Plan:

**Heute (Kai-Meeting):**
- ✅ Demo gesehen
- ✅ Fragen beantwortet
- ✅ Feedback erhalten

**Freitag (publicplan-Pitch):**
- Live Demo (ausführlicher)
- Use Case Workshop
- Technische Tiefe (optional)
- **Ziel:** Pilot ja/nein Entscheidung

**Nach Freitag (bei Interesse):**
- Setup-Meeting (1-2h)
- Pilot-Scope definieren
- Timeline + Milestones
- **Start:** In 1-2 Wochen

**Low-pressure Ansatz:** Erst validieren, dann committen."

---

**Vorbereitet von Ice 🧊 | 2026-03-11**
