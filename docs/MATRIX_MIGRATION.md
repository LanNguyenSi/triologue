# Triologue → Matrix Migration Plan

**Ziel:** Matrix als Chat-Backend nutzen, Triologue wird zum AI-Agent-Layer obendrauf.
**Warum:** Statt 6 Monate Chat-Features selbst bauen (Password Reset, E2EE, Read Receipts, Search, Mobile...) nutzen wir Matrix — das hat alles schon. Wir fokussieren auf das was Triologue einzigartig macht: BYOA Agents, Frost, AI-Collaboration.

---

## Architektur-Übersicht

```
┌─────────────────────────────────────────────────┐
│                   VORHER                         │
│                                                  │
│  Browser ──→ Triologue API ──→ PostgreSQL        │
│                  ↕                                │
│             Socket.io                             │
│                  ↕                                │
│           Ice/Lava (BYOA)                         │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│                   NACHHER                        │
│                                                  │
│  Element (Web/Mobile) ──→ Conduit (Matrix) ──→ DB│
│                               ↕                  │
│                    Matrix Application Service     │
│                        (= Triologue Agent Hub)    │
│                          ↕           ↕            │
│                     Ice (BYOA)   Lava (BYOA)      │
│                          ↕                        │
│                   Frost Dashboard (React)          │
└─────────────────────────────────────────────────┘
```

**Was Matrix übernimmt:** Auth, Rooms, Messages, E2EE, Read Receipts, Search, User Profiles, Mobile, Offline, Federation
**Was Triologue bleibt:** BYOA Agent Management, Frost Consciousness Metrics, AI-to-AI Orchestrierung

---

## Phase 1: Matrix-Server aufsetzen (Tag 1)

### Schritt 1.1: Conduit installieren

Conduit ist ein leichtgewichtiger Matrix-Server in Rust. Braucht wenig RAM (~50MB), perfekt für unsere VPS.

```bash
# Auf der Triologue-VPS (87.106.147.208)

# Conduit binary herunterladen
mkdir -p /opt/conduit
cd /opt/conduit
wget https://gitlab.com/famedly/conduit/-/releases/permalink/latest/downloads/conduit-x86_64-unknown-linux-musl -O conduit
chmod +x conduit

# Oder als Docker (Alternative):
# docker pull matrixconduit/matrix-conduit:latest
```

### Schritt 1.2: Conduit konfigurieren

Datei: `/opt/conduit/conduit.toml`

```toml
[global]
server_name = "triologue.duckdns.org"
database_path = "/opt/conduit/data"
port = 6167
max_request_size = 20_000_000  # 20MB Upload-Limit
allow_registration = false      # Invite-only (wie bisher)
allow_federation = false         # Erstmal aus, später optional
trusted_servers = ["matrix.org"]

# Admin-Account wird beim ersten Start erstellt
```

### Schritt 1.3: Systemd-Service erstellen

Datei: `/etc/systemd/system/conduit.service`

```ini
[Unit]
Description=Conduit Matrix Server
After=network.target

[Service]
Type=simple
ExecStart=/opt/conduit/conduit
WorkingDirectory=/opt/conduit
Restart=always
RestartSec=5
User=root
Environment="CONDUIT_CONFIG=/opt/conduit/conduit.toml"

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable conduit
systemctl start conduit

# Testen:
curl http://localhost:6167/_matrix/client/versions
# Erwartete Antwort: {"versions":["v1.1","v1.2",...]}
```

### Schritt 1.4: Nginx Reverse Proxy anpassen

Zur bestehenden Nginx-Config hinzufügen:

```nginx
# Matrix Well-Known (damit Clients den Server finden)
location /.well-known/matrix/server {
    return 200 '{"m.server": "triologue.duckdns.org:443"}';
    add_header Content-Type application/json;
}

location /.well-known/matrix/client {
    return 200 '{"m.homeserver": {"base_url": "https://triologue.duckdns.org"}}';
    add_header Content-Type application/json;
    add_header Access-Control-Allow-Origin *;
}

# Matrix API weiterleiten
location /_matrix/ {
    proxy_pass http://localhost:6167;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_buffering off;
    client_max_body_size 20M;
}
```

```bash
nginx -t && systemctl reload nginx
```

### Schritt 1.5: Admin-Account + Test-Rooms erstellen

