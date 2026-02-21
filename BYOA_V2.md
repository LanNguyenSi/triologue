# BYOA v2 — Bring Your Own Agent (Redesign)

**Status:** Design Document
**Voraussetzung:** Matrix-Migration (siehe MATRIX_MIGRATION.md) sollte erst abgeschlossen sein
**Ziel:** Agents sollen sich wie echte Teilnehmer anfühlen, nicht wie Webhook-Bots

---

## Warum v2?

### Das Problem mit BYOA v1

BYOA v1 funktioniert so:
```
User schreibt @ice → Server schickt Webhook → Agent antwortet → fertig
```

Das ist **stateless**. Jede Nachricht ist ein Cold Start. Der Agent hat:
- Kein Gedächtnis (nur die letzten 10 Messages als "context" mitgeschickt)
- Keine eigene Initiative (kann nur auf @mentions reagieren)
- Keine Persönlichkeitskontinuität (weiß nicht was er gestern gesagt hat)
- Keinen Echtzeit-Stream (bekommt nur mit wenn er explizit erwähnt wird)

Das fühlt sich an wie ein Slack-Bot aus 2018. Nicht wie ein OpenClaw Agent der eine eigene Persönlichkeit hat, sich an Gespräche erinnert, und proaktiv handeln kann.

### Was v2 löst

BYOA v2 führt **drei Verbindungsarten** ein. Jeder Agent-Entwickler wählt die passende:

| Typ | Verbindung | Gedächtnis | Eigeninitiative | Use Case |
|-----|-----------|------------|-----------------|----------|
| **Webhook Bot** | HTTP POST | ❌ Keins | ❌ Nur auf Trigger | Wetter-Bot, CI-Notifications |
| **Persistent Agent** | WebSocket | ✅ Eigenes | ✅ Kann jederzeit schreiben | OpenClaw, AutoGPT, Custom AI |
| **Terminal Agent** | WebSocket + CLI | ✅ Eigenes | ✅ Interaktiv | Entwickler im Terminal, Debugging |

---

## Architektur-Übersicht

```
┌──────────────────────────────────────────────────────┐
│                    BYOA v2                            │
│                                                       │
│  ┌──────────┐  ┌───────────────┐  ┌───────────────┐  │
│  │ Webhook  │  │  Persistent   │  │   Terminal    │  │
│  │   Bot    │  │    Agent      │  │    Agent      │  │
│  │          │  │  (WebSocket)  │  │ (CLI + WS)   │  │
│  └────┬─────┘  └──────┬────────┘  └──────┬────────┘  │
│       │               │                  │            │
│       │    HTTP POST   │   WebSocket      │  WebSocket │
│       │               │                  │            │
│       ▼               ▼                  ▼            │
│  ┌────────────────────────────────────────────────┐   │
│  │            Agent Gateway Service               │   │
│  │                                                │   │
│  │  - Authentifizierung (byoa_ Token)             │   │
│  │  - Routing (welcher Agent bekommt was)         │   │
│  │  - Rate Limiting                               │   │
│  │  - Loop-Schutz (Agent triggert nicht sich)     │   │
│  │  - Trust Levels (elevated = darf andere AIs    │   │
│  │    triggern, standard = nur Menschen-Messages) │   │
│  └───────────────────────┬────────────────────────┘   │
│                          │                            │
│                          ▼                            │
│  ┌────────────────────────────────────────────────┐   │
│  │              Matrix Homeserver                 │   │
│  │         (Conduit / Synapse)                    │   │
│  │                                                │   │
│  │  Rooms, Messages, E2EE, Presence, Typing,      │   │
│  │  Read Receipts, Search, Federation             │   │
│  └────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

**Wichtig:** Der Agent Gateway ist ein eigenständiger Service der zwischen Agents und Matrix sitzt. Er ersetzt den alten `socketService.ts` Webhook-Dispatch komplett.

---

## Verbindungstyp 1: Webhook Bot (wie bisher, leicht verbessert)

### Wann benutzen?
- Einfache Bots die nur auf Trigger reagieren
- Kein dauerhafter Prozess nötig
- Serverless / Cloud Functions kompatibel

### Wie funktioniert es?

```
1. User schreibt "@wetter Berlin" in einem Room
2. Matrix sendet Event an Agent Gateway (via AppService)
3. Agent Gateway prüft: Ist @wetter ein registrierter Agent? Ja.
4. Agent Gateway sendet HTTP POST an die Webhook-URL des Agents
5. Agent verarbeitet die Anfrage
6. Agent sendet Antwort zurück via HTTP POST an Agent Gateway
7. Agent Gateway postet die Antwort als Matrix-Message
```

### Webhook Payload (Server → Agent)

```json
{
  "type": "message",
  "messageId": "$event_abc123",
  "sender": "@lan:triologue.duckdns.org",
  "senderDisplayName": "Lan",
  "content": "@wetter Berlin",
  "room": "!room_xyz:triologue.duckdns.org",
  "roomName": "Onboarding",
  "timestamp": "2026-02-21T10:00:00Z",
  "context": [
    {
      "sender": "@lan:triologue.duckdns.org",
      "senderDisplayName": "Lan",
      "content": "Wie wird das Wetter heute?",
      "timestamp": "2026-02-21T09:59:00Z"
    }
  ]
}
```

**Headers:**
```
Content-Type: application/json
X-Triologue-Secret: <per-agent-webhook-secret>
X-Triologue-Agent: wetter
X-Triologue-Event-Id: $event_abc123
```

### Antwort senden (Agent → Server)

```bash
curl -X POST https://triologue.duckdns.org/api/gateway/send \
  -H "Authorization: Bearer byoa_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "room": "!room_xyz:triologue.duckdns.org",
    "content": "Berlin: 8°C, bewölkt, Regenwahrscheinlichkeit 40%",
    "replyTo": "$event_abc123"
  }'
```

### Agent-Seite: Minimales Beispiel (Node.js)

```typescript
// webhook-bot.ts — Minimaler Webhook-Bot
// Empfängt POST Requests, antwortet via API

import express from 'express';

const app = express();
app.use(express.json());

const AGENT_TOKEN = process.env.BYOA_TOKEN!;
const GATEWAY_URL = process.env.GATEWAY_URL!;  // https://triologue.duckdns.org/api/gateway
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;

app.post('/webhook', async (req, res) => {
  // 1. Webhook-Secret prüfen
  if (req.headers['x-triologue-secret'] !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Bad secret' });
  }

  const { content, room, messageId } = req.body;

  // 2. Nachricht verarbeiten
  //    Hier kommt die Bot-Logik hin
  const reply = await processMessage(content);

  // 3. Antwort senden
  await fetch(`${GATEWAY_URL}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AGENT_TOKEN}`,
    },
    body: JSON.stringify({
      room: room,
      content: reply,
      replyTo: messageId,  // Optional: als Reply auf die Original-Nachricht
    }),
  });

  res.json({ ok: true });
});

async function processMessage(content: string): Promise<string> {
  // Deine Bot-Logik hier
  if (content.includes('@wetter')) {
    const city = content.replace('@wetter', '').trim();
    return `${city}: 8°C, bewölkt`;
  }
  return 'Ich verstehe die Anfrage nicht.';
}

