---
type: module
title: Integration OAuth and token scopes, from the start route to each token consumer
description: The only OAuth start route is the per-user one; its in-memory state nonce carries the user to the callback under /api/admin, which stores a user-mode IntegrationToken keyed by provider and scope key (graph, jira). Every consumer reads the caller's own row (getTokenForUser, or resolveToken, which only delegates to it); no tenant-wide row is ever read and no current route writes one. The Microsoft refresh uses the tenant in the row's tenantId column. No code reads the teams scope key, Teams channel mappings live in memory, and nothing posts to Teams.
tags: [integrations, oauth, connectors, teams, sharepoint, jira]
timestamp: 2026-10-15T12:08:17Z
sources:
  - server/src/services/integrationOAuth.ts
  - server/src/routes/integrations.ts
  - server/src/routes/admin.ts
  - server/src/services/tokenManager.ts
  - server/src/services/actionRegistry.ts
  - server/src/connectors/proxy.ts
  - server/src/connectors/registry.ts
  - server/src/connectors/types.ts
  - server/src/connectors/definitions/sharepoint.yaml
  - server/src/connectors/definitions/jira.yaml
  - server/src/integrations/teams/teamsBot.ts
  - server/src/integrations/teams/teamsSync.ts
  - server/src/integrations/teams/teamsMapping.ts
  - server/src/routes/agents.ts
  - server/src/routes/userFiles.ts
---

# Integration OAuth and token scopes

The provider-side setup (app registration, redirect URI, consent) is in [AZURE_APP_REGISTRATION.md](../AZURE_APP_REGISTRATION.md) and [ATLASSIAN_APP_REGISTRATION.md](../ATLASSIAN_APP_REGISTRATION.md); only the Azure guide carries a sequence diagram of the round trip. This doc covers what the server keeps between the two legs, how a token row is keyed, and which code reads which rows. How the tokens are encrypted is in [secrets-and-encryption-keys.md](secrets-and-encryption-keys.md).

## Start and callback

- **Start.** `GET /api/integrations/oauth/start` is the only route that begins a flow (`server/src/routes/integrations.ts:96#"oauth/start"`). The browser reaches it by navigation, so a `token` query parameter is promoted to the `Authorization` header, and a `byoa_` agent token there is refused (`server/src/routes/integrations.ts:88-90#"Agent tokens cannot start an OAuth flow"`). `provider` must be `microsoft` or `atlassian` (`server/src/routes/integrations.ts:102-103#"Unknown provider"`); `scope` is any string and defaults to `default` (`server/src/routes/integrations.ts:100#"req.query.scope"`). The state it creates always has `mode` `user` (`server/src/routes/integrations.ts:107-111#"mode:"`).
- **State nonce.** `createOAuthState` stores `{ provider, scope, userId, mode, targetPath }` under a random nonce in a module-level `Map` (`server/src/services/integrationOAuth.ts:15#"new Map"`, `server/src/services/integrationOAuth.ts:36-37#"oauthNonces.set(nonce"`) and sends only provider, scope and nonce to the provider, base64url-encoded (`server/src/services/integrationOAuth.ts:42-48#"base64url"`). A sweep every minute drops entries older than ten minutes (`server/src/services/integrationOAuth.ts:17-24#"}, 60 * 1000)"`); `consumeOAuthState` itself does not compare the age, so an entry lives between ten and eleven minutes. The nonce is single use: it is deleted on the first lookup, and a provider or scope mismatch then fails (`server/src/services/integrationOAuth.ts:61-66#"oauthNonces.delete(nonce)"`, `server/src/services/integrationOAuth.ts:68#"nonceData.provider !== provider"`). Because the map is process memory, a restart or a second API instance between start and callback ends in `invalid_state`.
- **Callback.** `GET /api/admin/integrations/oauth/callback` has no `authenticate` middleware; the user comes from the nonce (`server/src/routes/admin.ts:351#"integrations/oauth/callback"`, `server/src/routes/admin.ts:356-357#"invalid_state"`). It exchanges the code and calls `storeToken` with `userId` set to the nonce's user when `mode` is `user`, and `null` otherwise (`server/src/routes/admin.ts:383-388#"nonceData.mode === 'user'"`, `server/src/routes/admin.ts:437-442#"nonceData.mode === 'user'"`). Since no start route creates `admin` mode, every token the callback stores today is a personal one. The tenant-wide start route was removed together with the admin connector UI; the `admin` branch of `OAuthMode` is what remains of it.
- **Redirect URI.** Both legs use `MICROSOFT_REDIRECT_URI` / `ATLASSIAN_REDIRECT_URI`, falling back to `${APP_URL}/api/admin/integrations/oauth/callback` (`server/src/services/integrationOAuth.ts:91-93#"/api/admin/integrations/oauth/callback"`).