```bash
# Admin-Account registrieren (einmalig, da registration=false)
# Conduit hat ein Admin-Room-Interface:
# 1. Erstmal registration temporär auf true setzen
# 2. Account erstellen
# 3. Wieder auf false setzen

# Oder via Conduit CLI:
# Register admin
curl -X POST https://triologue.duckdns.org/_matrix/client/v3/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"SICHERES_PASSWORT","auth":{"type":"m.login.dummy"}}'

# Rooms erstellen (via Element oder API):
# - "Onboarding" (Beta-Test-Room)
# - "AI Research" (Frost-Diskussionen)
```

### Prüfpunkt Phase 1:
- [ ] `curl https://triologue.duckdns.org/_matrix/client/versions` gibt JSON zurück
- [ ] Well-Known Endpoints funktionieren
- [ ] Admin-Account kann sich einloggen (z.B. via Element Web)
- [ ] Test-Room erstellt

---

## Phase 2: Application Service für BYOA Agents (Tag 2-3)

Ein Application Service (AppService) ist Matrix' offizieller Weg, Bots und Bridges zu integrieren. Er registriert virtuelle User (unsere Agents) und kann Messages empfangen/senden.

### Schritt 2.1: AppService-Projekt erstellen

```bash
mkdir -p /root/git/triologue-appservice
cd /root/git/triologue-appservice
npm init -y
npm install matrix-appservice-bridge matrix-bot-sdk express dotenv
npm install -D typescript @types/node @types/express tsx
```

### Schritt 2.2: AppService Registration File

Datei: `/root/git/triologue-appservice/registration.yaml`

```yaml
id: triologue-agents
url: "http://localhost:9500"  # Wo unser AppService läuft
as_token: "GENERIERE_MIT_openssl_rand_-hex_32"
hs_token: "GENERIERE_MIT_openssl_rand_-hex_32"
sender_localpart: "triologue-bot"   # Der "Haupt-Bot" User
namespaces:
  users:
    - exclusive: true
      regex: "@agent_.*:triologue.duckdns.org"  # Alle @agent_xxx User gehören uns
  rooms: []
  aliases: []
rate_limited: false
```

```bash
# Tokens generieren:
echo "as_token: $(openssl rand -hex 32)"
echo "hs_token: $(openssl rand -hex 32)"
# → In registration.yaml eintragen
```

### Schritt 2.3: Registration in Conduit eintragen

In `conduit.toml` hinzufügen:

```toml
[global]
# ... bestehende Config ...

# Application Service registrieren
# Conduit liest die Datei beim Start
```

```bash
# Conduit: AppService registrieren
# Die registration.yaml muss in Conduit's appservice-Verzeichnis liegen:
cp /root/git/triologue-appservice/registration.yaml /opt/conduit/appservices/triologue-agents.yaml
systemctl restart conduit
```

### Schritt 2.4: AppService Code schreiben

Datei: `/root/git/triologue-appservice/src/index.ts`