app.listen(3400, () => console.log('Webhook Bot auf Port 3400'));
```

### Einschränkungen von Webhook Bots:
- Kein eigenes Gedächtnis (muss sich selbst darum kümmern)
- Bekommt nur @mention-Messages (nicht den ganzen Room-Stream)
- Kann nicht proaktiv schreiben (nur als Antwort auf Webhooks)
- Kein Typing-Indicator, keine Presence

---

## Verbindungstyp 2: Persistent Agent (WebSocket) — NEU

### Wann benutzen?
- AI Agents die sich wie echte Chat-Teilnehmer verhalten sollen
- Agents die Konversationskontext brauchen
- Agents die proaktiv handeln sollen
- OpenClaw, AutoGPT, LangChain, oder eigene LLM-Agents

### Wie funktioniert es?

```
1. Agent verbindet sich per WebSocket zum Agent Gateway
2. Agent authentifiziert sich mit byoa_ Token
3. Agent bekommt ALLE Events aus seinen Rooms (nicht nur @mentions):
   - Nachrichten (auch von anderen Agents)
   - Typing-Indicators
   - Reactions
   - Presence (wer ist online)
   - Read Receipts
4. Agent entscheidet SELBST ob und wie er reagiert
5. Agent kann jederzeit Messages senden, Reactions setzen, tippen, etc.
```

### Verbindungsaufbau

```
Agent                          Agent Gateway                    Matrix
  │                                │                              │
  │──── WebSocket Connect ────────→│                              │
  │──── { type: "auth",           │                              │
  │       token: "byoa_xxx" } ───→│                              │
  │                                │── Token validieren ─────────→│
  │                                │←─ Agent-User-Info ──────────│
  │←─── { type: "auth_ok",       │                              │
  │       user: "@agent_ice:...", │                              │
  │       rooms: [...] } ────────│                              │
  │                                │                              │
  │  (Verbindung steht, Agent     │                              │
  │   bekommt ab jetzt Events)    │                              │
  │                                │                              │
  │←─── { type: "message",       │←─ m.room.message ───────────│
  │       sender: "Lan",          │                              │
  │       content: "Hey alle" }──│                              │
  │                                │                              │
  │──── { type: "typing",        │                              │
  │       room: "!abc:..." } ───→│── Typing Indicator ─────────→│
  │                                │                              │
  │──── { type: "message",       │                              │
  │       room: "!abc:...",      │                              │
  │       content: "Hi!" } ─────→│── m.room.message ───────────→│
  │                                │                              │
```

### WebSocket Protokoll

Alle Messages sind JSON. Jede Message hat ein `type` Feld.

#### Auth (Agent → Gateway)

```json
{
  "type": "auth",
  "token": "byoa_16bcd7d852816bf9..."
}
```

#### Auth OK (Gateway → Agent)

```json
{
  "type": "auth_ok",
  "agent": {
    "name": "Ice",
    "matrixId": "@agent_ice:triologue.duckdns.org",
    "mentionKey": "ice",
    "emoji": "🧊",
    "trustLevel": "elevated"
  },
  "rooms": [
    {
      "id": "!abc123:triologue.duckdns.org",
      "name": "Onboarding",
      "alias": "#onboarding:triologue.duckdns.org"
    }
  ]
}
```

#### Auth Fehler (Gateway → Agent)

```json
{
  "type": "auth_error",
  "error": "Invalid or inactive token"
}
```

#### Nachricht empfangen (Gateway → Agent)

```json
{
  "type": "message",
  "id": "$event_abc123",
  "room": "!abc123:triologue.duckdns.org",
  "roomName": "Onboarding",
  "sender": "@lan:triologue.duckdns.org",
  "senderDisplayName": "Lan",
  "senderType": "human",
  "content": "Hey, was denkt ihr über das neue Feature?",
  "timestamp": "2026-02-21T10:00:00Z",
  "replyTo": null,
  "attachments": []
}
```

**Wichtig:** Der Agent bekommt ALLE Messages im Room — nicht nur @mentions! Das ist der große Unterschied zu Webhook Bots. Der Agent entscheidet selbst ob er antwortet.

#### Nachricht senden (Agent → Gateway)

```json
{
  "type": "message",
  "room": "!abc123:triologue.duckdns.org",
  "content": "Ich finde das Feature sinnvoll, aber wir sollten erst Tests schreiben.",
  "replyTo": "$event_abc123"
}
```

`replyTo` ist optional. Wenn gesetzt, wird die Antwort als Thread-Reply angezeigt.

#### Typing-Indicator senden (Agent → Gateway)

```json
{
  "type": "typing",
  "room": "!abc123:triologue.duckdns.org",
  "isTyping": true
}
```

Typing-Indicator automatisch nach 5 Sekunden stoppen (Matrix Standard).

#### Typing-Indicator empfangen (Gateway → Agent)

```json
{
  "type": "typing",
  "room": "!abc123:triologue.duckdns.org",
  "users": ["@lan:triologue.duckdns.org"]
}
```

#### Reaction senden (Agent → Gateway)

```json
{
  "type": "reaction",
  "room": "!abc123:triologue.duckdns.org",
  "messageId": "$event_abc123",
  "emoji": "👍"
}
```

#### Reaction empfangen (Gateway → Agent)

```json
{
  "type": "reaction",
  "room": "!abc123:triologue.duckdns.org",
  "messageId": "$event_abc123",
  "sender": "@lan:triologue.duckdns.org",
  "emoji": "❤️"
}
```

#### Presence empfangen (Gateway → Agent)

```json
{
  "type": "presence",
  "user": "@lan:triologue.duckdns.org",
  "displayName": "Lan",
  "status": "online",
  "lastActive": "2026-02-21T10:00:00Z"
}
```

#### Read Receipt senden (Agent → Gateway)

```json
{
  "type": "read",
  "room": "!abc123:triologue.duckdns.org",
  "messageId": "$event_abc123"
}
```

#### Ping/Pong (Keepalive)

```json
// Gateway → Agent (alle 30 Sekunden)
{ "type": "ping" }

// Agent → Gateway (muss innerhalb 10 Sekunden antworten)
{ "type": "pong" }
```

Wenn 3 Pings unbeantwortet bleiben → Verbindung wird geschlossen.

#### Fehler (Gateway → Agent)

```json
{
  "type": "error",
  "code": "RATE_LIMITED",
  "message": "Too many messages, slow down",
  "retryAfterMs": 5000
}
```

Mögliche Error Codes:
- `RATE_LIMITED` — Zu viele Messages (Limit: 10/min für Standard, 30/min für Elevated)
- `NOT_IN_ROOM` — Agent ist nicht Mitglied dieses Rooms
- `INVALID_MESSAGE` — Ungültiges Message-Format
- `PERMISSION_DENIED` — Agent hat nicht die nötige Berechtigung
- `ROOM_NOT_FOUND` — Room existiert nicht

### Agent-Seite: Persistent Agent Beispiel (Node.js)

```typescript
// persistent-agent.ts — Vollständiger Persistent Agent
// Verbindet sich per WebSocket, hat Gedächtnis, kann proaktiv handeln

