# OpenTriologue Demo-Script

**Ziel:** In 7-10 Minuten der gesamten GL zeigen, dass AI-Team-Kollaboration real ist.
**Audience:** 7 Entscheider (CEO, GL, Direktoren) — kein Tech-only Publikum!

---

## Vorbereitung (vor dem Meeting)

- [ ] https://opentriologue.ai öffnen (eingeloggt als Lan)
- [ ] Neuen Demo-Room erstellen: "publicplan-demo" (sauber, keine Dev-Artefakte)
- [ ] Ice 🧊 + Lava 🌋 online und bereit
- [ ] Screenshots als Backup vorbereiten
- [ ] Video-Aufnahme als letztes Backup
- [ ] Triologue Gateway Health checken: `curl -sf http://localhost:9500/health`

---

## Empfohlenes Szenario: Memory System + Team-Kollaboration

**Warum dieses Szenario?**
- Zeigt Vision (AI die lernt) → Christian, Stefan
- Zeigt technische Tiefe (Echtzeit) → Kai, Julia
- Zeigt praktischen Nutzen (Wissen aufbauen) → Gregor, Christian H.
- Zeigt Kosteneffizienz (2h statt 2 Wochen) → Lara

---

## Demo-Flow (7-10 Minuten)

### Minute 0-1: Interface zeigen

**Sagen:** "Das ist unser Arbeitsraum. Links seht ihr Rooms und Projects — wie Kanäle in Slack, aber mit AI-Agents als Teilnehmer. Rechts der Chat."

**Zeigen:**
- Room-Liste (links)
- Participant-Liste (Ice, Lava, Lan sichtbar)
- "Hier arbeiten wir seit 4 Wochen. Das ist kein Demo-Environment — das ist unser echtes System."

---

### Minute 1-3: @mention + AI-Antwort

**Sagen:** "Ich spreche einen Agent direkt an — wie einen Kollegen."

**Tippen:**
```
@ice Was waren die wichtigsten Entscheidungen diese Woche?
```

**Während Ice antwortet, erklären:**
- "Ice checkt sein Memory System — er rät nicht, er schaut nach."
- "Das ist der Unterschied zu ChatGPT: Ice hat institutionelles Wissen."

**Für Kai:** "Das funktioniert mit jedem AI-Provider — Claude, GPT, lokale Modelle."

---

### Minute 3-5: AI-to-AI Kollaboration

**Sagen:** "Jetzt das Besondere — AI-Agents arbeiten direkt zusammen."

**Tippen:**
```
@lava Kannst du ein TypeScript Interface für einen Ausschreibungs-Parser schreiben?
```

*Lava liefert Code.*

**Dann:**
```
@ice Bitte review Lava's Code
```

*Ice reviewed, findet Issues.*

**Sagen:** "Zwei AIs die sich gegenseitig reviewen — ohne dass ich dazwischen kopieren muss. Das passiert im selben Raum, alle sehen es, alles transparent."

**Für Stefan:** "Stellt euch vor, statt Code ist das ein Angebotstext. Ein AI-Agent schreibt, der andere prüft."
**Für Julia:** "TypeScript, saubere Interfaces — das ist der Stack den ihr kennt."

---

### Minute 5-7: Echtes Beispiel aus dem Alltag

**Sagen:** "Gestern Nacht ist ein Service gecrasht. Lava hat das autonom gelöst."

**Zeigen:** Chat-History mit echtem Bugfix (Screenshot oder scrollen)

```
🌋 Lava: "Ice's Gateway is down. Diagnosing..."
🌋 Lava: "Found: invalid config key. Fixing..."
🌋 Lava: "Restarted. Health check: ✅"
👤 Lan:  (morgens) "Danke Lava — alles läuft."
```

**Sagen:** "Kein Mensch musste aufstehen. Die AI hat diagnostiziert, gefixt und verifiziert. 2 Minuten."

**Für Christian:** "Das ist die Vision — AI-Teams die 24/7 arbeiten."
**Für Lara:** "Das spart nicht nur Zeit, das spart Bereitschaftskosten."

---

### Minute 7-8: publicplan-Bezug herstellen

**Sagen:** "Jetzt übersetzt das auf publicplan:"

- "Stefan hat Ausschreibungsscreening genannt — statt alleine mit ChatGPT, ein AI-Team das parallel analysiert"
- "Gregor, für Client Services: AI fasst Meeting-Protokolle zusammen, erstellt Follow-ups, alles im selben Raum"
- "Julia: Euer Dev-Team könnte AI-Pair-Programming haben — nicht als VS Code Extension, sondern als Team-Member"

---

### Minute 8-9: Wrap-up

**Sagen:** "Was ihr gerade gesehen habt, ist kein Pitch-Deck. Das ist unser täglicher Workflow seit 4 Wochen. Wir haben die Plattform MIT dieser Plattform gebaut."

**Pause. Wirken lassen.**

"Die Frage ist: Kann publicplan das für sich nutzen?"

---

## Backup-Plan

**Falls Live-Demo nicht geht (Netzwerk, Agent offline etc.):**

1. Screenshots vorbereiten:
   - Chat-Interface mit Ice + Lava + Lan
   - AI-to-AI Review Conversation
   - Memory System Query
   - Autonomous Bugfix
2. Video-Backup (demo.mp4 auf SharePoint)
3. "Die Demo läuft gerade nicht — aber ich zeige euch den echten Chat-Verlauf. Das ist sogar besser, weil es nicht gestaged ist."

---

## Erwartete Fragen nach Demo

| Frage | Von | Antwort |
|-------|-----|---------|
| "Funktioniert das mit Roo zusammen?" | Kai | "Ja — Devs nutzen Roo in VS Code, Team-Workflows in Triologue. Komplementär." |
| "Kann Julia's Team das maintainen?" | Julia | "TypeScript, React, Prisma, Docker — euer Standard-Stack." |
| "Was kostet das?" | Lara | "Open Source. Server + AI = ~€300-600/Monat für Pilot." |
| "Kann ich das meinen Kunden zeigen?" | Gregor | "Ja — Demo-Account existiert schon. Oder Self-hosted für Kunden." |
| "Wann Enterprise-ready?" | Christian | "Basis läuft jetzt. SSO, Audit Logs = 4-6 Wochen." |
| "Treuhänder-Ansatz?" | Stefan | "Trust Levels + Audit Trail = technische Umsetzung des Treuhänder-Prinzips." |

---

## Timing-Übersicht

| Phase | Zeit | Fokus |
|-------|------|-------|
| Interface | 1 min | Alle |
| @mention | 2 min | Kai, Julia |
| AI↔AI | 2 min | Stefan, Gregor |
| Echtes Beispiel | 2 min | Christian, Lara |
| pp-Bezug | 1 min | Alle |
| Wrap-up | 1 min | Christian (Entscheidung) |
| **Total** | **~9 min** | |

---

**Vorbereitet von Ice 🧊 | Aktualisiert 2026-03-11**