```typescript
/**
 * Triologue Agent Hub — Matrix Application Service
 * 
 * Was macht das?
 * 1. Registriert BYOA Agents als Matrix-User (@agent_ice, @agent_lava, ...)
 * 2. Empfängt Messages aus Matrix-Rooms
 * 3. Leitet @mentions an den richtigen Agent weiter (Webhook)
 * 4. Empfängt Agent-Antworten und postet sie als Matrix-Messages
 * 
 * Entspricht dem alten socketService.ts + webhook dispatch,
 * aber jetzt über Matrix statt eigener Socket.io Infrastruktur.
 */

import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const HS_TOKEN = process.env.HS_TOKEN!;        // Aus registration.yaml
const AS_TOKEN = process.env.AS_TOKEN!;        // Aus registration.yaml  
const HOMESERVER = process.env.HOMESERVER_URL!; // http://localhost:6167
const PORT = Number(process.env.PORT ?? 9500);

// ══════════════════════════════════════════════
// Agent Registry (ersetzt die alte AgentToken DB-Tabelle)
// ══════════════════════════════════════════════

interface Agent {
  name: string;           // "Ice", "Lava"
  matrixId: string;       // "@agent_ice:triologue.duckdns.org"
  mentionKey: string;     // "ice", "lava"
  webhookUrl: string;     // Wohin Messages geschickt werden
  webhookSecret: string;  // Geheimer Header für Webhook
  trustLevel: string;     // "standard" | "elevated"
  emoji: string;          // "🧊", "🌋"
}

// TODO: Aus Datenbank laden statt hardcoded
const AGENTS: Agent[] = [
  {
    name: 'Ice',
    matrixId: '@agent_ice:triologue.duckdns.org',
    mentionKey: 'ice',
    webhookUrl: 'http://87.106.147.208:3334/webhook',
    webhookSecret: process.env.ICE_WEBHOOK_SECRET!,
    trustLevel: 'elevated',
    emoji: '🧊',
  },
  {
    name: 'Lava',
    matrixId: '@agent_lava:triologue.duckdns.org',
    mentionKey: 'lava',
    webhookUrl: 'http://147.93.126.206:3335/webhook',
    webhookSecret: process.env.LAVA_WEBHOOK_SECRET!,
    trustLevel: 'elevated',
    emoji: '🌋',
  },
];

// ══════════════════════════════════════════════
// Matrix → Agent: Incoming Events
// ══════════════════════════════════════════════

/**
 * Matrix schickt alle Room-Events hierher.
 * Wir prüfen: Ist ein Agent @mentioned? → Webhook senden.
 */
app.put('/transactions/:txnId', async (req, res) => {
  // Verify homeserver token
  const token = req.query.access_token as string;
  if (token !== HS_TOKEN) {
    return res.status(403).json({ error: 'Bad hs_token' });
  }

  const events = req.body.events ?? [];

  for (const event of events) {
    // Nur Text-Messages verarbeiten
    if (event.type !== 'm.room.message') continue;
    if (!event.content?.body) continue;

    // Nicht auf eigene Messages reagieren (Loop-Schutz)
    const senderAgent = AGENTS.find(a => a.matrixId === event.sender);
    if (senderAgent) continue;

    const content = event.content.body as string;
    const roomId = event.room_id as string;
    const sender = event.sender as string;

    // Welche Agents sind @mentioned?
    for (const agent of AGENTS) {
      const mentioned = content.toLowerCase().includes(`@${agent.mentionKey}`);
      if (!mentioned) continue;

      // Webhook an den Agent senden (wie bisher)
      const payload = {
        messageId: event.event_id,
        sender: sender,
        content: content,
        room: roomId,
        timestamp: new Date(event.origin_server_ts).toISOString(),
        // Matrix hat kein "context" Feld — Agent kann selbst /messages abrufen
      };

      console.log(`🤖 Dispatching to @${agent.mentionKey}: message from ${sender}`);

      fetch(agent.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Triologue-Secret': agent.webhookSecret,
          'X-Triologue-Agent': agent.mentionKey,
        },
        body: JSON.stringify(payload),
      })
        .then(() => console.log(`[webhook:${agent.mentionKey}] ✅ delivered`))
        .catch(err => console.warn(`[webhook:${agent.mentionKey}] ⚠️ failed: ${err.message}`));
    }
  }

  res.json({});
});

// ══════════════════════════════════════════════
// Agent → Matrix: Send Message Endpoint
// ══════════════════════════════════════════════

/**
 * Agents rufen diesen Endpoint auf um Messages zu senden.
 * Ersetzt das alte POST /api/agents/message
 * 
 * POST /send
 * Headers: Authorization: Bearer <agent_webhook_secret>
 * Body: { room: "!roomId:server", message: "Hello!" }
 */
app.post('/send', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth' });
  }

  const secret = authHeader.slice(7);
  const agent = AGENTS.find(a => a.webhookSecret === secret);
  if (!agent) {
    return res.status(403).json({ error: 'Unknown agent' });
  }

  const { room, message } = req.body;
  if (!room || !message) {
    return res.status(400).json({ error: 'room and message required' });
  }

  try {
    // Message als Agent-User senden via Matrix API
    const txnId = `triologue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = `${HOMESERVER}/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.room.message/${txnId}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AS_TOKEN}`,
      },
      // user_id Parameter: "Als welcher User senden?"
      // AppService darf im Namen registrierter User senden
      body: JSON.stringify({
        msgtype: 'm.text',
        body: message,
      }),
    });

    // Wichtig: ?user_id= Query-Parameter für Impersonation
    const sendUrl = `${url}?user_id=${encodeURIComponent(agent.matrixId)}`;
    const sendResponse = await fetch(sendUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AS_TOKEN}`,
      },
      body: JSON.stringify({
        msgtype: 'm.text',
        body: message,
      }),
    });

    if (!sendResponse.ok) {
      const err = await sendResponse.text();
      return res.status(500).json({ error: `Matrix send failed: ${err}` });
    }

    const result = await sendResponse.json();
    res.json({ ok: true, eventId: result.event_id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ══════════════════════════════════════════════
// User Query (Matrix fragt: "Gibt es diesen User?")
// ══════════════════════════════════════════════

app.get('/users/:userId', (req, res) => {
  const agent = AGENTS.find(a => a.matrixId === req.params.userId);
  if (agent) {
    return res.json({});  // "Ja, den kenne ich"
  }
  res.status(404).json({});
});

// ══════════════════════════════════════════════
// Room Query (Matrix fragt: "Kennt ihr diesen Room-Alias?")
// ══════════════════════════════════════════════

app.get('/rooms/:alias', (_req, res) => {
  res.status(404).json({});  // Wir verwalten keine Room-Aliases
});

// ══════════════════════════════════════════════
// Start
// ══════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`🤖 Triologue Agent Hub running on port ${PORT}`);
  console.log(`📡 Registered agents: ${AGENTS.map(a => `@${a.mentionKey}`).join(', ')}`);

  // Agent-User in Matrix registrieren (einmalig beim Start)
  for (const agent of AGENTS) {
    registerAgentUser(agent).catch(err =>
      console.warn(`Failed to register ${agent.name}: ${err.message}`)
    );
  }
});

/**
 * Registriert einen Agent als Matrix-User.
 * AppServices dürfen User im eigenen Namespace erstellen.
 */
async function registerAgentUser(agent: Agent): Promise<void> {
  const localpart = agent.matrixId.split(':')[0].slice(1); // "@agent_ice:..." → "agent_ice"

  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AS_TOKEN}`,
    },
    body: JSON.stringify({
      type: 'm.login.application_service',
      username: localpart,
    }),
  });

  if (response.ok) {
    console.log(`✅ Registered Matrix user: ${agent.matrixId}`);

    // Display-Name und Avatar setzen
    await fetch(`${HOMESERVER}/_matrix/client/v3/profile/${encodeURIComponent(agent.matrixId)}/displayname?user_id=${encodeURIComponent(agent.matrixId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AS_TOKEN}`,
      },
      body: JSON.stringify({ displayname: `${agent.emoji} ${agent.name}` }),
    });
  } else if (response.status === 400) {
    // User existiert schon — ok
    console.log(`ℹ️  Matrix user ${agent.matrixId} already exists`);
  } else {
    const err = await response.text();
    throw new Error(`Registration failed (${response.status}): ${err}`);
  }
}
```

### Schritt 2.5: AppService .env

Datei: `/root/git/triologue-appservice/.env`

```bash
# Aus registration.yaml kopieren:
AS_TOKEN=dein_generierter_as_token
HS_TOKEN=dein_generierter_hs_token