## How a token row is keyed

`storeToken` writes one `IntegrationToken` per `(provider, scope, tenantId, userId)`: a personal token goes through `upsert` on that unique key (`server/src/services/tokenManager.ts:188-189#"provider_scope_tenantId_userId"`); a tenant-wide token (`userId` null) uses a serializable find-then-write, because Postgres treats NULLs as distinct in the unique index (`server/src/services/tokenManager.ts:138#"if (userId === null)"`). `tenantId` defaults to `default` (`server/src/services/tokenManager.ts:114#"tokens.tenantId || 'default'"`) and is set by the callback:

- Microsoft: `MICROSOFT_TENANT_ID`, or `common` (`server/src/routes/admin.ts:365#"MICROSOFT_TENANT_ID"`).
- Atlassian: the `id` (cloudId) of the first site in `accessible-resources`, or `default` when that call fails (`server/src/routes/admin.ts:428-430#"resources[0].id"`). Jira actions take `cloudId` as an input in their URL template (`server/src/connectors/definitions/jira.yaml:19#"{{cloudId}}"`), so the stored value does not pick the site a request goes to.

No reader passes a `tenantId`, so lookups ignore it and take the caller's newest matching row (`server/src/services/tokenManager.ts:202-203#"orderBy: { createdAt: 'desc' }"`).

## Scope keys

The scope key is a free string that ties a connector definition to its token rows; the OAuth scopes sent to the provider are hard-coded per key in `buildOAuthAuthorizeUrl`:

| Key | Used by | Provider scopes requested |
|---|---|---|
| `graph` | `sharepoint.yaml` (`server/src/connectors/definitions/sharepoint.yaml:9-10#"scope: graph"`), `userFiles.ts` | `Files.ReadWrite.All Sites.Read.All offline_access` (`server/src/services/integrationOAuth.ts:94-97#"Files.ReadWrite.All Sites.Read.All offline_access"`) |
| `jira` | `jira.yaml` (`server/src/connectors/definitions/jira.yaml:9-10#"scope: jira"`) | `read:jira-work write:jira-work offline_access` (`server/src/services/integrationOAuth.ts:110#"read:jira-work write:jira-work offline_access"`) |
| `teams` | no reader | `Team.ReadBasic.All ChannelMessage.Read.All ChannelMessage.Send offline_access` (`server/src/services/integrationOAuth.ts:94-96#"ChannelMessage.Send"`) |

Every Atlassian start requests the Jira scopes whatever the key. A connector YAML carries no scope list: the `requiredScopes` field it used to declare was read by no code and is gone, so the requested scopes live only in `buildOAuthAuthorizeUrl`.

## Who reads which rows

`getTokenForUser` reads only the caller's rows (`server/src/services/tokenManager.ts:202#"where: { provider, scope, userId,"`). `resolveToken` returns that token when it has a `userId` and null otherwise; it has no tenant-wide fallback (`server/src/services/tokenManager.ts:227-228#"return getTokenForUser(provider, scope, userId, tenantId)"`). No code reads a row whose `userId` is null, and no current route writes one, so the chart has a single row set.

```mermaid
flowchart TD
  subgraph consumers["Token consumers"]
    list["GET /api/integrations/connectors"]
    proxy["connectors/proxy.ts,<br/>services/actionRegistry.ts"]
    files["routes/userFiles.ts<br/>SharePoint files"]
  end
  subgraph lookups["tokenManager lookups"]
    rt["resolveToken"]
    gtu["getTokenForUser"]
  end
  subgraph rows["integration_tokens"]
    personal[("rows with userId")]
  end
  subgraph write["OAuth write path"]
    start["GET /api/integrations/oauth/start<br/>mode user"] --> cb["GET /api/admin/integrations/oauth/callback"]
    cb --> store["tokenManager.storeToken"]
  end
  list --> gtu
  proxy --> rt
  files --> gtu
  rt --> gtu
  gtu --> personal
  store --> personal
```