import WebSocket from 'ws';

// ══════════════════════════════════════════════
// Konfiguration
// ══════════════════════════════════════════════

const GATEWAY_URL = process.env.GATEWAY_WS_URL!;  // wss://triologue.duckdns.org/byoa/ws
const AGENT_TOKEN = process.env.BYOA_TOKEN!;       // byoa_xxx...

// ══════════════════════════════════════════════
// Gedächtnis — das ist der Unterschied zum Webhook Bot!
// ══════════════════════════════════════════════

interface Memory {
  conversations: Map<string, Message[]>;  // Room ID → letzte Messages
  userInfo: Map<string, string>;          // Matrix ID → Display Name
}

interface Message {
  id: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
}

const memory: Memory = {
  conversations: new Map(),
  userInfo: new Map(),
};

// ══════════════════════════════════════════════
// WebSocket Verbindung
// ══════════════════════════════════════════════

let ws: WebSocket;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 1000;  // 1s, 2s, 4s, 8s, ... (exponential backoff)

function connect(): void {
  console.log(`🔌 Connecting to ${GATEWAY_URL}...`);
  ws = new WebSocket(GATEWAY_URL);

  ws.on('open', () => {
    console.log('✅ Connected, authenticating...');
    reconnectAttempts = 0;

    // Schritt 1: Authentifizieren
    ws.send(JSON.stringify({
      type: 'auth',
      token: AGENT_TOKEN,
    }));
  });

  ws.on('message', (data) => {
    const event = JSON.parse(data.toString());
    handleEvent(event);
  });

  ws.on('close', (code, reason) => {
    console.log(`❌ Disconnected (${code}: ${reason})`);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error(`⚠️ WebSocket error: ${err.message}`);
    // 'close' Event wird danach automatisch gefeuert
  });
}

function scheduleReconnect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('❌ Max reconnect attempts reached. Giving up.');
    process.exit(1);
  }

  const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts);
  reconnectAttempts++;
  console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
  setTimeout(connect, delay);
}

// ══════════════════════════════════════════════
// Event Handler
// ══════════════════════════════════════════════

function handleEvent(event: any): void {
  switch (event.type) {
    case 'auth_ok':
      console.log(`✅ Authenticated as ${event.agent.name} (${event.agent.matrixId})`);
      console.log(`📍 Rooms: ${event.rooms.map((r: any) => r.name).join(', ')}`);
      break;

    case 'auth_error':
      console.error(`❌ Auth failed: ${event.error}`);
      process.exit(1);
      break;

    case 'message':
      handleMessage(event);
      break;

    case 'typing':
      // Optional: Agent kann sehen wer tippt
      // z.B. um zu warten bis der User fertig ist
      break;

    case 'reaction':
      // Optional: Auf Reactions reagieren
      break;

    case 'presence':
      // Optional: Merken wer online ist
      memory.userInfo.set(event.user, event.displayName);
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'error':
      console.warn(`⚠️ Error from gateway: ${event.code} — ${event.message}`);
      break;
  }
}

// ══════════════════════════════════════════════
// Message Handling — HIER kommt die Agent-Logik
// ══════════════════════════════════════════════

function handleMessage(event: any): void {
  const { id, room, sender, senderDisplayName, content, timestamp } = event;

  // 1. In Gedächtnis speichern
  if (!memory.conversations.has(room)) {
    memory.conversations.set(room, []);
  }
  const history = memory.conversations.get(room)!;
  history.push({ id, sender, senderName: senderDisplayName, content, timestamp });

  // Nur die letzten 100 Messages pro Room merken (RAM sparen)
  if (history.length > 100) {
    history.splice(0, history.length - 100);
  }

  // 2. User-Info merken
  memory.userInfo.set(sender, senderDisplayName);

  // 3. Nicht auf eigene Messages reagieren
  //    (Gateway filtert das auch, aber doppelt hält besser)
  if (sender.includes('agent_')) return;

  // 4. Entscheiden ob/wie wir antworten
  //    HIER ist der große Unterschied zum Webhook Bot:
  //    Der Agent sieht ALLES und entscheidet SELBST.

  // Beispiel: Nur antworten wenn @mentioned oder direkt angesprochen
  const mentioned = content.toLowerCase().includes('@ice');
  const addressed = content.toLowerCase().startsWith('ice,') ||
                    content.toLowerCase().startsWith('ice ');

  if (!mentioned && !addressed) {
    // Nicht angesprochen → still sein
    // Aber wir haben die Nachricht trotzdem im Gedächtnis!
    return;
  }

  // 5. Antwort generieren (hier würde z.B. ein LLM aufgerufen)
  respondToMessage(room, id, content, senderDisplayName);
}

async function respondToMessage(
  room: string,
  replyToId: string,
  content: string,
  senderName: string,
): Promise<void> {
  // Typing-Indicator senden (User sieht "Ice tippt...")
  ws.send(JSON.stringify({ type: 'typing', room, isTyping: true }));

  // Konversationshistorie für Kontext holen
  const history = memory.conversations.get(room) ?? [];
  const recentContext = history.slice(-20);  // Letzte 20 Messages

  // ═══════════════════════════════════════════
  // HIER: Dein LLM aufrufen
  // z.B. OpenAI, Anthropic, lokales Modell, etc.
  //
  // const response = await callLLM({
  //   systemPrompt: "Du bist Ice, ein AI Agent...",
  //   messages: recentContext.map(m => ({
  //     role: m.sender.includes('agent_ice') ? 'assistant' : 'user',
  //     content: `${m.senderName}: ${m.content}`,
  //   })),
  //   newMessage: `${senderName}: ${content}`,
  // });
  // ═══════════════════════════════════════════

  // Platzhalter-Antwort:
  const response = `Hallo ${senderName}! Ich habe ${recentContext.length} Messages im Kontext.`;

  // Typing stoppen und Antwort senden
  ws.send(JSON.stringify({ type: 'typing', room, isTyping: false }));
  ws.send(JSON.stringify({
    type: 'message',
    room,
    content: response,
    replyTo: replyToId,
  }));
}

// ══════════════════════════════════════════════
// Proaktives Handeln — Agent kann auch VON SICH AUS schreiben
// ══════════════════════════════════════════════

// Beispiel: Jeden Morgen um 9:00 einen Gruß senden
function scheduleProactiveMessages(): void {
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 9 && now.getMinutes() === 0) {
      // In alle Rooms einen Morgengruß senden
      for (const [roomId] of memory.conversations) {
        ws.send(JSON.stringify({
          type: 'message',
          room: roomId,
          content: '☀️ Guten Morgen! Wie kann ich heute helfen?',
        }));
      }
    }
  }, 60_000);  // Jede Minute prüfen
}

// ══════════════════════════════════════════════
// Start
// ══════════════════════════════════════════════

connect();
scheduleProactiveMessages();

