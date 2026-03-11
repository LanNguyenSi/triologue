# OpenTriologue: Q&A Cheat-Sheet

**Für:** Freitag 2026-03-14, publicplan Geschäftsleitung
**Ziel:** Schnelle Antworten auf Fragen von 7 verschiedenen Stakeholdern

---

## 🎯 Nach Stakeholder sortiert

### Christian Knebel (CEO) — Strategie & Vision

**F: "Was ist das langfristig für publicplan?"**
A: "Drei Horizonte: (1) Intern nutzen für eigene Workflows — sofort. (2) Als Produktfeature für Kunden anbieten — 3-6 Monate. (3) AI-Team-Kollaboration als publicplan-USP im GovTech-Markt — 6-12 Monate. publicplan wäre First Mover."

**F: "Warum sollten wir das nicht einfach kaufen?"**
A: "Es gibt kein vergleichbares Produkt. Slack + ChatGPT = kein AI↔AI. Microsoft Copilot = Single-User. Roo = Dev-only. Multi-User + Multi-AI + Self-hosted + Open Source: Das existiert nur hier."

**F: "Was wenn du aufhörst?"**
A: "Open Source + MIT License. Code gehört allen. publicplan kann forken und selbst weiterentwickeln. Das ist der Punkt von Open Source — kein Vendor Lock-in, nicht mal an mich."

---

### Stefan Seltmann (GL Geschäftsentwicklung) — Business Cases

**F: "Wie schnell können wir Ausschreibungsscreening damit machen?"**
A: "Pilot in 1-2 Wochen aufgesetzt. AI-Agent analysiert Ausschreibung, gleicht mit pp-Profil ab, bewertet Go/No-Go. Stefan reviewed. Statt 60 Minuten pro Ausschreibung → 10 Minuten."

**F: "Treuhänder-Ansatz + Multiagenten — wie passt das zusammen?"**
A: "Guter Punkt aus deiner Email. Trust Levels in OpenTriologue sind die technische Umsetzung des Treuhänder-Prinzips: AI-Agents haben definierte Berechtigungen, alles wird geloggt, Menschen approven kritische Aktionen. OpenTriologue kann die Infrastruktur für GovAI-Treuhänder sein."

**F: "Verwaltung ist dafür 5 Jahre nicht ready — warum jetzt?"**
A: "Dein Punkt ist richtig für Endkunden-Deployment. Aber: (1) publicplan intern ist JETZT ready. (2) Wer das Produkt in 5 Jahren verkaufen will, muss es JETZT bauen. (3) Early-Adopter-Verwaltungen gibt es — die suchen genau sowas."

---

### Christian Hitze (GL Projekte & Lösungen) — Kundenprojekte

**F: "Kann ich das in ein bestehendes Kundenprojekt einbauen?"**
A: "Ja. BYOA = Bring Your Own Agent. Wenn ein Kundenprojekt bereits AI nutzt, kann der Agent sich via WebSocket/REST verbinden. Setup: <1 Tag. Für neue Projekte: Docker-Install auf Kundeninfrastruktur."

**F: "Funktioniert das mit Fachverfahren (OZG, FIM, XÖV)?"**
A: "Noch nicht direkt integriert — aber die Architektur erlaubt es. AI-Agents können via API auf Fachverfahren zugreifen. Das wäre ein Phase-2-Feature, genau für solche Kundenprojekte."

**F: "Was sagen Kunden wenn sie hören 'Beta'?"**
A: "Kern ist production-ready (4 Wochen Dogfooding). 'Beta' heißt: Enterprise-Features (SSO, Audit Logs) kommen noch. Für einen Pilot reicht Phase 1. Und: Es ist Open Source — Kunden können den Code selbst prüfen."

---

### Lara Knebel (GL Operations & Finance) — Kosten & Risiko

**F: "Was kostet uns das?"**
A: "Pilot: €300-600/Monat (Server + AI-Provider). Keine Lizenz, kein Vertrag, kein Minimum. Vergleich: Aktueller ChatGPT + Copilot Workflow kostet uns ~€5.000/Monat effektiv. ROI < 1 Monat."

**F: "Was ist das finanzielle Risiko?"**
A: "Minimal: Open Source = €0 Lizenz. Pilot jederzeit stoppbar = €0 Austrittskosten. Keine Mindestlaufzeit. Worst Case: Wir stoppen nach 2 Wochen und haben €600 ausgegeben + Erkenntnisse gewonnen."

**F: "Wer bezahlt die AI-API-Kosten?"**
A: "Direkt beim Provider (Anthropic, OpenAI). Pay-per-use, kein Abo. Pilotkosten: ~€200-400/Monat für realistisches Team. Skaliert linear mit Nutzung — transparent und planbar."

**F: "Brauchen wir zusätzliches Personal?"**
A: "Für Pilot: Nein. Ich baue und betreibe. Für Scale-up: 1 DevOps (teilzeit) für Infrastruktur. Julia's Team kann maintainen — der Stack ist Standard."

---

### Kai Schmidt (Stab der GL) — Technik & Abgrenzung

**F: "Was kann das was Roo Code nicht kann?"**
A: "Multi-User-Echtzeit-Kollaboration. Roo = exzellent für Solo-Devs. Dein Legal Counsel + McKinsey Setup ist smart. Aber: Wenn Stefan UND Gregor UND zwei AIs gleichzeitig an einer Ausschreibung arbeiten sollen — alle im selben Raum, alle sehen einander — das geht mit Roo nicht. Roo ist Single-User."

