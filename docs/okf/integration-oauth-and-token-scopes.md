---
type: module
title: Integration OAuth and token scopes, from the start route to each token consumer
description: The only OAuth start route is the per-user one; its in-memory state nonce carries the user to the callback under /api/admin, which honours it only for the browser that holds the flow's binding cookie and then stores a user-mode IntegrationToken keyed by provider and scope key (graph, jira). Every consumer reads the caller's own row (getTokenForUser, or resolveToken, which only delegates to it); no tenant-wide row is ever read and no current route writes one. The Microsoft refresh uses the tenant in the row's tenantId column. No code reads the teams scope key, Teams channel mappings live in memory, and nothing posts to Teams.
tags: [integrations, oauth, connectors, teams, sharepoint, jira]
timestamp: 2026-11-08T18:38:59Z
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

- **Start.** `GET /api/integrations/oauth/start` is the only route that begins a flow (`server/src/routes/integrations.ts:181#"oauth/start"`). The browser reaches it by navigation, which cannot send an `Authorization` header, and the session JWT is never accepted in the query (a `token` parameter is ignored and the request gets 401). The client first calls `POST /api/integrations/oauth/start-token` with the header (`server/src/routes/integrations.ts:149#"oauth/start-token"`) and navigates with the returned `st` token: bound to one user, one provider and one scope, valid for 120 seconds, single use, and verifiable only for this purpose (see [auth-and-authz-boundaries.md](auth-and-authz-boundaries.md)). Both routes end in `requireHuman`, which decides on the resolved `userType`, not on the header text: a `byoa_` agent token (with or without `Bearer`, which `authenticate` both accepts) and an agent user's own JWT resolve to a non-HUMAN user and get 403 (`server/src/routes/integrations.ts:149#"requireHuman"`, `server/src/routes/integrations.ts:181#"requireHuman"`). Before this change the header path of the start route also let agents through; that is now refused too. `authenticateOAuthStart` verifies `st` against the `provider` and `scope` of the request, marks it spent, and loads the user, refusing a missing or inactive one (`server/src/routes/integrations.ts:124#"claimOAuthStartToken"`, `server/src/routes/integrations.ts:130#"isActive"`); a request that does carry an `Authorization` header goes through `authenticate` instead and has no `st` to spend. `provider` must be `microsoft` or `atlassian` (`server/src/routes/integrations.ts:185#"Unknown provider"`); `scope` is any string and defaults to `default` (`server/src/routes/integrations.ts:95#"src.scope"`). The state it creates always has `mode` `user` (`server/src/routes/integrations.ts:193#"mode:"`).
- **Single-use `st`.** A spent `st` is kept in a module-level `Map` keyed by the full token string until the token's own expiry, and a replay gets the same 401 as an expired token (`server/src/services/integrationOAuth.ts:87-97#"usedOAuthStartTokens.set("`). Mints for the same user, provider and scope inside one second are byte-identical, so a double click inside that second counts as a replay and the second start is refused; the user starts again from the page. Like the nonce map this is process memory: after a restart, or on a second API instance, a spent token can be used again until it expires.
- **Browser binding.** The state alone does not say which browser completes the flow: an attacker who starts a flow under their own account and stops at the provider's authorize page could hand that URL to a victim, whose consent would then store the victim's provider tokens under the attacker's user. So the start route also hands the initiating browser a random secret as the cookie `oauth_bind_<nonce>` (HttpOnly, SameSite=Lax, host-only without `Domain`, `Max-Age` 600 seconds, `Path` the pathname of the redirect URI of that provider, so it follows the `*_REDIRECT_URI` override; `Secure` exactly when `APP_URL` starts with `https:`, because `req.secure` is false behind the Traefik and nginx chain) and the nonce entry keeps only its SHA-256 (`server/src/services/integrationOAuth.ts:139-150#"res.cookie("`, `server/src/services/integrationOAuth.ts:115-124#"httpOnly: true"`, `server/src/routes/integrations.ts:197#"setOAuthBindingCookie("`). The name carries the nonce, so two flows in two tabs do not overwrite each other. Because the cookie is host-only and the provider sends the browser back to the host of the redirect URI, a start on another host (www versus apex, see [HTTPS-SETUP.md](../HTTPS-SETUP.md)) first answers 302 to the same path and query on the configured redirect-URI origin, and only that request sets the cookie; the target comes from configuration, never from request headers, only the host name is compared (cookies ignore port and scheme), the redirect happens before `st` is spent, and a deployment whose proxy rewrites `Host` so that it never equals the redirect-URI host would redirect forever (`server/src/routes/integrations.ts:165-179#"startOnRedirectHost"`). The binding does not cover a victim who opens the triologue start URL with the attacker's `st` itself: `st` travels in the URL, so the window for that is its single use inside 120 seconds.
- **State nonce.** `createOAuthState` stores `{ provider, scope, userId, mode, targetPath, bindingHash }` under a random nonce in a module-level `Map` (`server/src/services/integrationOAuth.ts:25#"new Map"`, `server/src/services/integrationOAuth.ts:60#"oauthNonces.set(nonce"`) and sends only provider, scope and nonce to the provider, base64url-encoded (`server/src/services/integrationOAuth.ts:72#"base64url"`). A sweep every minute drops entries older than ten minutes and spent `st` tokens past their expiry (`server/src/services/integrationOAuth.ts:33-46#"setInterval(() => sweepOAuthState()"`); `consumeOAuthState` itself does not compare the age, so an entry lives between ten and eleven minutes. The nonce is single use: it is deleted on the first lookup, before the binding is checked, so a refused callback cannot be retried with the right cookie, and a provider or scope mismatch then fails (`server/src/services/integrationOAuth.ts:211#"oauthNonces.delete(parts.nonce)"`, `server/src/services/integrationOAuth.ts:213#"nonceData.provider !== parts.provider"`). Because the map is process memory, a restart or a second API instance between start and callback ends in `invalid_state`.
- **Callback.** `GET /api/admin/integrations/oauth/callback` has no `authenticate` middleware; the user comes from the nonce, and the nonce is honoured only for the browser that holds its cookie (`server/src/routes/admin.ts:351#"integrations/oauth/callback"`, `server/src/routes/admin.ts:361-362#"invalid_state"`). `consumeOAuthState` hashes the presented cookie and compares it with the stored hash in constant time; a missing, empty or wrong cookie, and the cookie of another flow, give the same `invalid_state` redirect as an unknown nonce, with nothing stored and nothing sent to the provider (`server/src/services/integrationOAuth.ts:197-232#"crypto.timingSafeEqual("`). The callback expires the cookie (same name, path and attributes) before it decides anything, so every redirect it sends, success or error, carries the clearing header, and it marks the response `no-store` (`server/src/routes/admin.ts:356#"clearOAuthBindingCookie(res, state)"`). It then exchanges the code and calls `storeToken` with `userId` set to the nonce's user when `mode` is `user`, and `null` otherwise (`server/src/routes/admin.ts:388-393#"nonceData.mode === 'user'"`, `server/src/routes/admin.ts:442-447#"nonceData.mode === 'user'"`). Since no start route creates `admin` mode, every token the callback stores today is a personal one. The tenant-wide start route was removed together with the admin connector UI; the `admin` branch of `OAuthMode` is what remains of it. On a failed token exchange the redirect still carries the first 200 characters of the provider's answer in `detail`.
- **Redirect URI.** Both legs and the cookie `Path` use `MICROSOFT_REDIRECT_URI` / `ATLASSIAN_REDIRECT_URI`, falling back to `${APP_URL}/api/admin/integrations/oauth/callback`, through one function (`server/src/services/integrationOAuth.ts:102-109#"/api/admin/integrations/oauth/callback"`). Which input wins: the override, when set, decides the cookie `Path`, the host the start must run on and the origin of the host redirect; `Secure` comes from `APP_URL` alone; the request host decides only whether the redirect happens.

