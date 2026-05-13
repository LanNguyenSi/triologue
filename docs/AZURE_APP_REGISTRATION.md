# Microsoft Entra ID App Registration — Anleitung

> **TL;DR (English):** Step-by-step Entra ID (formerly Azure AD) app registration for connecting Triologue to Microsoft Graph (SharePoint, Teams). Callback URL is `${APP_URL}/api/admin/integrations/oauth/callback`. Required scopes: `Files.ReadWrite.All`, `Sites.Read.All`, `offline_access` (SharePoint); `Team.ReadBasic.All`, `ChannelMessage.Read.All`, `ChannelMessage.Send`, `offline_access` (Teams). Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI` in `.env`.

Damit Triologue sich mit Microsoft-Diensten (SharePoint, Teams, Outlook) verbinden kann, braucht es eine App Registration in Microsoft Entra ID (ehemals Azure AD). Das ist die "Identität" von Triologue gegenüber Microsoft.

**Dauer:** ~10 Minuten
**Voraussetzung:** Admin-Zugang zu entra.microsoft.com

---

## Schritt 1: App Registration erstellen

1. Öffne https://entra.microsoft.com
2. Linke Sidebar → **Entra ID** → **App-Registrierungen**
3. Klicke **"Neue Registrierung"**

**Ausfüllen:**
- **Name:** `OpenTriologue`
- **Unterstützte Kontotypen:** `Nur Konten in diesem Organisationsverzeichnis` (Single Tenant)
  - Multi-Tenant nur wenn andere Organisationen auch verbinden sollen
- **Umleitungs-URI:**
  - Plattform: **Web**
  - URI: `https://opentriologue.ai/api/admin/integrations/oauth/callback`

4. Klicke **"Registrieren"**

---

## Schritt 2: Client Secret erstellen

1. In der neuen App → Linke Sidebar → **"Zertifikate & Geheimnisse"**
2. Klicke **"Neuer geheimer Clientschlüssel"**
3. Beschreibung: `Triologue Production`
4. Ablauf: **24 Monate**
5. Klicke **"Hinzufügen"**

⚠️ **SOFORT den "Value" kopieren!** Er wird nur einmal angezeigt.

Du hast jetzt:
- **Client ID** (auf der Übersicht-Seite, "Anwendungs-ID (Client)")
- **Client Secret** (der gerade kopierte Wert)
- **Tenant ID** (auf der Übersicht-Seite, "Verzeichnis-ID (Mandant)")

---

## Schritt 3: API-Berechtigungen setzen

1. Linke Sidebar → **"API-Berechtigungen"**
2. Klicke **"Berechtigung hinzufügen"** → **"Microsoft Graph"** → **"Delegierte Berechtigungen"**

**Für SharePoint:**
- `Files.ReadWrite.All` — Dateien lesen + schreiben
- `Sites.Read.All` — SharePoint Sites lesen

**Für Teams:**
- `Team.ReadBasic.All`: Teams (inkl. ihrer Kanäle) lesen
- `ChannelMessage.Read.All`: Nachrichten aus Kanälen lesen
- `ChannelMessage.Send`: Nachrichten in Teams-Kanäle senden

**Für allgemein:**
- `User.Read` — Eigenes Profil lesen (Standard, meist schon da)
- `offline_access` — Refresh Token erhalten (wichtig für Auto-Refresh!)

3. Klicke **"Administratorzustimmung für [Organisation] erteilen"**
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