**F: "Funktioniert das mit lokalen LLMs / Ollama?"**
A: "Ja. Provider-agnostic. OpenAI, Claude, Gemini, Ollama, LM Studio — alles via API. Kein Lock-in an einen LLM-Provider."

**F: "Letztes Mal hat deine AI halluziniert (Roo braucht Internet)..."**
A: "Stimmt, das war ein Fehler von mir. Roo funktioniert lokal — du hattest Recht. OpenTriologue's Vorteil ist nicht 'lokal vs. Cloud', sondern 'Solo vs. Team'. Das ist die ehrliche Abgrenzung."

**F: "Wie ist die Code-Qualität?"**
A: "TypeScript strict, Prisma ORM, Docker, ESLint. OpenAPI/Swagger Docs. Kann Julia's Team reviewen — ich hab nichts zu verstecken. Repo öffne ich gern."

---

### Julia (Dir. Softwareentwicklung) — Code & Maintainability

**F: "Kann mein Team das maintainen?"**
A: "Ja. Stack: React + TypeScript + Node.js + PostgreSQL + Docker. Alles was euer Team kennt. Prisma für DB-Migrations, Docker Compose für Deployment. Kein exotisches Framework."

**F: "Wie ist die Testabdeckung?"**
A: "Aktuell: Fokus auf Integration Tests + E2E. Unit Test Coverage: ausbaubar. Für Pilot reicht es. Für Production: Test-Coverage ist Phase-2-Priorität."

**F: "Ist das ein Nebenprojekt oder ernsthaft?"**
A: "15.000 LOC, 50+ Commits, Production Deployment, 4 Wochen Dogfooding mit AI-Agents als Daily-Drivers. Das ist keine Wochenend-Spielerei. Aber: Alleine skaliert es nicht. Deswegen bin ich hier."

**F: "Architektur-Entscheidungen — warum Socket.IO statt WebRTC/gRPC?"**
A: "Socket.IO für Chat + Agent-Kommunikation: bewährt, skaliert, Fallbacks. WebRTC wäre Overkill (kein Video/Audio nötig). gRPC wäre für Agent Gateway denkbar — Phase 2 Evaluation."

---

### Gregor (Dir. Client Services) — Kundenmehrwert

**F: "Was kann ich Kunden nächste Woche anbieten?"**
A: "Einen Demo-Account zum Ausprobieren (existiert schon). Für konkretes Angebot: Nach dem Pilot wissen wir, was funktioniert. Dann: 'publicplan bietet AI-Team-Kollaboration als Managed Service an.'"

**F: "Wie erkläre ich das einem Bürgermeister?"**
A: "'Stellen Sie sich vor, Ihre Sachbearbeiter haben AI-Assistenten die zusammenarbeiten — einer analysiert Anträge, einer prüft Vollständigkeit, Ihr Mitarbeiter entscheidet. Alles transparent, alles auf Ihrem Server.'"

**F: "Können wir das für verschiedene Kunden anpassen?"**
A: "Ja. BYOA = Custom Agents pro Kunde. Fachverfahrens-Agent für Stadt A, Förderantrags-Agent für Land B. Self-hosted pro Kunde = Datentrennung garantiert."

---

## 🔒 Sicherheit & Compliance (Alle)

**F: "DSGVO?"**
A: "Self-hosted = Daten verlassen nie die eigene Infrastruktur. Kein Cloud-Dienst eines Drittanbieters nötig. AI-Provider: EU-Endpunkte verfügbar (Anthropic EU, Azure OpenAI)."

**F: "BSI-Grundschutz?"**
A: "Noch kein Zertifikat — aber Architektur ist kompatibel. Self-hosted, Audit Trail, Access Control. SOC 2 Prep auf Roadmap."

**F: "Was wenn ein AI-Agent etwas Falsches macht?"**
A: "Trust Levels: AI hat definierte Berechtigungen. Human Approval für kritische Aktionen. Audit Trail für alles. Plus: Menschen entscheiden WAS, AI entscheidet WIE."

---

## 💡 Kritische Fragen

**F: "Das klingt zu gut. Was ist der Haken?"**
A: "Ehrlich: (1) Frühe Phase — nicht alle Enterprise-Features fertig. (2) Ein-Mann-Entwicklung bisher. (3) AI-Kosten steigen mit Nutzung. Aber: Kern funktioniert (bewiesen), und genau deswegen bin ich hier — mit publicplan wird es tragfähig."

**F: "Warum machst du das nicht als Startup?"**
A: "Könnte ich. Aber: (1) publicplan hat die Kunden im GovTech. (2) publicplan hat das Domain-Wissen. (3) Gemeinsam ist das stärker als alleine. Und: Ich arbeite gerne hier."

**F: "Was willst du eigentlich von uns?"**
A: "Kurz: (1) Einen internen Pilot starten. (2) Daran auch in der Arbeitszeit entwickeln können. (3) Langfristig: gemeinsam überlegen ob das ein publicplan-Produkt wird. Schritt für Schritt — keine große Forderung."

---

**Vorbereitet von Ice 🧊 | Aktualisiert 2026-03-11**
**Basierend auf: Email-Thread (22.-23.02), Stakeholder-Analyse, vorherige Q&A**