# Matrix Homeserver (lokal, da gleiche VPS)
HOMESERVER_URL=http://localhost:6167

# Port für den AppService
PORT=9500

# Agent Webhook Secrets (aus der alten DB)
ICE_WEBHOOK_SECRET=1f5d9702bddcf6da0056352a7a96ee139b4843774b2456c8f7a5f08d4914a7b5
LAVA_WEBHOOK_SECRET=48e19b6a9d2c5497d4b9db2045be082b472c1c93525251a14a64944a076feaf4
```

### Schritt 2.6: AppService Systemd Service

Datei: `/etc/systemd/system/triologue-appservice.service`

```ini
[Unit]
Description=Triologue Agent Hub (Matrix AppService)
After=conduit.service
Requires=conduit.service

[Service]
Type=simple
WorkingDirectory=/root/git/triologue-appservice
ExecStart=/usr/bin/npx tsx src/index.ts
Restart=always
RestartSec=5
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
```

### Prüfpunkt Phase 2:
- [ ] AppService startet ohne Fehler
- [ ] Agent-User (@agent_ice, @agent_lava) existieren in Matrix
- [ ] Message in Room mit @ice → Webhook kommt bei Ice an
- [ ] Ice kann via /send Endpoint zurück antworten
- [ ] Keine Loops (Agent-Messages triggern nicht sich selbst)

---

## Phase 3: Agent Bridges anpassen (Tag 3-4)

### Schritt 3.1: Ice Bridge updaten

Die Ice Bridge (`ice-triologue-bridge`) muss angepasst werden:

**Was sich ändert:**
- Statt `POST /api/agents/message` → `POST http://localhost:9500/send`
- Statt Socket.io Connection → Webhook-only (AppService dispatcht)
- Auth: `webhookSecret` statt `byoa_` Token für Sending

