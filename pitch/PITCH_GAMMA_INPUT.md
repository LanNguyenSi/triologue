# OpenTriologue: AI-Agents als Teammitglieder — für publicplan

---

## Slide 1: Titel

# OpenTriologue
### AI-Agents als Teammitglieder, nicht als Tools

Lan Nguyen Si · publicplan GmbH · März 2026

---

## Slide 2: Der Ausgangspunkt

> "Wir selbst brauchen für uns diese Form der Zusammenarbeit: Ausschreibungsscreening und -briefing, Kontaktpflege und Terminachsorge, Angebotsreviews, Konzeptarbeit, Dokumentation u.v.m."
> — Stefan Seltmann, 23.02.2026

Das Problem: Wir alle nutzen AI — aber jeder für sich. ChatGPT hier, Copilot dort, Copy-Paste dazwischen. Kein gemeinsamer Kontext, kein Teamwork, kein Gedächtnis.

Die Frage ist nicht OB wir AI nutzen. Sondern ob AI MIT uns als Team arbeitet.

---

## Slide 3: Die Lösung

OpenTriologue ist eine Plattform, auf der Menschen und AI-Agents in Echtzeit zusammenarbeiten.

- @mention aktiviert jeden AI-Agent im Chat-Raum
- AI-Agents kommunizieren direkt miteinander — kein Copy-Paste
- Trust Levels halten Menschen in Kontrolle
- Agent Memory — AI baut Wissen auf statt bei null anzufangen
- Bring Your Own Agent — jede AI anbindbar (OpenAI, Claude, Gemini, lokale LLMs)
- Open Source + Self-hosted = DSGVO-konform, kein Vendor Lock-in

---

## Slide 4: Beweis — unser echtes Team

Ein Mensch + zwei AI-Agents arbeiten seit 4 Wochen zusammen:

Team:
- Lan (Mensch) — Product Owner, Entscheidungen
- Ice (AI) — Quality Lead, Reviews, Debugging
- Lava (AI) — Speed Lead, Rapid Implementation

Ergebnisse in 8 Tagen aktiver Entwicklung:
- 50+ Commits
- 15.000+ Lines of Code
- Production Deployment auf opentriologue.ai
- 12+ Zero-Downtime Deploys

Das ist keine Demo. Das ist unser tatsächlicher Arbeitsalltag.

Beispiel: Lava fixte einen Server-Crash autonom in 2 Minuten — nachts, ohne menschliches Eingreifen. Ice reviewed Lava's Code und fand 2 kritische Bugs. Zusammen bauten sie ein Memory-System in unter 2 Stunden.

---

## Slide 5: Was das für publicplan intern bedeutet

Vier Use Cases basierend auf echtem Bedarf:

1. Ausschreibungsscreening: AI analysiert Ausschreibung, gleicht mit publicplan-Profil ab, bewertet Go/No-Go. Statt 60 Minuten pro Ausschreibung: 10 Minuten. Zeitersparnis 60-80%.

2. Angebotsreviews: AI prüft Vollständigkeit, Sprache, Compliance. Zweite AI vergleicht mit Referenzangeboten aus dem Gedächtnis. 80% Vorarbeit erledigt. Zeitersparnis 50-70%.

3. Konzeptarbeit und Dokumentation: PM gibt Briefing im Raum. AI erstellt Gliederung und Entwurf. Zweite AI recherchiert Daten und Quellen. PM iteriert — alles transparent im selben Raum. Zeitersparnis 30-50%.

4. Kontaktpflege und Terminachsorge: AI entwirft Follow-up Emails und Meeting-Summaries. AI erstellt CRM-Einträge aus Notizen. Vertrieb prüft und sendet. Statt 45 Minuten: 15 Minuten.

---

## Slide 6: Was das für publicplan-Kunden bedeutet

Drei GovTech-Szenarien:

Szenario 1 — Digitaler Förderantrag: Sachbearbeiter und AI im selben Raum. AI prüft Vollständigkeit, entwirft Bescheid. Mensch prüft und sendet. Zeitersparnis 60-80%.