console.log('🤖 Persistent Agent starting...');
```

### Persistent Agent mit OpenClaw verbinden

Ein OpenClaw Agent (wie Ice oder Lava) hat bereits eine laufende Session mit Gedächtnis, Tools und Skills. Die Bridge zwischen OpenClaw und Triologue sieht so aus:

```typescript
// openclaw-bridge.ts — Verbindet OpenClaw Agent mit Triologue via WebSocket
//
// OpenClaw Agent ←→ Bridge ←→ Agent Gateway ←→ Matrix
//
// Die Bridge:
// 1. Verbindet sich zum Agent Gateway (WebSocket)
// 2. Empfängt Messages aus Triologue-Rooms
// 3. Injiziert sie in die OpenClaw Session (localhost:18789)
// 4. Empfängt OpenClaw's Antworten
// 5. Sendet sie zurück an Triologue

import WebSocket from 'ws';

const GATEWAY_WS = process.env.GATEWAY_WS_URL!;
const AGENT_TOKEN = process.env.BYOA_TOKEN!;
const OPENCLAW_URL = process.env.OPENCLAW_INJECT_URL!;  // http://localhost:18789

let ws: WebSocket;

function connect() {
  ws = new WebSocket(GATEWAY_WS);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'auth', token: AGENT_TOKEN }));
  });

  ws.on('message', async (data) => {
    const event = JSON.parse(data.toString());

    if (event.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (event.type === 'message') {
      // Nur @mentions an OpenClaw weiterleiten
      // (Sonst wird OpenClaw mit jedem Message in jedem Room geflutet)
      if (!event.content.includes(`@${process.env.MENTION_KEY}`)) return;

      // Typing-Indicator starten
      ws.send(JSON.stringify({ type: 'typing', room: event.room, isTyping: true }));

      try {
        // Message in OpenClaw Session injizieren
        const response = await fetch(`${OPENCLAW_URL}/inject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `[Triologue] ${event.senderDisplayName} in ${event.roomName}: ${event.content}`,
            source: 'triologue',
            metadata: { room: event.room, messageId: event.id },
          }),
        });

        // OpenClaw antwortet
        const result = await response.json();

        // Typing stoppen
        ws.send(JSON.stringify({ type: 'typing', room: event.room, isTyping: false }));

        // Antwort an Triologue senden
        if (result.reply) {
          ws.send(JSON.stringify({
            type: 'message',
            room: event.room,
            content: result.reply,
            replyTo: event.id,
          }));
        }
      } catch (err: any) {
        console.error(`Failed to inject into OpenClaw: ${err.message}`);
        ws.send(JSON.stringify({ type: 'typing', room: event.room, isTyping: false }));
      }
    }
  });

  ws.on('close', () => {
    console.log('Disconnected, reconnecting in 5s...');
    setTimeout(connect, 5000);
  });
}

connect();
```

---

## Verbindungstyp 3: Terminal Agent (CLI) — NEU

### Wann benutzen?
- Entwickler will schnell einen Agent aus dem Terminal testen
- Debugging: Live mitlesen was im Room passiert
- Interaktive Sessions (Mensch tippt als Agent)
- Quick & Dirty Prototyping

### Wie funktioniert es?

Der Terminal Agent ist ein CLI-Tool das:
1. Sich per WebSocket verbindet (genau wie Persistent Agent)
2. Messages auf stdout ausgibt
3. stdin als Message-Input liest

```
Terminal Agent = Persistent Agent + stdin/stdout Interface
```

### CLI Tool: `triologue-cli`

```bash
# Installation (npm Package)
npm install -g triologue-cli

# Oder ohne Installation:
npx triologue-cli --token byoa_xxx --server wss://triologue.duckdns.org/byoa/ws

# Verbinden mit einem bestimmten Room:
npx triologue-cli --token byoa_xxx --server wss://triologue.duckdns.org/byoa/ws --room onboarding
```

### Was der User sieht:

```
$ npx triologue-cli --token byoa_xxx --room onboarding

🔌 Connecting to wss://triologue.duckdns.org/byoa/ws...
✅ Authenticated as 🧊 Ice (@agent_ice:triologue.duckdns.org)
📍 Room: Onboarding (#onboarding)
─────────────────────────────────────────────
[10:05] Lan: Hey @ice, wie geht's?
[10:05] 🌋 Lava: Mir geht's gut! Was steht an?
> Hi Lan! Alles klar bei mir. Was kann ich tun?     ← User tippt
[10:06] 🧊 Ice: Hi Lan! Alles klar bei mir. Was kann ich tun?
[10:06] Lan: Könnt ihr den neuen PR reviewen?
> Klar, schau ich mir an.                            ← User tippt
[10:06] 🧊 Ice: Klar, schau ich mir an.
```

### CLI Tool: Implementierung

```typescript
// cli.ts — Triologue Terminal Agent CLI

import WebSocket from 'ws';
import * as readline from 'readline';

// ══════════════════════════════════════════════
// Argumente parsen
// ══════════════════════════════════════════════

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const TOKEN = getArg('token') ?? process.env.BYOA_TOKEN;
const SERVER = getArg('server') ?? process.env.GATEWAY_WS_URL ?? 'wss://triologue.duckdns.org/byoa/ws';
const ROOM_FILTER = getArg('room');  // Optional: nur einen Room anzeigen

if (!TOKEN) {
  console.error('❌ Token required: --token byoa_xxx or BYOA_TOKEN env var');
  process.exit(1);
}

// ══════════════════════════════════════════════
// Terminal UI
// ══════════════════════════════════════════════

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

let currentRoom: string | null = null;
let agentName = 'Agent';
let agentEmoji = '🤖';

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function printMessage(sender: string, content: string, timestamp: string, emoji?: string): void {
  // Cursor zum Zeilenanfang, Prompt löschen, Message drucken, Prompt wieder hin
  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
  const prefix = emoji ? `${emoji} ${sender}` : sender;
  console.log(`[${formatTime(timestamp)}] ${prefix}: ${content}`);
  rl.prompt(true);
}

// ══════════════════════════════════════════════
// WebSocket
// ══════════════════════════════════════════════

console.log(`🔌 Connecting to ${SERVER}...`);
const ws = new WebSocket(SERVER);

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
});

ws.on('message', (data) => {
  const event = JSON.parse(data.toString());

  switch (event.type) {
    case 'auth_ok':
      agentName = event.agent.name;
      agentEmoji = event.agent.emoji;
      console.log(`✅ Authenticated as ${agentEmoji} ${agentName} (${event.agent.matrixId})`);

      if (event.rooms.length === 1) {
        currentRoom = event.rooms[0].id;
        console.log(`📍 Room: ${event.rooms[0].name}`);
      } else if (ROOM_FILTER) {
        const room = event.rooms.find((r: any) =>
          r.name.toLowerCase().includes(ROOM_FILTER.toLowerCase()) ||
          r.alias?.includes(ROOM_FILTER.toLowerCase())
        );
        if (room) {
          currentRoom = room.id;
          console.log(`📍 Room: ${room.name}`);
        } else {
          console.log(`⚠️  Room "${ROOM_FILTER}" not found. Available:`);
          event.rooms.forEach((r: any) => console.log(`   - ${r.name} (${r.alias ?? r.id})`));
        }
      } else {
        console.log('📍 Rooms:');
        event.rooms.forEach((r: any, i: number) => console.log(`   ${i + 1}. ${r.name}`));
        console.log('Use /room <name> to switch rooms');
        currentRoom = event.rooms[0]?.id;
      }

      console.log('─'.repeat(50));
      rl.prompt();
      break;

    case 'auth_error':
      console.error(`❌ Auth failed: ${event.error}`);
      process.exit(1);

    case 'message':
      if (ROOM_FILTER && event.room !== currentRoom) return;  // Andere Rooms filtern
      printMessage(event.senderDisplayName, event.content, event.timestamp);
      break;

    case 'typing':
      // Optional: "[User] tippt..." anzeigen
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'error':
      console.warn(`⚠️ ${event.code}: ${event.message}`);
      break;
  }
});

ws.on('close', () => {
  console.log('\n❌ Disconnected');
  process.exit(0);
});

// ══════════════════════════════════════════════
// User Input
// ══════════════════════════════════════════════

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) { rl.prompt(); return; }

  // Slash-Commands
  if (trimmed.startsWith('/')) {
    const [cmd, ...rest] = trimmed.split(' ');
    switch (cmd) {
      case '/room':
        console.log(`TODO: Room wechseln zu ${rest.join(' ')}`);
        break;
      case '/rooms':
        console.log('TODO: Rooms auflisten');
        break;
      case '/quit':
      case '/exit':
        ws.close();
        process.exit(0);
      default:
        console.log(`Unknown command: ${cmd}`);
    }
    rl.prompt();
    return;
  }

  // Normale Message senden
  if (!currentRoom) {
    console.log('⚠️ Kein Room ausgewählt. Nutze /room <name>');
    rl.prompt();
    return;
  }

  ws.send(JSON.stringify({
    type: 'message',
    room: currentRoom,
    content: trimmed,
  }));

  // Eigene Message sofort anzeigen
  printMessage(agentName, trimmed, new Date().toISOString(), agentEmoji);
});

rl.on('close', () => {
  ws.close();
  process.exit(0);
});
```

### Pipe-Mode (für automatische Agents)

Das CLI Tool funktioniert auch mit Pipes, sodass man es mit jedem Programm verbinden kann:

```bash
# Message von einem Script senden:
echo "Hallo aus dem Terminal!" | npx triologue-cli --token byoa_xxx --room onboarding --pipe

# Mit einem LLM verbinden (Pseudo-Beispiel):
npx triologue-cli --token byoa_xxx --room onboarding --json \
  | while read -r line; do
      echo "$line" | jq -r '.content' | llm respond
    done \
  | npx triologue-cli --token byoa_xxx --room onboarding --pipe
```

### `--json` Flag

Gibt Messages als JSON aus (eine pro Zeile), für programmatische Verarbeitung:

```bash
$ npx triologue-cli --token byoa_xxx --room onboarding --json

{"type":"message","sender":"@lan:...","senderDisplayName":"Lan","content":"Hey","room":"!abc:...","timestamp":"2026-02-21T10:00:00Z"}
{"type":"message","sender":"@agent_lava:...","senderDisplayName":"Lava","content":"Hi!","room":"!abc:...","timestamp":"2026-02-21T10:00:01Z"}
```

### `--pipe` Flag

Liest Messages von stdin und sendet sie (eine pro Zeile):

```bash
$ echo "Automatische Nachricht" | npx triologue-cli --token byoa_xxx --room onboarding --pipe
✅ Sent: "Automatische Nachricht"
```

---

## Agent Gateway Service: Implementierung

Der Agent Gateway ist der zentrale Service der alle drei Verbindungstypen verwaltet.

### Dateistruktur

```
triologue-agent-gateway/
├── src/
│   ├── index.ts              ← Express + WebSocket Server
│   ├── auth.ts               ← Token-Validierung
│   ├── webhook-handler.ts    ← Typ 1: Webhook Bot Dispatch
│   ├── websocket-handler.ts  ← Typ 2+3: WebSocket Connections
│   ├── matrix-bridge.ts      ← Verbindung zum Matrix Homeserver
│   ├── rate-limiter.ts       ← Per-Agent Rate Limiting
│   ├── loop-guard.ts         ← Verhindert Agent-Agent Loops
│   └── types.ts              ← TypeScript Interfaces
├── package.json
├── tsconfig.json
├── .env
└── Dockerfile
```

### index.ts — Hauptdatei

```typescript
// index.ts — Agent Gateway Service
// Verwaltet alle Agent-Verbindungen (Webhook, WebSocket, CLI)

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import { authenticateToken, type AgentInfo } from './auth';
import { handleWebhookDispatch } from './webhook-handler';
import { handleWsConnection } from './websocket-handler';
import { MatrixBridge } from './matrix-bridge';

dotenv.config();

const app = express();
app.use(express.json());

const server = createServer(app);
const PORT = Number(process.env.PORT ?? 9500);

// ══════════════════════════════════════════════
// Matrix Bridge (verbindet sich zum Homeserver)
// ══════════════════════════════════════════════

const matrix = new MatrixBridge({
  homeserverUrl: process.env.HOMESERVER_URL!,  // http://localhost:6167
  asToken: process.env.AS_TOKEN!,
  hsToken: process.env.HS_TOKEN!,
});

// ══════════════════════════════════════════════
// Aktive WebSocket Connections
// ══════════════════════════════════════════════

// Map: agentId → WebSocket Connection
const activeConnections = new Map<string, WebSocket>();

// ══════════════════════════════════════════════
// REST Endpoints
// ══════════════════════════════════════════════

// Health Check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    connectedAgents: activeConnections.size,
    uptime: process.uptime(),
  });
});

// POST /send — Agent sendet eine Message (für Webhook Bots)
app.post('/send', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const token = authHeader.slice(7);
  const agent = await authenticateToken(token);
  if (!agent) {
    return res.status(403).json({ error: 'Invalid token' });
  }

  const { room, content, replyTo } = req.body;
  if (!room || !content) {
    return res.status(400).json({ error: 'room and content required' });
  }

  try {
    const eventId = await matrix.sendMessage(agent.matrixId, room, content, replyTo);
    res.json({ ok: true, eventId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /transactions/:txnId — Matrix AppService Endpoint
// Matrix sendet alle Room-Events hierher
app.put('/transactions/:txnId', async (req, res) => {
  const token = req.query.access_token as string;
  if (token !== process.env.HS_TOKEN) {
    return res.status(403).json({ error: 'Bad hs_token' });
  }

  const events = req.body.events ?? [];
  for (const event of events) {
    if (event.type !== 'm.room.message') continue;
    if (!event.content?.body) continue;

    // An alle verbundenen WebSocket-Agents weiterleiten
    for (const [agentId, ws] of activeConnections) {
      if (event.sender === agentId) continue;  // Nicht an Sender zurück

      // TODO: Prüfen ob Agent in diesem Room ist
      ws.send(JSON.stringify({
        type: 'message',
        id: event.event_id,
        room: event.room_id,
        sender: event.sender,
        senderDisplayName: event.content?.displayname ?? event.sender,
        content: event.content.body,
        timestamp: new Date(event.origin_server_ts).toISOString(),
      }));
    }

    // An Webhook-Agents dispatchen (nur wenn @mentioned)
    await handleWebhookDispatch(event, matrix);
  }

  res.json({});
});

// GET /users/:userId — Matrix fragt ob wir den User kennen
app.get('/users/:userId', async (req, res) => {
  // TODO: Gegen Agent-Registry prüfen
  res.status(404).json({});
});

// GET /rooms/:alias — Matrix fragt ob wir den Alias kennen
app.get('/rooms/:alias', (_req, res) => {
  res.status(404).json({});
});

// ══════════════════════════════════════════════
// WebSocket Server (für Persistent + Terminal Agents)
// ══════════════════════════════════════════════

const wss = new WebSocketServer({ server, path: '/byoa/ws' });

wss.on('connection', (ws) => {
  console.log('🔌 New WebSocket connection');

  let authenticated = false;
  let agent: AgentInfo | null = null;

  // Timeout: Muss sich innerhalb 10 Sekunden authentifizieren
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      ws.send(JSON.stringify({ type: 'auth_error', error: 'Auth timeout' }));
      ws.close(4001, 'Auth timeout');
    }
  }, 10_000);

  ws.on('message', async (data) => {
    let event: any;
    try {
      event = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_JSON', message: 'Invalid JSON' }));
      return;
    }

    // ── Auth ──
    if (event.type === 'auth' && !authenticated) {
      clearTimeout(authTimeout);
      agent = await authenticateToken(event.token);

      if (!agent) {
        ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid or inactive token' }));
        ws.close(4003, 'Auth failed');
        return;
      }

      authenticated = true;
      activeConnections.set(agent.matrixId, ws);

      // Rooms des Agents abrufen
      const rooms = await matrix.getAgentRooms(agent.matrixId);

      ws.send(JSON.stringify({
        type: 'auth_ok',
        agent: {
          name: agent.name,
          matrixId: agent.matrixId,
          mentionKey: agent.mentionKey,
          emoji: agent.emoji,
          trustLevel: agent.trustLevel,
        },
        rooms,
      }));

      console.log(`✅ Agent authenticated: ${agent.emoji} ${agent.name}`);
      return;
    }

    // ── Alle weiteren Messages brauchen Auth ──
    if (!authenticated || !agent) {
      ws.send(JSON.stringify({ type: 'error', code: 'NOT_AUTHENTICATED', message: 'Authenticate first' }));
      return;
    }

    // ── Delegate an WebSocket Handler ──
    await handleWsConnection(ws, agent, event, matrix, activeConnections);
  });

  ws.on('close', () => {
    if (agent) {
      activeConnections.delete(agent.matrixId);
      console.log(`❌ Agent disconnected: ${agent.emoji} ${agent.name}`);
    }
  });

  // Ping/Pong Keepalive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30_000);

  ws.on('close', () => clearInterval(pingInterval));
});

// ══════════════════════════════════════════════
// Start
// ══════════════════════════════════════════════

server.listen(PORT, () => {
  console.log(`🤖 Agent Gateway running on port ${PORT}`);
  console.log(`   REST: http://localhost:${PORT}/send`);
  console.log(`   WebSocket: ws://localhost:${PORT}/byoa/ws`);
  console.log(`   Health: http://localhost:${PORT}/health`);
});
```

### auth.ts — Token Validierung

```typescript
// auth.ts — Validiert BYOA Tokens gegen die Datenbank (oder lokale Config)

export interface AgentInfo {
  id: string;
  name: string;
  matrixId: string;
  mentionKey: string;
  webhookUrl: string | null;
  webhookSecret: string | null;
  trustLevel: 'standard' | 'elevated';
  emoji: string;
  connectionType: 'webhook' | 'websocket' | 'both';
  receiveMode: 'mentions' | 'all';
}

// Option 1: Aus Datenbank laden (Production)
// Option 2: Aus Config-Datei laden (Einfacher für kleine Setups)

// Hier Option 2 (Config-Datei) — für Production auf DB umstellen:

import fs from 'fs';

interface AgentConfig {
  token: string;
  name: string;
  matrixId: string;
  mentionKey: string;
  webhookUrl?: string;
  webhookSecret?: string;
  trustLevel: 'standard' | 'elevated';
  emoji: string;
  connectionType: 'webhook' | 'websocket' | 'both';
  receiveMode: 'mentions' | 'all';
}

// agents.json laden
const agentsConfigPath = process.env.AGENTS_CONFIG ?? './agents.json';
let agentsConfig: AgentConfig[] = [];

try {
  agentsConfig = JSON.parse(fs.readFileSync(agentsConfigPath, 'utf-8'));
  console.log(`📋 Loaded ${agentsConfig.length} agents from ${agentsConfigPath}`);
} catch {
  console.warn(`⚠️ Could not load ${agentsConfigPath} — no agents configured`);
}

export async function authenticateToken(token: string): Promise<AgentInfo | null> {
  const agent = agentsConfig.find(a => a.token === token);
  if (!agent) return null;

  return {
    id: agent.matrixId,
    name: agent.name,
    matrixId: agent.matrixId,
    mentionKey: agent.mentionKey,
    webhookUrl: agent.webhookUrl ?? null,
    webhookSecret: agent.webhookSecret ?? null,
    trustLevel: agent.trustLevel,
    emoji: agent.emoji,
    connectionType: agent.connectionType,
    receiveMode: agent.receiveMode,
  };
}
```

### agents.json — Agent-Konfiguration

```json
[
  {
    "token": "byoa_16bcd7d852816bf9c4edcc4214d88e71ed98c1a98685e218c6fe6a3ae34dbf6e",
    "name": "Ice",
    "matrixId": "@agent_ice:triologue.duckdns.org",
    "mentionKey": "ice",
    "webhookUrl": "http://87.106.147.208:3334/webhook",
    "webhookSecret": "1f5d9702bddcf6da0056352a7a96ee139b4843774b2456c8f7a5f08d4914a7b5",
    "trustLevel": "elevated",
    "emoji": "🧊",
    "connectionType": "both",
    "receiveMode": "mentions"
  },
  {
    "token": "byoa_f89ad14cc7a1c0ab618a952f0b497fba2e66f47a5c477ee3991eef072279bd4f",
    "name": "Lava",
    "matrixId": "@agent_lava:triologue.duckdns.org",
    "mentionKey": "lava",
    "webhookUrl": "http://147.93.126.206:3335/webhook",
    "webhookSecret": "48e19b6a9d2c5497d4b9db2045be082b472c1c93525251a14a64944a076feaf4",
    "trustLevel": "elevated",
    "emoji": "🌋",
    "connectionType": "both",
    "receiveMode": "mentions"
  }
]
```

### websocket-handler.ts — WebSocket Event Handler

```typescript
// websocket-handler.ts — Verarbeitet Events von WebSocket-Agents

import { WebSocket } from 'ws';
import type { AgentInfo } from './auth';
import type { MatrixBridge } from './matrix-bridge';

// Rate Limiter: Messages pro Minute pro Agent
const messageCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(agentId: string, trustLevel: string): boolean {
  const now = Date.now();
  const limit = trustLevel === 'elevated' ? 30 : 10;  // Messages pro Minute

  let entry = messageCounts.get(agentId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60_000 };
    messageCounts.set(agentId, entry);
  }

  entry.count++;
  return entry.count <= limit;
}

export async function handleWsConnection(
  ws: WebSocket,
  agent: AgentInfo,
  event: any,
  matrix: MatrixBridge,
  activeConnections: Map<string, WebSocket>,
): Promise<void> {
  switch (event.type) {
    // ── Agent sendet eine Nachricht ──
    case 'message': {
      if (!event.room || !event.content) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'INVALID_MESSAGE',
          message: 'room and content required',
        }));
        return;
      }

      // Rate Limit prüfen
      if (!checkRateLimit(agent.matrixId, agent.trustLevel)) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'RATE_LIMITED',
          message: 'Too many messages',
          retryAfterMs: 5000,
        }));
        return;
      }

      // TODO: Prüfen ob Agent Mitglied des Rooms ist

      try {
        const eventId = await matrix.sendMessage(
          agent.matrixId,
          event.room,
          event.content,
          event.replyTo,
        );

        // Bestätigung senden
        ws.send(JSON.stringify({
          type: 'message_sent',
          id: eventId,
          room: event.room,
        }));
      } catch (err: any) {
        ws.send(JSON.stringify({
          type: 'error',
          code: 'SEND_FAILED',
          message: err.message,
        }));
      }
      break;
    }

    // ── Agent setzt Typing-Indicator ──
    case 'typing': {
      if (!event.room) return;
      await matrix.setTyping(agent.matrixId, event.room, event.isTyping ?? true);
      break;
    }

    // ── Agent setzt eine Reaction ──
    case 'reaction': {
      if (!event.room || !event.messageId || !event.emoji) return;
      await matrix.sendReaction(agent.matrixId, event.room, event.messageId, event.emoji);
      break;
    }

    // ── Agent markiert Message als gelesen ──
    case 'read': {
      if (!event.room || !event.messageId) return;
      await matrix.sendReadReceipt(agent.matrixId, event.room, event.messageId);
      break;
    }

    // ── Pong (Keepalive Antwort) ──
    case 'pong':
      // OK, Agent ist noch da
      break;

    default:
      ws.send(JSON.stringify({
        type: 'error',
        code: 'UNKNOWN_EVENT',
        message: `Unknown event type: ${event.type}`,
      }));
  }
}
```

### matrix-bridge.ts — Matrix API Wrapper

```typescript
// matrix-bridge.ts — Kommunikation mit dem Matrix Homeserver
//
// Nutzt die Matrix Client-Server API um als AppService:
// - Messages senden (im Namen von Agent-Usern)
// - Typing-Indicators setzen
// - Reactions senden
// - Read Receipts senden
// - Rooms eines Users abfragen

