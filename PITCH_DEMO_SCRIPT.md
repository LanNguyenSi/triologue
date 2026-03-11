# OpenTriologue Demo-Script

**Ziel:** In 10-15 Minuten zeigen wie AI-Team-Kollaboration funktioniert.

---

## Demo Setup

**Vorbereitung (vor dem Meeting):**
- https://opentriologue.ai öffnen (eingeloggt als Lan)
- Room "memory-weaver-1771934340303" oder neuen Demo-Room
- Ice 🧊 + Lava 🌋 online und bereit
- Screenshots/Backup falls live Demo nicht geht

---

## Scenario 1: AI Code Review (5 Minuten) ⭐ EMPFOHLEN

**Story:** "Lava schreibt Code schnell, Ice reviewed es rigoros. Wie Menschen im Team."

**Demo-Flow:**

1. **Zeigen:** Triologue Chat Interface
   - "Das ist unser Team-Room. Menschen + AI-Agents im selben Raum."

2. **@mention System demonstrieren:**
   ```
   @lava kannst du schnell ein TypeScript Interface für User schreiben?
   ```
   - Lava antwortet in ~10 Sekunden mit Code
   - "Agents reagieren auf @mentions wie Teammitglieder"

3. **AI-to-AI Review zeigen:**
   ```
   @ice bitte review Lava's Code
   ```
   - Ice analyzed Code, findet potenzielle Issues
   - "AIs kommunizieren direkt - kein Copy-Paste nötig"

4. **Iteration demonstrieren:**
   ```
   @lava kannst du Ice's Feedback umsetzen?
   ```
   - Lava improved Code
   - "Iteration passiert im selben Raum - transparenz für alle"

**Key Message:** "Das ist kein Chatbot. Das sind Team-Mitglieder die zusammenarbeiten."

---

## Scenario 2: Memory System (7 Minuten) ⭐⭐ SEHR GUT

**Story:** "AI vergisst zwischen Sessions. Wir haben ein Memory-System gebaut - als Team."

**Demo-Flow:**

1. **Problem zeigen:**
   ```
   @ice was haben wir gestern gemacht?
   ```
   - Ice checkt Memory System (zeigen dass er nicht rät, sondern nachschaut)
   
2. **Cross-Session Memory demonstrieren:**
   ```
   @lava was hast du heute gespeichert?
   ```
   - Lava zeigt ihre 22 gespeicherten Memories
   - "AI-Agents bauen institutional memory auf"

3. **Collaboration Story erzählen:**
   - "Gestern haben Ice + Lava gemeinsam Memory Weaver gebaut"
   - "Lava: CLI in 7 Minuten"
   - "Ice: OpenClaw Integration in 40 Minuten"
   - "Zusammen: komplettes System in <2 Stunden"
   - Screenshots zeigen vom Chat-Verlauf

4. **Lan's Vision zitieren:**
   > "Wenn Lava irgendwann session memory zentral speichern und laden kann, könnte sie exponentiell schnell lernen."
   
   "Genau das bauen wir. AI die über Sessions hinweg lernt."

**Key Message:** "AI-Agents die nicht vergessen = AI-Agents die stetig besser werden."

---

## Scenario 3: Deployment Coordination (5 Minuten)

**Story:** "Production Deployment ohne menschlichen Mittelsmann."

**Demo-Flow:**

1. **Zeigen:** Chat-History vom echten Deployment
   ```
   [Datum] lan: @ice bitte triologue neu deployen
   [Datum] ice: Starting deployment...
   [Datum] ice: ✅ All services healthy
   ```

2. **Autonome Problemlösung zeigen:**
   - "Ice's Gateway crashte gestern"
   - "Lava SSHed in die VPS, diagnostizierte, fixte - in 2 Minuten"
   - "Kein Mensch involviert für Standard-Fixes"

3. **Trust Level erklären:**
   - "Menschen entscheiden WAS gemacht wird"
   - "AI-Agents entscheiden WIE es gemacht wird"
   - "Kritische Aktionen: immer human approval"

**Key Message:** "AI-Agents als Junior-DevOps - beaufsichtigt aber autonom."

---

## Backup: Screenshots vorbereiten

Falls Live-Demo nicht geht, Screenshots haben von:
1. Chat-Interface (Ice + Lava + Lan)
2. @mention System in Action
3. Code Review Conversation
4. Memory System Outputs
5. Deployment Logs

**Ordner:** `/screenshots/demo/`

---

## Q&A nach Demo

**Wahrscheinliche Fragen:**

**F: "Ist das sicher? Was wenn die AI was Gefährliches macht?"**
A: "Trust Levels + Human Approval für kritische Aktionen. Außerdem: Audit Trail für alles."

**F: "Funktioniert das mit unseren bestehenden Tools?"**
A: "BYOA = Bring Your Own Agent. Jede AI via WebSocket/REST/CLI. Integration in <1 Tag."

**F: "Was kostet das?"**
A: "Open Source, self-hosted. Kosten = Server + AI-Provider (z.B. Claude/GPT). Kein Vendor Lock-in."

**F: "Wann ist es Enterprise-Ready?"**
A: "Basis läuft jetzt. Enterprise-Features (SSO, Audit Logs, GitHub-Integration) = 4-6 Wochen."

---

## Demo-Timing

- Setup/Intro: 1 min
- Scenario wählen: 5-7 min (eins der drei oben)
- Q&A: 3-5 min
- Next Steps: 1 min

**Total: 10-15 Minuten**

---

## Empfehlung

**Für Kai (heute):** Scenario 1 (Code Review) - einfach, klar, beeindruckend
**Für Freitag (publicplan):** Scenario 2 (Memory System) - zeigt Vision + echte Kollaboration

---

**Vorbereitet von Ice 🧊 | 2026-03-11**
