---
type: invariant
title: Secrets and encryption keys, two keys for two kinds of stored credential
description: ENCRYPTION_KEY encrypts user and project secrets (AES-256-CBC, key salted per owner or project) and is required at startup; INTEGRATION_ENCRYPTION_KEY encrypts OAuth integration tokens (AES-256-GCM) and is optional until a connector is used. Stored user and project secrets are write-only through the API, and nothing in the server decrypts them.
tags: [secrets, encryption, configuration, integrations, security]
timestamp: 2026-10-15T11:44:56Z
sources:
  - server/src/utils/encryption.ts
  - server/src/routes/secrets.ts
  - server/src/routes/projects.ts
  - server/src/services/tokenManager.ts
  - server/src/utils/env-validation.ts
  - server/src/index.ts
  - server/prisma/schema.prisma
  - .env.example
  - server/.env.example
  - Makefile
---

# Secrets and encryption keys

## The invariant

Two environment variables encrypt two disjoint sets of stored credentials. Neither key ever encrypts the other's data, and the two use different ciphers, key derivations and ciphertext formats.

| | `ENCRYPTION_KEY` | `INTEGRATION_ENCRYPTION_KEY` |
|---|---|---|
| Encrypts | `UserSecret.encryptedValue` and `ProjectSecret.encryptedValue` | `IntegrationToken.accessToken` and `IntegrationToken.refreshToken` |
| Code | `server/src/utils/encryption.ts` | the private `encrypt`/`decrypt` in `server/src/services/tokenManager.ts` |
| Cipher | AES-256-CBC, random 16-byte IV | AES-256-GCM, random 12-byte IV, 16-byte auth tag |
| Key | SHA-256 of the key string plus a salt | SHA-256 of the key string |
| Stored format | `iv:ciphertext` (hex) | `iv:authTag:ciphertext` (hex) |
| At startup | required, the process exits when unset | optional, a warning when unset |
| Read back by the server | never | on every token lookup and refresh |

`ENCRYPTION_KEY` side: the cipher is fixed at `server/src/utils/encryption.ts:3#"aes-256-cbc"`, a missing key throws on every call (`server/src/utils/encryption.ts:5-8#"ENCRYPTION_KEY is not configured"`), the key is derived per call from the variable plus a salt (`server/src/utils/encryption.ts:13-14#"getEncryptionKey() + salt"`), and the output is `iv:ciphertext` (`server/src/utils/encryption.ts:15-18#"iv.toString('hex') + ':' + encrypted"`).

`INTEGRATION_ENCRYPTION_KEY` side: GCM with a 12-byte IV and 16-byte tag (`server/src/services/tokenManager.ts:6-8#"AUTH_TAG_LENGTH = 16"`), the key is the SHA-256 of the variable with no salt, and a missing key throws at first use (`server/src/services/tokenManager.ts:29-32#"createHash('sha256').update(key)"`). The output carries the auth tag between IV and ciphertext (`server/src/services/tokenManager.ts:35-41#"authTag.toString('hex')"`). `storeToken` encrypts both tokens before the write (`server/src/services/tokenManager.ts:119-120#"encrypt(tokens.refreshToken)"`).

## The salt binds a secret to its owner or project

`encryptSecret(value, salt)` mixes the salt into the key, so a ciphertext only decrypts with the same salt:

- User secrets (`/api/secrets`) use the owner's user id, on create and on update (`server/src/routes/secrets.ts:148#"encryptSecret(value, userId)"`, `server/src/routes/secrets.ts:219#"encryptSecret(value, userId)"`). Linking a user secret to a project (`projectId`) does not change the salt.
- Project secrets (`/api/projects/:id/secrets`) use the project id (`server/src/routes/projects.ts:2363#"encryptSecret(value, req.params.id)"`, `server/src/routes/projects.ts:2447#"encryptSecret(value, req.params.id)"`).

No route moves an existing ciphertext to another user or project; any future code that does must re-encrypt the value with the new salt.

## Stored secrets are write-only through the API

The API accepts a secret value on create and update and never returns it, in plaintext or encrypted form:

- Create and update responses strip `encryptedValue` (`server/src/routes/secrets.ts:160#"encryptedValue: _"`, `server/src/routes/projects.ts:2375#"encryptedValue: _"`).
- The list and single-secret reads build their response from an explicit field list without `encryptedValue` (`server/src/routes/secrets.ts:96-105#"updatedAt: s.updatedAt"`, `server/src/routes/secrets.ts:187-196#"updatedAt: secret.updatedAt"`, `server/src/routes/projects.ts:2405-2407#"name: s.name"`).
- `decryptSecret` has no caller in `server/src`; only `server/src/__tests__/encryption.test.ts` calls it (`rg -n 'decryptSecret' server/src`). The `lastUsedAt` and `lastUsedBy` columns of both secret tables are likewise never written in `server/src`.

