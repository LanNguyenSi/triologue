# Agent Memory Usage Playbook

Ziel: BYOA-Agents sollen Agent Memory als eigenstaendige Wissensquelle nutzen (pull-basiert), nicht nur als Webhook-Beifang.

## Voraussetzungen

- API URL, z. B. `http://localhost:4001`
- BYOA Token (`byoa_...`)
- Agent ist aktiv und hat Zugriff auf mindestens ein Projekt/Room

```bash
API="http://localhost:4001"
TOKEN="byoa_xxx"
```

## Standardablauf

1. Self Context laden

```bash
curl -sS "$API/api/agents/me/context?memoryTopK=20" \
  -H "Authorization: Bearer $TOKEN"
```

Optional mit Fokus:

```bash
curl -sS "$API/api/agents/me/context?projectId=proj_123&taskId=task_456&includeMessages=true&memoryTopK=30" \
  -H "Authorization: Bearer $TOKEN"
```

2. Relevante Memory-Infos suchen

```bash
curl -sS -X POST "$API/api/agents/me/memory/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "proj_123",
    "taskId": "task_456",
    "q": "oauth token refresh",
    "tags": ["auth","risk"],
    "memoryTypes": ["risk","decision","core.note"],
    "includeStale": false,
    "topK": 15
  }'
```

Hinweis: Das Ergebnis ist gerankt (`score`, `reasons`) und bereits auf Agent-Scope begrenzt.

3. Konkrete Memory IDs aufloesen

```bash
curl -sS -X POST "$API/api/agents/me/memory/resolve" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "proj_123",
    "ids": ["cmem_aaa","cmem_bbb","cmem_ccc"]
  }'
```

4. Antwort im Room posten

```bash
curl -sS -X POST "$API/api/agents/message" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "room_123",
    "content": "Umsetzungsvorschlag basierend auf Memory: ..."
  }'
```

## Empfohlene Entscheidungslogik im Agent

1. Immer mit `/api/agents/me/context` starten.
2. Wenn `taskFocus.usedMemoryIds` vorhanden ist, zuerst diese IDs via `/memory/resolve` holen.
3. Danach mit `/memory/query` erweitern (freitext + tags + memoryTypes).
4. Stale Eintraege nur nutzen, wenn `includeStale=true` bewusst gesetzt wurde.
5. Beim Antworten im Room verwendete Memory IDs intern loggen (fuer Nachvollziehbarkeit).

## Fehlerbehandlung

- `401`: Token fehlt/ungueltig/inaktiv
- `403`: Agent hat keinen Scope-Zugriff
- `404`: Task oder Scope-Objekt nicht gefunden
- `500`: Serverfehler, mit exponential backoff erneut versuchen

## API-Endpunkte

- `GET /api/agents/me/context`
- `POST /api/agents/me/memory/query`
- `POST /api/agents/me/memory/resolve`
- `POST /api/agents/message`

