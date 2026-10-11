# Atlassian (Jira) App Registration Guide

> **TL;DR:** Step-by-step Atlassian Developer Console OAuth 2.0 app registration for connecting Triologue to Jira. Callback URL is `${APP_URL}/api/admin/integrations/oauth/callback`. Required scopes: `read:jira-work`, `write:jira-work`, `offline_access`. Set `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET`, `ATLASSIAN_REDIRECT_URI` in `.env`.

To let Triologue connect to Jira, you need an OAuth 2.0 app in the Atlassian Developer Console.

**Time required:** about 5 minutes
**Prerequisite:** admin access to the Atlassian/Jira instance

---

## Step 1: Create the app

1. Open https://developer.atlassian.com/console/myapps/
2. Click **"Create"**, then **"OAuth 2.0 integration"**
3. **Name:** `OpenTriologue`
4. Accept the terms and click **"Create"**

---

## Step 2: Configure permissions

1. In the app, in the left sidebar, click **"Permissions"**
2. Next to **"Jira API"**, click **"Add"** or **"Configure"**
3. Enable the following scopes:
   - **Classic Scopes:**
     - `read:jira-work`: read issues, projects, and boards
     - `write:jira-work`: create issues, edit them, change status
     - `offline_access`: receive a refresh token (required for auto-refresh, otherwise access stops working once the access token expires)

---

## Step 3: Set the callback URL

1. In the left sidebar, click **"Authorization"**
2. Next to **"OAuth 2.0 (3LO)"**, click **"Configure"** or **"Add"**
3. **Callback URL:** `https://<your-host>/api/admin/integrations/oauth/callback`
4. Save

This URL must equal `ATLASSIAN_REDIRECT_URI` exactly; when that is unset, Triologue uses `${APP_URL}/api/admin/integrations/oauth/callback`.

---

## Step 4: Copy client credentials

1. In the left sidebar, click **"Settings"**
2. There you will find:
   - **Client ID**
   - **Secret** (click "Show" or "Create" if none exists yet)

---

## Step 5: Configure Triologue

Set these three values in `.env`:
```env
ATLASSIAN_CLIENT_ID=<Client ID>
ATLASSIAN_CLIENT_SECRET=<Client Secret>
ATLASSIAN_REDIRECT_URI=https://<your-host>/api/admin/integrations/oauth/callback
```

Then restart the API and connect from Settings (see Step 6).

---

## Step 6: Connect

Sign in as a human user, open Settings, Connections (`/settings/connections`) and click Connect on the Jira connector. After consent you return to `/settings/connections?success=1`. Triologue connects the first Jira site the account can access. The round trip is shown in [Azure app registration, Step 5](AZURE_APP_REGISTRATION.md#step-5-connect).

---

## Troubleshooting

**"Invalid redirect URI"**
The callback URL does not match exactly. No trailing slash, no http instead of https.

**"Scope not granted"**
The Jira API scopes were not enabled under Permissions. Go back to Step 2.

**"Consumer key is not registered"**
The app is still in Draft status. Switch it to "Sharing" under "Distribution" (internal-only use is fine with that setting).

**`/admin?error=invalid_state`**
The API restarted, another API instance served the callback, or more than about 10 minutes passed between Connect and the callback. The state is kept in the memory of one API process; start again with a single API instance.

**`/admin?error=token_exchange_failed`**
The client secret or the redirect URI does not match; the `detail` parameter carries the start of Atlassian's answer.

**`500 Atlassian OAuth not configured`**
`ATLASSIAN_CLIENT_ID` is unset.
