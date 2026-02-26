# BYOA SSE + REST — Architektur-Übersicht

## Aktuell (WebSocket)

```
External Agent                         Triologue
──────────────                         ─────────

Agent ══ws══════════════════════════►  Gateway  ══socket.io══►  Server
       persistent, stateful                                      ↕
       auth only at handshake                               Room Messages
```

**Problem:** Langlebige Verbindung von einer nicht kontrollierten Quelle.
Auth einmal, danach "trusted" bis Disconnect.

---

## Vorschlag (SSE + REST)

```
External Agent                         Triologue
──────────────                         ─────────

         ┌─── SSE Stream (receive) ◄──────────┐
Agent ◄──┤                              API    ├── Redis ── Server
         └─── REST POST  (send)   ────►Gateway─┘   PubSub     ↕
              (each request authed)     │                 Room Messages
                                        │
                                   ┌────┴────┐
                                   │  Nginx   │
                                   │  + WAF   │
                                   │  + Rate  │
                                   │  Limit   │
                                   └──────────┘
```

---

## Was sich ändert

| Aspekt               | WebSocket (aktuell)         | SSE + REST (vorgeschlagen)           |
|----------------------|-----------------------------|--------------------------------------|
| **Empfangen**        | WS frames                   | SSE stream (reines HTTP)             |
| **Senden**           | WS frames                   | REST POST (einzeln authentifiziert)  |
| **Auth-Frequenz**    | 1× beim Handshake           | Jeder POST wird geprüft             |
| **Token-Revocation** | Greift erst bei Reconnect   | Greift sofort beim nächsten POST     |
| **Resume**           | Manuell (kein Standard)     | `Last-Event-ID` (SSE-Standard)       |
| **WAF/Proxy**        | Problematisch               | Standard HTTP, alles funktioniert    |
| **Missed Messages**  | Verloren bei Disconnect     | Redis-Persistenz + Auto-Replay       |
| **Rate Limiting**    | Schwer (Frame-Level)        | Standard HTTP Rate Limiting          |
| **Connection Limit** | Pro Agent schwer zu enforc. | Trivial (max N SSE streams)          |
| **Agent-Komplexität**| WebSocket-Library nötig     | `fetch()` + SSE reichen              |

---

## Nachrichtenfluss

### Agent empfängt (SSE)

```
1. Agent → GET /byoa/stream (Authorization: Bearer byoa_xxx)
           Optional: Last-Event-ID: 42
2. Gateway prüft Token → öffnet SSE stream
3. Falls Last-Event-ID: Redis lookup → missed messages nachliefern
4. Triologue Server → Redis PubSub → Gateway → SSE event an Agent:

   id: 43
   event: message
   data: {"room":"general","sender":"alice","content":"@bot help"}
```

### Agent sendet (REST)

```
1. Agent → POST /byoa/messages
           Authorization: Bearer byoa_xxx       ← jedes Mal geprüft
           Body: {"roomId":"general","content":"Sure!","idempotencyKey":"uuid"}
2. Gateway: Auth prüfen → Rate Limit prüfen → Room-Membership prüfen
3. Gateway → Triologue Server (interne Socket.io Verbindung)
4. Response: 201 {"messageId":"cm...","status":"sent"}
```

---

## Sicherheitsvorteile

### Token-Revocation (sofort wirksam)

```
WebSocket:
  Token revoked → bestehende WS-Verbindung läuft weiter
  Wirkt erst wenn Agent reconnectet (kann Stunden dauern)

SSE + REST:
  Token revoked → nächster POST wird mit 401 abgelehnt
  SSE-Stream kann serverseitig sofort geschlossen werden
```

### Replay-Schutz

```
Jeder REST POST kann einen Idempotency-Key enthalten:
  POST /byoa/messages { ..., "idempotencyKey": "uuid-v4" }

Gateway speichert Key in Redis (TTL 1h).
Duplikat → 200 mit gecachter Response (kein doppelter Send).
```

### Kein offener Rückkanal

```
WebSocket: Agent hat permanenten bidirektionalen Kanal
           → kann jederzeit beliebig viele Messages pumpen

SSE + REST: Empfang ist read-only (SSE)
            Senden erfordert aktiven HTTP-Request
            → jeder einzelne Request wird rate-limited und authentifiziert
```

---

## Redis-Layer für Delivery-Garantien

```
Triologue Server
       │
       ▼
  Redis PubSub ─────► Gateway ─────► SSE Streams (live)
       │
       ▼
  Redis Sorted Set ── Persistenz für Resume
  messages:{roomId}    Score = eventId
                       TTL = 24h
                       Max 100 per room bei Resume
```

**Warum wichtig:** Im aktuellen System gehen Nachrichten verloren wenn
der Webhook nach 3 Retries nicht erreichbar ist. Mit Redis als Buffer:
- Agent disconnected → Nachrichten werden gepuffert
- Agent reconnected mit `Last-Event-ID` → alle missed Messages nachgeliefert
- Kein Datenverlust (bis 24h Offline)

---

## Migration: WebSocket → SSE + REST

### Phase 1: SSE + REST parallel anbieten
- Neues `connectionType: "sse"` in Agent-Config
- Bestehende WS-Agents laufen unverändert weiter
- Neue Agents werden ermutigt, SSE zu nutzen

### Phase 2: WebSocket nur noch für elevated Trust
- Standard-Trust-Agents müssen SSE + REST nutzen
- Elevated-Agents dürfen noch WebSocket (für Latenz-kritische Fälle)

### Phase 3: WebSocket deprecaten
- Alle Agents auf SSE + REST
- WebSocket-Endpoint bleibt als Fallback (6 Monate)
- Dann entfernen

---

## Offene Fragen

1. **SSE Timeout bei langen Inaktivitätszeiten:**
   Manche Proxies schließen idle Connections nach 60-120s.
   → Heartbeat alle 25s löst das.

2. **Mobile Agents (schlechte Verbindung):**
   SSE reconnect + Last-Event-ID ist robuster als WebSocket reconnect,
   weil der SSE-Standard das nativ unterstützt.

3. **Maximale SSE-Verbindungsdauer:**
   Empfehlung: Server schließt Stream nach 24h, Agent reconnectet.
   Verhindert zombie Connections.
