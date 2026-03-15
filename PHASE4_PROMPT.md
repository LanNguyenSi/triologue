# Phase 4 — Connector UI

## Kontext

Triologue ist eine AI-Agent-Plattform. Phase 1-3 sind deployed:
- Phase 1: Agent-Infrastruktur (Task Runtime Context, Audit Trail, Message Hygiene)
- Phase 2: Workflow (Reviewer, Notifications, Agent Config UI)
- Phase 3: Connector Backend (OAuth Token Management, Connector Framework mit YAML-Definitionen, SharePoint/Jira Plugins, MS Teams Channel, MCP Bridge)

Phase 3 ist Backend-only — es gibt keine UI zum Verbinden von Connectoren. Das ist Phase 4.

## Aufgabe

Implementiere Phase 4 in 4 Feature-Branches. Jeder Branch basiert auf `master`.

## Feedback aus Phase 1-3 (BITTE BEACHTEN)

1. **Branch-Hygiene:** Jeder Branch darf NUR seinen eigenen Task enthalten. Keine Cross-Commits. Wenn 4.1 von 4.0 abhängt, bau 4.1 auf 4.0 auf — aber pack nicht 4.1-Code in den 4.0-Branch.
2. **Prisma Migrations:** Migrations vor dem PR lokal testen (`npx prisma migrate deploy` gegen frische DB). Phase 1-3 hatte fehlgeschlagene Migrations.
3. **Keine Formatter-Änderungen:** Keine Quote-Style-Änderungen (single→double) in bestehenden Dateien. Nur eigenen neuen Code formatieren.
4. **Umlaute:** Deutsche Texte in der UI mit echten Umlauten (ä, ö, ü, ß), nicht ASCII-Ersetzungen (ae, oe, ue).
5. **API Base URL:** Verwende `import.meta.env.VITE_API_URL || ""` für API_BASE, dann `/api/...` — kein `localhost:3001`.

## Bestehender Code (wichtig)

### Backend — bereits vorhanden:

**`server/src/services/tokenManager.ts`** (Phase 3.0):
- `storeToken(provider, scope, tokens, createdBy)` — AES-256-GCM verschlüsselt
- `getToken(provider, scope, tenantId?)` — dekryptiert, auto-refresh
- `revokeToken(provider, scope, tenantId?)` — setzt status auf "revoked"
- `listIntegrations()` — gibt alle Tokens zurück (ohne Secrets)
- `refreshExpiring()` — refresht Tokens die in <10min ablaufen
- `startAutoRefresh()` — 5min Interval, läuft bereits

**`server/src/connectors/registry.ts`** (Phase 3.1):
- `loadDefinitions(dir)` — lädt YAML-Dateien
- `getConnector(id)` — gibt ConnectorDefinition zurück
- `listConnectors()` — alle definierten Connectoren
- `listActiveConnectors()` — nur Connectoren mit gültigem Token

**`server/src/connectors/proxy.ts`** (Phase 3.1):
- `POST /api/connectors/:connectorId/actions/:actionId` — Proxy für Agent-Requests
- Prüft Agent-Auth, Permission, holt Token, proxied Request

**`server/src/connectors/definitions/sharepoint.yaml`** und **`jira.yaml`**:
- YAML-basierte Connector-Definitionen mit Actions

**`server/src/connectors/mcp/mcpBridge.ts`** (Phase 3.5):
- `discoverTools(connectionId)` — JSON-RPC tools/list
- `callTool(connectionId, toolName, args)` — JSON-RPC tools/call
- `getActiveConnections()` — alle aktiven MCP-Verbindungen

**`server/src/routes/admin.ts`** (Phase 3.0+3.5):
- `GET /api/admin/integrations` — Token-Liste
- `DELETE /api/admin/integrations/:id` — Token löschen
- MCP Connection CRUD Endpoints

**Prisma Models:**
- `IntegrationToken` — provider, scope, accessToken (encrypted), refreshToken, expiresAt, tenantId, status
- `ConnectorPermission` — connectorId, userId, allowedActions[]
- `McpConnection` — name, url, apiKey, status, discoveredTools

