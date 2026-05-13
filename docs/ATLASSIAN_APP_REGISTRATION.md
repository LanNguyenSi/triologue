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
3. **Callback URL:** `https://opentriologue.ai/api/admin/integrations/oauth/callback`
4. Save

---

## Step 4: Copy client credentials

1. In the left sidebar, click **"Settings"**
2. There you will find:
   - **Client ID**
   - **Secret** (click "Show" or "Create" if none exists yet)

---

## Step 5: Send the credentials

Send over:
- **Client ID**
- **Client Secret**

They go into `.env`:
```env
ATLASSIAN_CLIENT_ID=<Client ID>
ATLASSIAN_CLIENT_SECRET=<Client Secret>
ATLASSIAN_REDIRECT_URI=https://opentriologue.ai/api/admin/integrations/oauth/callback
```

---

## Troubleshooting

**"Invalid redirect URI"**
The callback URL does not match exactly. No trailing slash, no http instead of https.

**"Scope not granted"**
The Jira API scopes were not enabled under Permissions. Go back to Step 2.

**"Consumer key is not registered"**
The app is still in Draft status. Switch it to "Sharing" under "Distribution" (internal-only use is fine with that setting).