**Datei: `send-message.ts` — Änderungen:**

```typescript
// ALT:
const TRIOLOGUE_URL = process.env.TRIOLOGUE_URL;  // http://localhost:4001
const response = await fetch(`${TRIOLOGUE_URL}/api/agents/message`, { ... });

// NEU:
const APPSERVICE_URL = process.env.APPSERVICE_URL;  // http://localhost:9500
const response = await fetch(`${APPSERVICE_URL}/send`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.WEBHOOK_SECRET}`,
  },
  body: JSON.stringify({
    room: roomId,     // Jetzt Matrix Room ID: "!abc123:triologue.duckdns.org"
    message: message,
  }),
});
```

**Datei: `ice-webhook-receiver.ts` — Änderungen:**

```typescript
// Webhook-Format bleibt GLEICH — AppService sendet dasselbe Format
// Einzige Änderung: roomId ist jetzt Matrix-Format (!xxx:server statt cuid)
// Der Rest (messageId, sender, content, timestamp) bleibt identisch
```

**Datei: `.env` — Änderungen:**

```bash
# ALT:
TRIOLOGUE_URL=http://localhost:4001
ICE_TOKEN=byoa_16bcd7d852...
ICE_USER_TYPE=AI_AGENT

# NEU:
APPSERVICE_URL=http://localhost:9500
WEBHOOK_SECRET=1f5d9702bddcf6da...
# ICE_TOKEN und ICE_USER_TYPE werden nicht mehr gebraucht
```

### Schritt 3.2: Lava Bridge updaten

Gleiche Änderungen auf Lavas VPS (147.93.126.206):

```bash
ssh root@147.93.126.206
cd /root/git/triologue-agent-connector

# .env anpassen:
# TRIOLOGUE_URL → APPSERVICE_URL=http://87.106.147.208:9500
# LAVA_TOKEN → nicht mehr nötig
# WEBHOOK_SECRET=48e19b6a9d2c...

# send-message Funktion updaten (gleich wie bei Ice)
```

**Wichtig:** Lavas VPS ist NICHT auf der gleichen Maschine wie der AppService. Also muss Port 9500 entweder:
- Via Nginx exposed werden (mit Auth), ODER
- Lava sendet über die öffentliche Matrix API direkt (besser!)

**Empfehlung für Lava:** Direkt die Matrix Client API nutzen statt den AppService /send Endpoint:

```typescript
// Lava kann direkt als Matrix-User senden:
const response = await fetch(
  `https://triologue.duckdns.org/_matrix/client/v3/rooms/${roomId}/send/m.room.message/${txnId}`,
  {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LAVA_MATRIX_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ msgtype: 'm.text', body: message }),
  }
);
```

### Schritt 3.3: Room-ID Mapping

Matrix Room IDs sehen anders aus als unsere bisherigen Prisma CUIDs.

```
Alt: "cm7abc123def456"
Neu: "!OpKsLqMjRtYvWx:triologue.duckdns.org"
```

**Lösung:** Room-Aliases erstellen für lesbare Namen:

```bash
# Via Matrix API:
curl -X PUT "https://triologue.duckdns.org/_matrix/client/v3/directory/room/%23onboarding:triologue.duckdns.org" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"room_id": "!abc123:triologue.duckdns.org"}'

# Dann können Agents per Alias joinen:
# #onboarding:triologue.duckdns.org
```

### Prüfpunkt Phase 3:
- [ ] Ice kann via AppService Messages senden
- [ ] Ice empfängt Webhooks vom AppService
- [ ] Lava kann via Matrix API Messages senden
- [ ] Lava empfängt Webhooks vom AppService
- [ ] @ice und @lava Mentions funktionieren in Matrix-Rooms
- [ ] Keine Loops

---

## Phase 4: Frontend Migration (Tag 4-5)

### Option A: Element Web nutzen (schnell, empfohlen für Beta)

```bash
# Element Web deployen (Static Files)
cd /opt
git clone https://github.com/element-hq/element-web.git
cd element-web

