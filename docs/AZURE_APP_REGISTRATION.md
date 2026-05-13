# Microsoft Entra ID App Registration Guide

> **TL;DR:** Step-by-step Entra ID (formerly Azure AD) app registration for connecting Triologue to Microsoft Graph (SharePoint, Teams). Callback URL is `${APP_URL}/api/admin/integrations/oauth/callback`. Required scopes: `Files.ReadWrite.All`, `Sites.Read.All`, `offline_access` (SharePoint); `Team.ReadBasic.All`, `ChannelMessage.Read.All`, `ChannelMessage.Send`, `offline_access` (Teams). Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI` in `.env`.

To let Triologue connect to Microsoft services (SharePoint, Teams, Outlook), you need an App Registration in Microsoft Entra ID (formerly Azure AD). That is Triologue's "identity" towards Microsoft.

**Time required:** about 10 minutes
**Prerequisite:** admin access to entra.microsoft.com

---

## Step 1: Create the app registration

1. Open https://entra.microsoft.com
2. In the left sidebar, go to **Entra ID**, then **App registrations**
3. Click **"New registration"**

**Fill in:**
- **Name:** `OpenTriologue`
- **Supported account types:** `Accounts in this organizational directory only` (Single tenant)
  - Use multi-tenant only if other organisations should also connect
- **Redirect URI:**
  - Platform: **Web**
  - URI: `https://opentriologue.ai/api/admin/integrations/oauth/callback`

4. Click **"Register"**

---

## Step 2: Create a client secret

1. In the new app, in the left sidebar, click **"Certificates & secrets"**
2. Click **"New client secret"**
3. Description: `Triologue Production`
4. Expiry: **24 months**
5. Click **"Add"**

⚠️ **Copy the "Value" right away!** It is shown only once.

You now have:
- **Client ID** (on the overview page, "Application (client) ID")
- **Client Secret** (the value you just copied)
- **Tenant ID** (on the overview page, "Directory (tenant) ID")

---

## Step 3: Set API permissions

1. In the left sidebar, click **"API permissions"**
2. Click **"Add a permission"**, then **"Microsoft Graph"**, then **"Delegated permissions"**

**For SharePoint:**
- `Files.ReadWrite.All`: read and write files
- `Sites.Read.All`: read SharePoint sites

**For Teams:**
- `Team.ReadBasic.All`: read teams (including their channels)
- `ChannelMessage.Read.All`: read messages from channels
- `ChannelMessage.Send`: send messages into Teams channels

**General:**
- `User.Read`: read own profile (default, usually already there)
- `offline_access`: receive a refresh token (required for auto-refresh)

3. Click **"Grant admin consent for [Organisation]"**
   - This skips the user-consent dialog for everyone in the org

---

## Step 4: Configure Triologue

Send over these three values (or write them straight into `.env`):

```env
MICROSOFT_CLIENT_ID=<Application (client) ID>
MICROSOFT_CLIENT_SECRET=<Client Secret Value>
MICROSOFT_TENANT_ID=<Directory (tenant) ID>
MICROSOFT_REDIRECT_URI=https://opentriologue.ai/api/admin/integrations/oauth/callback
```

Then restart the API and the OAuth flow works.

---

## Optional: Jira/Atlassian

If you also want Jira:

1. Open https://developer.atlassian.com/console/myapps/
2. **"Create new app"**, then OAuth 2.0
3. **Callback URL:** `https://opentriologue.ai/api/admin/integrations/oauth/callback`
4. **Permissions:** Jira, then `read:jira-work`, `write:jira-work`

```env
ATLASSIAN_CLIENT_ID=<Client ID>
ATLASSIAN_CLIENT_SECRET=<Client Secret>
ATLASSIAN_REDIRECT_URI=https://opentriologue.ai/api/admin/integrations/oauth/callback
```

---

## Troubleshooting

**"AADSTS50011: The redirect URI does not match"**
The redirect URI in Azure does not match `MICROSOFT_REDIRECT_URI`. Compare them exactly (watch out for a trailing slash).

**"AADSTS65001: The user or administrator has not consented"**
Admin consent is missing. Go back to API permissions and click "Grant admin consent".

**"AADSTS7000218: The request body must contain client_secret"**
The client secret is missing or expired. Create a new one.

**Token refresh fails**
The `offline_access` scope is missing. Add it under API permissions afterwards and grant admin consent.