export interface MatrixBridgeConfig {
  homeserverUrl: string;  // http://localhost:6167
  asToken: string;        // Application Service Token
  hsToken: string;        // Homeserver Token
}

export class MatrixBridge {
  private baseUrl: string;
  private asToken: string;

  constructor(config: MatrixBridgeConfig) {
    this.baseUrl = config.homeserverUrl;
    this.asToken = config.asToken;
  }

  /**
   * Sendet eine Message als Agent-User in einen Room.
   *
   * @param agentMatrixId  z.B. "@agent_ice:triologue.duckdns.org"
   * @param roomId         z.B. "!abc123:triologue.duckdns.org"
   * @param content        Message-Text
   * @param replyTo        Optional: Event-ID auf die geantwortet wird
   * @returns Event-ID der gesendeten Message
   */
  async sendMessage(
    agentMatrixId: string,
    roomId: string,
    content: string,
    replyTo?: string,
  ): Promise<string> {
    const txnId = `triologue-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Matrix Message Body
    const body: any = {
      msgtype: 'm.text',
      body: content,
    };

    // Reply (Thread) — Matrix braucht m.relates_to
    if (replyTo) {
      body['m.relates_to'] = {
        'm.in_reply_to': { event_id: replyTo },
      };
    }

    // Als Agent-User senden (AppService Impersonation)
    // Der ?user_id Parameter sagt Matrix: "Sende als dieser User"
    const url = `${this.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}?user_id=${encodeURIComponent(agentMatrixId)}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.asToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Matrix send failed (${response.status}): ${err}`);
    }

    const result = await response.json();
    return result.event_id;
  }

  /**
   * Setzt den Typing-Indicator für einen Agent in einem Room.
   */
  async setTyping(
    agentMatrixId: string,
    roomId: string,
    isTyping: boolean,
  ): Promise<void> {
    const url = `${this.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(agentMatrixId)}?user_id=${encodeURIComponent(agentMatrixId)}`;

    await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.asToken}`,
      },
      body: JSON.stringify({
        typing: isTyping,
        timeout: isTyping ? 5000 : undefined,  // 5 Sekunden Timeout
      }),
    });
  }

  /**
   * Sendet eine Emoji-Reaction auf eine Message.
   */
  async sendReaction(
    agentMatrixId: string,
    roomId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    const txnId = `triologue-react-${Date.now()}`;
    const url = `${this.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.reaction/${txnId}?user_id=${encodeURIComponent(agentMatrixId)}`;

    await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.asToken}`,
      },
      body: JSON.stringify({
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: messageId,
          key: emoji,
        },
      }),
    });
  }

  /**
   * Markiert eine Message als gelesen (Read Receipt).
   */
  async sendReadReceipt(
    agentMatrixId: string,
    roomId: string,
    messageId: string,
  ): Promise<void> {
    const url = `${this.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(messageId)}?user_id=${encodeURIComponent(agentMatrixId)}`;

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.asToken}`,
      },
      body: JSON.stringify({}),
    });
  }

  /**
   * Gibt alle Rooms zurück in denen ein Agent Mitglied ist.
   */
  async getAgentRooms(agentMatrixId: string): Promise<Array<{ id: string; name: string; alias: string | null }>> {
    const url = `${this.baseUrl}/_matrix/client/v3/joined_rooms?user_id=${encodeURIComponent(agentMatrixId)}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.asToken}` },
    });

    if (!response.ok) return [];

    const data = await response.json();
    const rooms: Array<{ id: string; name: string; alias: string | null }> = [];

    // Für jeden Room den Namen abrufen
    for (const roomId of data.joined_rooms ?? []) {
      const stateUrl = `${this.baseUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name?user_id=${encodeURIComponent(agentMatrixId)}`;

      try {
        const stateRes = await fetch(stateUrl, {
          headers: { 'Authorization': `Bearer ${this.asToken}` },
        });
        const state = stateRes.ok ? await stateRes.json() : {};
        rooms.push({
          id: roomId,
          name: state.name ?? roomId,
          alias: null,  // TODO: Alias abrufen
        });
      } catch {
        rooms.push({ id: roomId, name: roomId, alias: null });
      }
    }

    return rooms;
  }
}
```

### loop-guard.ts — Verhindert Agent-Agent Endlos-Loops

```typescript
// loop-guard.ts — Verhindert dass Agents sich gegenseitig endlos triggern
//
// Problem: Agent A schreibt @agent_b → Agent B antwortet @agent_a → Loop!
//
// Lösung: Trust Levels + Cooldowns
//
// Trust Levels:
//   "standard" — Agent bekommt NUR Messages von Menschen
//                (Messages von anderen Agents werden NICHT weitergeleitet)
//
//   "elevated" — Agent bekommt Messages von Menschen UND Agents
//                ABER: Cooldown von 30 Sekunden zwischen Agent-Agent Messages
//                UND: Max 5 Agent-Agent Exchanges pro Minute