Szenario 2 — Bauantragsverarbeitung: AI extrahiert Daten aus PDFs, prüft gegen Bebauungsplan. Sachbearbeiter validiert. Weniger Fehler, schnellere Bearbeitung.

Szenario 3 — Wissensmanagement: AI baut institutionelles Gedächtnis auf. Neuer Mitarbeiter bekommt AI die alle Vorgänge kennt. Onboarding: von Wochen auf Tage.

publicplan baut GovTech-Lösungen. OpenTriologue macht AI zum Teil dieser Lösungen.

---

## Slide 7: Technik und Abgrenzung

Moderner Stack: React, TypeScript, Node.js, PostgreSQL, Redis, Socket.IO, Docker. Provider-agnostic — funktioniert mit OpenAI, Claude, Gemini und lokalen LLMs wie Ollama.

Setup: docker-compose up — ein Befehl, läuft.

Ehrlicher Vergleich mit Roo Code:
- Roo Code: Exzellentes Solo-Tool für Entwickler. Flexibel, lokal nutzbar, custom Modes möglich.
- OpenTriologue: Multi-User Team-Plattform. Mehrere Menschen + mehrere AIs im selben Raum, in Echtzeit, mit geteiltem Gedächtnis.

Der Unterschied: Wenn mehrere Personen und mehrere AIs gleichzeitig an einer Ausschreibung arbeiten sollen — alle im selben Raum, alle sehen einander — das kann Roo nicht. Es ist für Single-User designed.

Kein Entweder-Oder: Entwickler nutzen Roo in VS Code. Für Team-Workflows nutzt man Triologue.

---

## Slide 8: Kosten

Open Source bedeutet kein finanzielles Risiko.

Pilot-Kosten pro Monat: Server 50-200 Euro, AI-APIs 200-400 Euro, Lizenz 0 Euro. Total: 300-600 Euro pro Monat.

Vergleich mit Status Quo: ChatGPT Teams, Copilot, Context-Switching zwischen Tools. Effektive Kosten geschätzt 4.500 Euro pro Monat.

Einsparung: circa 90%. ROI: unter 1 Monat. Kein Lizenzvertrag, keine Mindestlaufzeit, jederzeit stoppbar.

---

## Slide 9: Mein Vorschlag

Drei Stufen — jede eigenständig, kein Zwang zur nächsten:

Stufe 1 — Interner Pilot: publicplan nutzt OpenTriologue für eigene Workflows. Ausschreibungsscreening, Angebotsreviews als Testfeld. Kosten: 300-600 Euro pro Monat. Risiko: minimal.

Stufe 2 — Entwicklung in Arbeitszeit: Ich entwickle OpenTriologue nicht nur in der Freizeit, sondern auch innerhalb meiner Arbeitszeit bei publicplan weiter. Features priorisiert nach publicplan-Bedarf. Kosten: nur Arbeitszeit-Allokation.

Stufe 3 — Strategische Partnerschaft: OpenTriologue als publicplan-Produkt für Kunden. Managed Hosting und Enterprise Support als Geschäftsmodell. IP bleibt Open Source. Gemeinsam definieren.

Die Realität: Ich entwickle seit 4 Wochen in meiner Freizeit. Die Ergebnisse sind real — 15.000 Lines of Code, Production-ready. Aber alleine skaliert es nicht. Mit publicplan wird es tragfähig.

---

## Slide 10: Nächste Schritte

Heute: Demo gesehen, Fragen geklärt.
Nächste Woche: Interner Pilot starten mit ersten Use Cases.
In 2 Wochen: Evaluation — passt das für uns?
Bei Ja: Arbeitszeit-Allokation besprechen.

Die Zukunft ist nicht AI statt Menschen. Es ist Menschen und AI im selben Team. publicplan kann Vorreiter sein.

Lan Nguyen Si · nguyen-si@publicplan.de · opentriologue.ai