So no running code path depends on reading a stored user or project secret back. A changed `ENCRYPTION_KEY` breaks no request today, but every value stored under the old key becomes permanently unreadable for any consumer added later.

The columns are plain strings in the schema (`server/prisma/schema.prisma:494-498#"encryptedValue String"` for `ProjectSecret`, `server/prisma/schema.prisma:529-533#"encryptedValue String"` for `UserSecret`, `server/prisma/schema.prisma:271-277#"refreshToken String?"` for `IntegrationToken`); the encryption happens only in the route and service code above. Other credential columns are outside both keys: `AgentToken.token` (`server/prisma/schema.prisma:241#"Secret bearer token"`), `AgentToken.webhookSecret` (`server/prisma/schema.prisma:253#"Per-agent webhook secret"`) and `McpConnection.apiKey` (`server/prisma/schema.prisma:310-315#"apiKey"`) are stored as given, so a database dump holds them in clear text.

## Startup and configuration

- `validateEnvironment()` runs at module load of `server/src/index.ts` (`server/src/index.ts:58#"validateEnvironment()"`). `ENCRYPTION_KEY` is in its required list (`server/src/utils/env-validation.ts:3-6#"'ENCRYPTION_KEY'"`), and a missing required variable exits the process (`server/src/utils/env-validation.ts:22-26#"process.exit(1)"`). `INTEGRATION_ENCRYPTION_KEY` is in the optional list (`server/src/utils/env-validation.ts:14-17#"'INTEGRATION_ENCRYPTION_KEY'"`), which only logs a warning (`server/src/utils/env-validation.ts:32-35#"(using default)"`).
- The check only tests that the variable is non-empty. Both example files ship a non-empty placeholder `ENCRYPTION_KEY` (`.env.example:12#"ENCRYPTION_KEY=your-32-byte"`, `server/.env.example:7-8#"ENCRYPTION_KEY="`), which passes it.
- `make local-env` appends a generated key only when `.env` has no `ENCRYPTION_KEY=` line at all (`Makefile:52-54#"ENCRYPTION_KEY=$$KEY"`). A `.env` copied from `.env.example` already has the placeholder line, so it keeps the placeholder.
- Both example files leave `INTEGRATION_ENCRYPTION_KEY` empty and say to keep it stable (`.env.example:54-58#"INTEGRATION_ENCRYPTION_KEY="`, `server/.env.example:28-32#"INTEGRATION_ENCRYPTION_KEY="`).
- `startAutoRefresh()` starts once the server listens (`server/src/index.ts:308#"startAutoRefresh()"`) and runs `refreshExpiring` every five minutes (`server/src/services/tokenManager.ts:382-386#"5 * 60 * 1000"`), which refreshes, and so decrypts the refresh token of, every active integration token that expires within ten minutes (`server/src/services/tokenManager.ts:366-368#"status: 'active', expiresAt"`); a row without a refresh token is marked `error` without a decrypt (`server/src/services/tokenManager.ts:269-270#"No refresh token available"`).

## What breaks it

- **Changing `INTEGRATION_ENCRYPTION_KEY`.** GCM decryption under a different key fails its tag check and throws. `getTokenForUser` does not catch it, so the request that needed the token fails. The auto-refresh catches it and marks the row `error` (`server/src/services/tokenManager.ts:296-298#"markError(token.id"`, `server/src/services/tokenManager.ts:312#"status: 'error'"`). The way back is to reconnect: the OAuth callback overwrites the user's row with tokens encrypted under the new key. Tenant-wide rows cannot be rewritten through the current routes (see [integration-oauth-and-token-scopes.md](integration-oauth-and-token-scopes.md)).
- **Leaving `INTEGRATION_ENCRYPTION_KEY` unset.** The server starts, and the first `storeToken` (the OAuth callback) or the first decrypt of an existing row throws `INTEGRATION_ENCRYPTION_KEY not configured`.
- **Changing `ENCRYPTION_KEY`.** Nothing fails at runtime today (see above), but stored user and project secrets can no longer be decrypted by anything.
- **Running with the placeholder `ENCRYPTION_KEY`.** The startup check passes, and secrets are encrypted under a published key. Replace it before storing real values (see [environment.md](../environment.md)).
- **Reusing `encryption.ts` for integration tokens, or `tokenManager`'s cipher for secrets.** The ciphers, key derivations and formats differ (two versus three hex parts), so neither decrypt can read the other's ciphertext.