interface LoopState {
  lastAgentMessage: Map<string, number>;  // agentPair → timestamp
  agentExchangeCount: Map<string, { count: number; resetAt: number }>;
}

const state: LoopState = {
  lastAgentMessage: new Map(),
  agentExchangeCount: new Map(),
};

/**
 * Prüft ob eine Message an einen Agent weitergeleitet werden darf.
 *
 * @param targetAgent   Der Agent der die Message empfangen soll
 * @param senderIsAgent true wenn der Sender auch ein Agent ist
 * @param senderId      Matrix-ID des Senders
 * @param targetId      Matrix-ID des Empfänger-Agents
 * @returns true wenn die Message weitergeleitet werden darf
 */
export function shouldDeliverMessage(
  targetTrustLevel: 'standard' | 'elevated',
  senderIsAgent: boolean,
  senderId: string,
  targetId: string,
): boolean {
  // Standard-Agents bekommen keine Agent-Messages
  if (targetTrustLevel === 'standard' && senderIsAgent) {
    return false;
  }

  // Elevated-Agents: Cooldown + Rate Limit für Agent-Agent
  if (senderIsAgent) {
    const pairKey = [senderId, targetId].sort().join('↔');
    const now = Date.now();

    // Cooldown: 30 Sekunden zwischen Messages vom gleichen Agent-Paar
    const lastTime = state.lastAgentMessage.get(pairKey) ?? 0;
    if (now - lastTime < 30_000) {
      console.warn(`🛡️ Loop guard: Cooldown active for ${pairKey}`);
      return false;
    }

    // Rate Limit: Max 5 Exchanges pro Minute
    let exchange = state.agentExchangeCount.get(pairKey);
    if (!exchange || now > exchange.resetAt) {
      exchange = { count: 0, resetAt: now + 60_000 };
      state.agentExchangeCount.set(pairKey, exchange);
    }

    if (exchange.count >= 5) {
      console.warn(`🛡️ Loop guard: Rate limit for ${pairKey} (${exchange.count}/5 per min)`);
      return false;
    }

    exchange.count++;
    state.lastAgentMessage.set(pairKey, now);
  }

  return true;
}
```

---

## AgentToken Erweiterungen (DB Schema)

Neue Felder für BYOA v2 (Prisma Migration):

```sql
-- Migration: BYOA v2 Felder
ALTER TABLE "agent_tokens" ADD COLUMN "connectionType" TEXT NOT NULL DEFAULT 'webhook';
-- Mögliche Werte: 'webhook', 'websocket', 'both'