- File browsing uses only the personal token (`server/src/routes/userFiles.ts:87-88#"getTokenForUser("`).
- Connector calls resolve for the task creator (`server/src/connectors/proxy.ts:258-263#"taskCreatorId,"`), and the action lists built for agents resolve for the task creator or the user (`server/src/services/actionRegistry.ts:129-132#"taskCreatedBy,"`, `server/src/services/actionRegistry.ts:173-176#"userId,"`).
- The connections listing reports a connector from the user's own row only (`server/src/routes/integrations.ts:21-26#"item.userId === userId"`): its `status` and `expiresAt` give `connected`, `expiring`, `expired` or `error`, and `connectionScope` is `user`. A tenant-wide row (`userId` null) is ignored, so a connector with only such a row is `disconnected` with no `connectionScope`; the response has no global-fallback field. The personal token check uses `getTokenForUser` (`server/src/routes/integrations.ts:50#"getTokenForUser("`).
- A user revokes only their own rows: `DELETE /api/integrations/by-id/:id` answers 404 unless the row's `userId` is the caller, and sets `status` `revoked` (`server/src/routes/integrations.ts:128-129#"Integration not found"`, `server/src/routes/integrations.ts:133-134#"data: { status:"`).

## Refresh

`getTokenForUser` refreshes an expired row inline, and `refreshExpiring` refreshes active rows that expire within ten minutes (see [secrets-and-encryption-keys.md](secrets-and-encryption-keys.md)). A failed refresh sets `status` `error` and adds `error` and `errorAt` to the metadata the row already has (`server/src/services/tokenManager.ts:312-313#"...base"`). The Microsoft refresh handler uses the tenant in the row's `tenantId` column, and `common` when the column is empty or holds the `default` placeholder (`server/src/services/tokenManager.ts:324#"token.tenantId !== 'default'"`); the callback stores the tenant there (`server/src/routes/admin.ts:387#"tenantId,"`), so a single-tenant app registration refreshes against its own tenant.

## Teams

- The webhook `POST /api/teams/webhook` answers 503 while `TEAMS_BOT_SECRET` is unset and 401 unless the bearer equals it, compared in constant time (`server/src/integrations/teams/teamsBot.ts:33-36#"Webhook not configured"`, `server/src/integrations/teams/teamsBot.ts:25-29#"crypto.timingSafeEqual(presented, expected)"`).
- Channel-to-room mappings are set by admins through `/api/teams/mappings` and kept in a module-level `Map`, as is the Teams-user cache (`server/src/integrations/teams/teamsBot.ts:85#"requireAdmin"`, `server/src/integrations/teams/teamsMapping.ts:15-16#"const userMappings = new Map"`). A restart drops every mapping, after which inbound messages are logged and dropped (`server/src/integrations/teams/teamsSync.ts:11-13#"No mapping for Teams channel"`).
- An inbound sender without a user gets a `HUMAN` guest user named `teams_` plus the first 12 characters of the Teams user id, with `canTriggerAI` true (`server/src/integrations/teams/teamsMapping.ts:49-55#"canTriggerAI: true"`).
- Nothing posts to Teams. `POST /api/agents/message` used to call a Teams send for every agent message, which read a tenant-wide `graph` token that no route writes and that was requested without `ChannelMessage.Send`; the call and the tenant-wide readers behind it were removed. Only the `teams` scope key requests `ChannelMessage.Send`, and no connector definition uses that key.

## What breaks it

- Adding `authenticate` to the callback: the provider redirect carries no `Authorization` header; the nonce is the binding to the user.
- Running more than one API instance, or restarting between start and callback: the nonce map is per process.
- Adding a connector with a new scope key without adding its provider scopes to `buildOAuthAuthorizeUrl`: Microsoft keys other than `teams` get the SharePoint scopes, and every Atlassian key gets the Jira scopes.
- Expecting a tenant-wide token to be used: no current route creates one, and no lookup reads a row whose `userId` is null.