## How a token row is keyed

`storeToken` writes one `IntegrationToken` per `(provider, scope, tenantId, userId)`: a personal token goes through `upsert` on that unique key (`server/src/services/tokenManager.ts:188-189#"provider_scope_tenantId_userId"`); a tenant-wide token (`userId` null) uses a serializable find-then-write, because Postgres treats NULLs as distinct in the unique index (`server/src/services/tokenManager.ts:138#"if (userId === null)"`). `tenantId` defaults to `default` (`server/src/services/tokenManager.ts:114#"tokens.tenantId || 'default'"`) and is set by the callback:

- Microsoft: `MICROSOFT_TENANT_ID`, or `common` (`server/src/routes/admin.ts:370#"MICROSOFT_TENANT_ID"`).
- Atlassian: the `id` (cloudId) of the first site in `accessible-resources`, or `default` when that call fails (`server/src/routes/admin.ts:433-435#"resources[0].id"`). Jira actions take `cloudId` as an input in their URL template (`server/src/connectors/definitions/jira.yaml:19#"{{cloudId}}"`), so the stored value does not pick the site a request goes to.

No reader passes a `tenantId`, so lookups ignore it and take the caller's newest matching row (`server/src/services/tokenManager.ts:202-203#"orderBy: { createdAt: 'desc' }"`).

## Scope keys

The scope key is a free string that ties a connector definition to its token rows; the OAuth scopes sent to the provider are hard-coded per key in `buildOAuthAuthorizeUrl`:

| Key | Used by | Provider scopes requested |
|---|---|---|
| `graph` | `sharepoint.yaml` (`server/src/connectors/definitions/sharepoint.yaml:9-10#"scope: graph"`), `userFiles.ts` | `Files.ReadWrite.All Sites.Read.All offline_access` (`server/src/services/integrationOAuth.ts:250#"Files.ReadWrite.All Sites.Read.All offline_access"`) |
| `jira` | `jira.yaml` (`server/src/connectors/definitions/jira.yaml:9-10#"scope: jira"`) | `read:jira-work write:jira-work offline_access` (`server/src/services/integrationOAuth.ts:261#"read:jira-work write:jira-work offline_access"`) |
| `teams` | no reader | `Team.ReadBasic.All ChannelMessage.Read.All ChannelMessage.Send offline_access` (`server/src/services/integrationOAuth.ts:249#"ChannelMessage.Send"`) |

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
    start["GET /api/integrations/oauth/start?st<br/>mode user"] --> cb["GET /api/admin/integrations/oauth/callback"]
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
- The connections listing reports a connector from the user's own row only (`server/src/routes/integrations.ts:28-33#"item.userId === userId"`): its `status` and `expiresAt` give `connected`, `expiring`, `expired` or `error`, and `connectionScope` is `user`. A tenant-wide row (`userId` null) is ignored, so a connector with only such a row is `disconnected` with no `connectionScope`; the response has no global-fallback field. The personal token check uses `getTokenForUser` (`server/src/routes/integrations.ts:57#"getTokenForUser("`).
- A user revokes only their own rows: `DELETE /api/integrations/by-id/:id` answers 404 unless the row's `userId` is the caller, and sets `status` `revoked` (`server/src/routes/integrations.ts:213#"Integration not found"`, `server/src/routes/integrations.ts:218#"data: { status:"`).

## Refresh

`getTokenForUser` refreshes an expired row inline, and `refreshExpiring` refreshes active rows that expire within ten minutes (see [secrets-and-encryption-keys.md](secrets-and-encryption-keys.md)). A failed refresh sets `status` `error` and adds `error` and `errorAt` to the metadata the row already has (`server/src/services/tokenManager.ts:312-313#"...base"`). The Microsoft refresh handler uses the tenant in the row's `tenantId` column, and `common` when the column is empty or holds the `default` placeholder (`server/src/services/tokenManager.ts:324#"token.tenantId !== 'default'"`); the callback stores the tenant there (`server/src/routes/admin.ts:392#"tenantId,"`), so a single-tenant app registration refreshes against its own tenant.

## Teams

- The webhook `POST /api/teams/webhook` answers 503 while `TEAMS_BOT_SECRET` is unset and 401 unless the bearer equals it, compared in constant time (`server/src/integrations/teams/teamsBot.ts:33-36#"Webhook not configured"`, `server/src/integrations/teams/teamsBot.ts:25-29#"crypto.timingSafeEqual(presented, expected)"`).
- Channel-to-room mappings are set by admins through `/api/teams/mappings` and kept in a module-level `Map`, as is the Teams-user cache (`server/src/integrations/teams/teamsBot.ts:85#"requireAdmin"`, `server/src/integrations/teams/teamsMapping.ts:15-16#"const userMappings = new Map"`). A restart drops every mapping, after which inbound messages are logged and dropped (`server/src/integrations/teams/teamsSync.ts:11-13#"No mapping for Teams channel"`).
- An inbound sender without a user gets a `HUMAN` guest user named `teams_` plus the first 12 characters of the Teams user id, with `canTriggerAI` true (`server/src/integrations/teams/teamsMapping.ts:49-55#"canTriggerAI: true"`).
- Nothing posts to Teams. `POST /api/agents/message` used to call a Teams send for every agent message, which read a tenant-wide `graph` token that no route writes and that was requested without `ChannelMessage.Send`; the call and the tenant-wide readers behind it were removed. Only the `teams` scope key requests `ChannelMessage.Send`, and no connector definition uses that key.

## What breaks it

- Adding `authenticate` to the callback: the provider redirect carries no `Authorization` header; the nonce is the binding to the user, and the cookie binds the nonce to the browser.
- Dropping the cookie check, changing the cookie `Path`, `SameSite` or host scope, or serving the start on a host other than the redirect URI's without the redirect: the callback then refuses every flow, or accepts one that another browser started.
- Running more than one API instance, or restarting between start and callback: the nonce map is per process.
- Adding a connector with a new scope key without adding its provider scopes to `buildOAuthAuthorizeUrl`: Microsoft keys other than `teams` get the SharePoint scopes, and every Atlassian key gets the Jira scopes.
- Expecting a tenant-wide token to be used: no current route creates one, and no lookup reads a row whose `userId` is null.