### Env-Variablen (bereits konfiguriert):
```
MICROSOFT_CLIENT_ID=8cec5071-958a-4575-8f09-c7aa717a4066
MICROSOFT_CLIENT_SECRET=<configured>
MICROSOFT_TENANT_ID=0ef4aeda-da91-488a-99cf-bce9701fb4ba
MICROSOFT_REDIRECT_URI=https://opentriologue.ai/api/admin/integrations/oauth/callback
INTEGRATION_ENCRYPTION_KEY=<configured>
```

## Task 4.0: OAuth Flow UI (Branch: `feature/4.0-oauth-flow-ui`)

**Backend:**
1. `GET /api/admin/integrations/oauth/start?provider=microsoft&scope=graph` — baut Auth-URL, redirect zu Microsoft Login
2. `GET /api/admin/integrations/oauth/callback?code=...&state=...` — tauscht Code gegen Token, speichert via `storeToken()`, redirect zu `/admin/connectors?success=1`
3. `state` Parameter: `JSON.stringify({provider, scope, nonce})` base64-encoded, nonce in Session/Memory für CSRF-Check

**Microsoft Auth URL:**
```
https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize?
  client_id={clientId}&
  response_type=code&
  redirect_uri={redirectUri}&
  scope=Files.ReadWrite.All Sites.Read.All offline_access&
  state={state}
```

**Token Exchange:**
```
POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
  grant_type=authorization_code&
  code={code}&
  client_id={clientId}&
  client_secret={clientSecret}&
  redirect_uri={redirectUri}
```

**Frontend — `ConnectorAdminPage.tsx`:**
- Route: `/admin/connectors`
- Ruft `GET /api/admin/integrations` + `GET /api/connectors` (neuer Endpoint, gibt listConnectors() zurück)
- Zeigt Cards pro Connector: Name, Kategorie, Status-Badge (grün/gelb/rot/grau), "Verbinden"/"Trennen" Button
- "Verbinden" → `window.location.href = /api/admin/integrations/oauth/start?provider=...&scope=...`
- "Trennen" → `DELETE /api/admin/integrations/:id` + reload
- Link in AdminPage unter "Agents" Abschnitt

**Frontend — `connectorApi.ts`:**
- `fetchConnectors(token)` — Liste aller Connectoren mit Status
- `fetchIntegrations(token)` — Liste aller aktiven Tokens
- `revokeIntegration(id, token)` — Token revoken

**Neuer Backend-Endpoint:**
- `GET /api/admin/connectors` — gibt `listConnectors()` zurück + Status pro Connector (verbunden/nicht/expired)

## Task 4.1: Connector Permissions UI (Branch: `feature/4.1-connector-permission-ui`, basiert auf 4.0)

- Erweitert `AgentConfigPage.tsx` (existiert, Phase 2.5)
- Neuer Abschnitt "Connector-Zugriff" unter bestehenden Config-Feldern
- Toggle pro Connector, Checkboxen pro Action
- `GET/PUT /api/agents/:agentTokenId/permissions` — CRUD
- `actionRegistry.ts` erweitern: nur erlaubte Connector-Actions zurückgeben

## Task 4.2: MCP Connection UI (Branch: `feature/4.2-mcp-connection-ui`, basiert auf 4.0)

- Erweitert `ConnectorAdminPage.tsx` mit "Custom Connectors (MCP)" Abschnitt
- Formular: Name, URL, API Key (optional)
- "Verbinden & Tools entdecken" → `POST /api/admin/mcp/connections` + `POST .../discover`
- Liste: Name, Status, entdeckte Tools, "Löschen" Button
- API Key wird nur als "***" angezeigt

## Task 4.3: Connector Test Console (Branch: `feature/4.3-connector-test-ui`, basiert auf 4.0)

- Neue Seite: `/admin/connectors/:connectorId/test`
- Action-Dropdown, dynamisches Input-Formular aus YAML-Schema
- "Ausführen" → `POST /api/admin/connectors/:connectorId/test/:actionId` (neuer Admin-Proxy ohne Permission-Check)
- Response: Status Code, JSON pretty-print, Dauer (ms)
- Link auf ConnectorAdminPage pro Connector

## Reihenfolge

4.0 zuerst (Basis-Seite + OAuth Flow). Danach 4.1, 4.2, 4.3 beliebig — alle basieren auf 4.0.

## PR-Workflow

Erstelle pro Task einen Feature-Branch und öffne einen PR gegen `master`. Ice reviewed und merged.