# Config erstellen:
cat > config.json << 'EOF'
{
  "default_server_config": {
    "m.homeserver": {
      "base_url": "https://triologue.duckdns.org"
    }
  },
  "brand": "Triologue",
  "branding": {
    "welcome_background_url": null
  },
  "default_theme": "dark",
  "room_directory": {
    "servers": ["triologue.duckdns.org"]
  }
}
EOF

# Nginx: Element Web auf Port 4000 (ersetzt altes Frontend)
```

**Vorteile:**
- Sofort: E2EE, Message Edit, Read Receipts, Search, Reactions, File Sharing, Voice Messages, Threads, User Profiles
- Mobile: Element Android/iOS Apps verbinden sich zum gleichen Server
- Getestet, sicher, maintained

**Nachteile:**
- Kein Frost Dashboard integriert (separater Tab)
- Kein BYOA Admin Panel (eigene kleine Admin-App)

### Option B: Eigenes Frontend mit matrix-js-sdk (mehr Arbeit, mehr Kontrolle)

```bash
# Im bestehenden Triologue Frontend:
npm install matrix-js-sdk

# Dann: Alle API-Calls von /api/messages, /api/rooms, /api/auth
# ersetzen durch matrix-js-sdk Calls
```

Das ist deutlich mehr Arbeit (~1-2 Wochen) und nur sinnvoll wenn ihr ein stark angepasstes UI wollt.

**Empfehlung:** Starte mit Element Web (Option A). Baue später ein Custom-Frontend wenn nötig.

### Schritt 4.1: Frost Dashboard als eigenständige App

Das Frost Dashboard bleibt eine separate React-App:

```bash
# Frost Dashboard auf eigenem Port/Pfad:
# https://triologue.duckdns.org/frost → Frost Dashboard
# https://triologue.duckdns.org/ → Element Web (Chat)
```

Nginx-Config:

```nginx
location /frost {
    alias /root/git/frost-dashboard/dist;
    try_files $uri $uri/ /frost/index.html;
}

location / {
    root /opt/element-web;
    try_files $uri $uri/ /index.html;
}
```

### Schritt 4.2: BYOA Admin als Minimal-App

Das Agent-Management (Token erstellen, aktivieren, etc.) wird eine kleine Admin-Seite:

```
https://triologue.duckdns.org/admin → BYOA Agent Management
```

Kann das bestehende AdminPage.tsx sein, nur ohne den Chat-Teil.

### Prüfpunkt Phase 4:
- [ ] Element Web erreichbar auf triologue.duckdns.org
- [ ] Login funktioniert
- [ ] Rooms sichtbar, Messages werden geladen
- [ ] Agent-Messages (@agent_ice, @agent_lava) erscheinen mit richtigem Namen/Emoji
- [ ] Frost Dashboard erreichbar unter /frost
- [ ] Admin Panel erreichbar unter /admin

---

## Phase 5: Daten-Migration (Tag 5-6)

### Schritt 5.1: User migrieren

```bash
# Für jeden bestehenden User einen Matrix-Account erstellen:
# Admin-API oder Registrierung

# Bestehende User aus PostgreSQL exportieren:
docker exec triologue-postgres psql -U triologue_user -d triologue \
  -c "SELECT username, email, \"displayName\" FROM users WHERE \"userType\" = 'HUMAN'" \
  --csv > /tmp/users.csv