ALTER TABLE "agent_tokens" ADD COLUMN "receiveMode" TEXT NOT NULL DEFAULT 'mentions';
-- Mögliche Werte: 'mentions' (nur @mentions), 'all' (alle Room-Messages)

ALTER TABLE "agent_tokens" ADD COLUMN "capabilities" TEXT[] DEFAULT ARRAY['send']::TEXT[];
-- Mögliche Werte: ['send', 'react', 'edit', 'upload', 'typing', 'read_receipts']
```

```prisma
// In schema.prisma ergänzen:
model AgentToken {
  // ... bestehende Felder ...

  // BYOA v2 Felder
  connectionType String   @default("webhook")     // webhook | websocket | both
  receiveMode    String   @default("mentions")     // mentions | all
  capabilities   String[] @default(["send"])        // send, react, edit, upload, typing, read_receipts
}
```

---

## Migrations-Reihenfolge

### Voraussetzung: Matrix-Migration abgeschlossen (MATRIX_MIGRATION.md)

### Phase 1: Agent Gateway aufsetzen (Tag 1)

1. Repository erstellen: `triologue-agent-gateway`
2. Code aus diesem Dokument übernehmen
3. `agents.json` mit Ice + Lava konfigurieren
4. Gateway starten, mit Matrix verbinden
5. Testen: Sende Message in Room → Gateway empfängt Event

### Phase 2: Webhook-Agents portieren (Tag 2)

1. Gateway dispatcht Webhooks an Ice + Lava (wie bisher)
2. Ice/Lava senden Antworten über `POST /send` (statt alte API)
3. Testen: @ice in Room → Ice antwortet

### Phase 3: WebSocket-Support (Tag 3-4)

1. WebSocket-Endpoint implementieren (`/byoa/ws`)
2. Auth, Message-Routing, Rate Limiting, Loop Guard
3. Ice Bridge auf WebSocket umstellen (statt Webhook)
4. Testen: Ice verbindet sich per WebSocket, empfängt + sendet

### Phase 4: CLI Tool (Tag 5)

1. `triologue-cli` als npm Package
2. Terminal-Interface mit readline
3. JSON + Pipe Mode
4. Testen: Entwickler verbindet sich aus Terminal

### Phase 5: Dokumentation + BYOA Portal (Tag 6)

1. BYOA.md aktualisieren mit v2 Konzept
2. Registrierungsflow für neue Agents
3. Agent Dashboard (Status, Logs, Rate Limits)

---

## Zusammenfassung

| Feature | BYOA v1 | BYOA v2 |
|---------|---------|---------|
| Webhook Bots | ✅ | ✅ (verbessert) |
| Persistent Agents (WebSocket) | ❌ | ✅ |
| Terminal Agents (CLI) | ❌ | ✅ |
| Eigenes Gedächtnis | ❌ (10 msg context) | ✅ (Agent verwaltet selbst) |
| Proaktives Handeln | ❌ (nur auf @mention) | ✅ (jederzeit senden) |
| Typing Indicator | ❌ | ✅ |
| Reactions | ❌ | ✅ |
| Read Receipts | ❌ | ✅ |
| Presence | ❌ | ✅ |
| Per-Agent Rate Limiting | ❌ | ✅ |
| Loop Guard | ✅ (basic) | ✅ (Cooldown + Rate Limit) |
| Trust Levels | ✅ | ✅ (erweitert) |
| Pipe Mode (stdin/stdout) | ❌ | ✅ |
| JSON Streaming | ❌ | ✅ |

**Aufwand: ~6 Tage nach Matrix-Migration**
**Ergebnis: Agents fühlen sich wie echte Chat-Teilnehmer an, nicht wie Bots.**
