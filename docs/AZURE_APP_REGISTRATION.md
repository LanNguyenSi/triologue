# Azure App Registration — Anleitung

Damit Triologue sich mit Microsoft-Diensten (SharePoint, Teams, Outlook) verbinden kann, braucht es eine App Registration in Azure AD. Das ist die "Identität" von Triologue gegenüber Microsoft.

**Dauer:** ~10 Minuten
**Voraussetzung:** Admin-Zugang zu portal.azure.com (publicplan Azure AD)

---

## Schritt 1: App Registration erstellen

1. Öffne https://portal.azure.com
2. Suche nach **"App registrations"** (oder "App-Registrierungen")
3. Klicke **"New registration"**

**Ausfüllen:**
- **Name:** `Triologue` (oder `OpenTriologue`)
- **Supported account types:** `Accounts in this organizational directory only` (Single Tenant)
  - Wähle Multi-Tenant nur wenn andere Organisationen auch verbinden sollen
- **Redirect URI:**
  - Platform: **Web**
  - URI: `https://opentriologue.ai/api/admin/integrations/oauth/callback`

4. Klicke **"Register"**

---

## Schritt 2: Client Secret erstellen

1. In der neuen App → Linke Sidebar → **"Certificates & secrets"**
2. Klicke **"New client secret"**
3. Description: `Triologue Production`
4. Expires: **24 months** (Maximum)
5. Klicke **"Add"**

⚠️ **SOFORT den "Value" kopieren!** Er wird nur einmal angezeigt.

Du hast jetzt:
- **Client ID** (auf der Overview-Seite, auch "Application (client) ID")
- **Client Secret** (der gerade kopierte Value)
- **Tenant ID** (auf der Overview-Seite, auch "Directory (tenant) ID")

---

## Schritt 3: API Permissions setzen

1. Linke Sidebar → **"API permissions"**
2. Klicke **"Add a permission"** → **"Microsoft Graph"** → **"Delegated permissions"**

**Für SharePoint:**
- `Files.ReadWrite.All` — Dateien lesen + schreiben
- `Sites.Read.All` — SharePoint Sites lesen

**Für Teams:**
- `ChannelMessage.Send` — Nachrichten in Teams-Kanäle senden
- `Channel.ReadBasic.All` — Kanäle lesen

**Für allgemein:**
- `User.Read` — Eigenes Profil lesen (Standard, meist schon da)
- `offline_access` — Refresh Token erhalten (wichtig für Auto-Refresh!)

3. Klicke **"Grant admin consent for [Organisation]"**
   - Das überspringt den User-Consent-Dialog für alle Mitarbeiter

---

## Schritt 4: In Triologue konfigurieren

Schick mir diese drei Werte (oder trag sie direkt in die `.env` ein):

```env
MICROSOFT_CLIENT_ID=<Application (client) ID>
MICROSOFT_CLIENT_SECRET=<Client Secret Value>
MICROSOFT_TENANT_ID=<Directory (tenant) ID>
MICROSOFT_REDIRECT_URI=https://opentriologue.ai/api/admin/integrations/oauth/callback
```

Danach API neustarten und der OAuth Flow funktioniert.

---

## Optional: Jira/Atlassian

Falls auch Jira gewünscht:

1. Öffne https://developer.atlassian.com/console/myapps/
2. **"Create new app"** → OAuth 2.0
3. **Callback URL:** `https://opentriologue.ai/api/admin/integrations/oauth/callback`
4. **Permissions:** Jira → `read:jira-work`, `write:jira-work`

```env
ATLASSIAN_CLIENT_ID=<Client ID>
ATLASSIAN_CLIENT_SECRET=<Client Secret>
ATLASSIAN_REDIRECT_URI=https://opentriologue.ai/api/admin/integrations/oauth/callback
```

---

## Troubleshooting

**"AADSTS50011: The redirect URI does not match"**
→ Redirect URI in Azure stimmt nicht mit `MICROSOFT_REDIRECT_URI` überein. Genau vergleichen (trailing slash beachten).

**"AADSTS65001: The user or administrator has not consented"**
→ Admin Consent fehlt. Zurück zu API Permissions → "Grant admin consent" klicken.

**"AADSTS7000218: The request body must contain client_secret"**
→ Client Secret fehlt oder abgelaufen. Neues erstellen.

**Token Refresh schlägt fehl**
→ `offline_access` Scope fehlt. In API Permissions nachträglich hinzufügen + Admin Consent erteilen.