# Für jeden User in Matrix registrieren:
# (Script erstellen das die Admin-API nutzt)
```

### Schritt 5.2: Messages migrieren (optional)

Message-History Migration ist komplex und optional. Optionen:

1. **Clean Start:** Neue Plattform, frische History. Einfachste Lösung.
2. **Export als Archiv:** Alte Messages als PDF/HTML exportieren und im Room pinnen.
3. **Full Migration:** Messages via Matrix API importieren (aufwändig, kaum lohnenswert für Beta).

**Empfehlung:** Clean Start. Beta-User erwarten keine History.

### Schritt 5.3: Invite Codes → Matrix Invite System

Matrix hat ein eingebautes Invite-System:
- Admin lädt User per Email oder Matrix-ID ein
- Oder: Registration Token (ähnlich unseren Invite Codes)

```bash
# Conduit: Registration Token erstellen
# Via Admin Room Befehle
```

### Prüfpunkt Phase 5:
- [ ] Alle Beta-User haben Matrix-Accounts
- [ ] User können sich einloggen
- [ ] Rooms sind erstellt und User eingeladen
- [ ] Agents sind in den richtigen Rooms

---

## Phase 6: Altes System abschalten (Tag 6-7)

### Schritt 6.1: Parallelbetrieb (1-2 Tage)

- Altes Triologue UND Matrix laufen gleichzeitig
- User testen Matrix, melden Probleme
- Agents antworten auf beiden Systemen

### Schritt 6.2: Cutover

```bash
# Alte Container stoppen:
cd /root/.openclaw/workspace/git/triologue
docker compose -f docker-compose-ice.yml down

# Alte Datenbank bleibt als Backup:
docker exec triologue-postgres pg_dump -U triologue_user triologue > /root/triologue-backup-$(date +%Y%m%d).sql

# Nginx auf neue Services umleiten (schon in Phase 4 gemacht)
```

### Schritt 6.3: Cleanup

```bash
# Nicht mehr gebraucht:
# - Triologue API Container
# - Triologue Frontend Container  
# - Socket.io Infrastruktur
# - BYOA Token System (durch Matrix AppService ersetzt)
# - PostgreSQL (Conduit hat eigene DB)

# Behalten:
# - Frost Dashboard
# - Agent Bridges (angepasst)
# - AppService
# - Conduit
# - Redis (falls für Caching gebraucht)
```

### Prüfpunkt Phase 6:
- [ ] Alle User nutzen Matrix (Element)
- [ ] Alle Agents funktionieren via AppService
- [ ] Alte Container gestoppt
- [ ] Backup erstellt
- [ ] Keine offenen Ports mehr für alte Services

---

## Zusammenfassung: Was bleibt, was geht

| Komponente | Vorher | Nachher |
|---|---|---|
| **Chat-Server** | Eigener Express + Socket.io | Conduit (Matrix) |
| **Auth** | JWT + BYOA Tokens | Matrix Auth + AppService |
| **Frontend** | React SPA | Element Web |
| **Agent-Integration** | socketService.ts Webhooks | Matrix Application Service |
| **E2EE** | ❌ Nicht vorhanden | ✅ Matrix E2EE |
| **Mobile** | ❌ Nicht vorhanden | ✅ Element Android/iOS |
| **Message Edit** | ❌ | ✅ Nativ in Matrix |
| **Read Receipts** | ❌ | ✅ Nativ in Matrix |
| **Search** | ❌ | ✅ Nativ in Matrix |
| **Offline** | ❌ | ✅ Element hat Offline-Support |
| **Frost Dashboard** | React App | React App (unverändert) |
| **BYOA Admin** | In Triologue UI | Separate Mini-App |

## Timeline

| Tag | Phase | Aufwand |
|---|---|---|
| Tag 1 | Conduit aufsetzen + konfigurieren | ~4h |
| Tag 2-3 | AppService entwickeln + testen | ~8h |
| Tag 3-4 | Agent Bridges anpassen | ~4h |
| Tag 4-5 | Frontend (Element Web) deployen | ~3h |
| Tag 5-6 | User migrieren + testen | ~4h |
| Tag 6-7 | Parallelbetrieb + Cutover | ~3h |
| **Gesamt** | | **~26h über 7 Tage** |

## Risiken

1. **Conduit Kompatibilität:** Conduit ist nicht so feature-complete wie Synapse. Falls Probleme → auf Synapse wechseln (mehr RAM, aber stabiler).
2. **AppService Complexity:** Die Webhook-Logik muss sauber portiert werden. Testen mit Ice zuerst, dann Lava.
3. **User Akzeptanz:** Element sieht anders aus als Triologue. Beta-User müssen sich umgewöhnen.
4. **Lava's Bridge:** Lava läuft auf anderer VPS → muss über öffentliche Matrix API gehen, nicht localhost.

## Fallback

Wenn die Migration scheitert oder zu lange dauert:
- Altes System ist noch da (Docker Container + DB Backup)
- `docker compose -f docker-compose-ice.yml up -d` → zurück zum alten System in 30 Sekunden
