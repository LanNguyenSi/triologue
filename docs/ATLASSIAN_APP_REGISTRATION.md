# Atlassian (Jira) App Registration — Anleitung

Damit Triologue sich mit Jira verbinden kann, braucht es eine OAuth 2.0 App in der Atlassian Developer Console.

**Dauer:** ~5 Minuten
**Voraussetzung:** Admin-Zugang zur Atlassian/Jira Instanz

---

## Schritt 1: App erstellen

1. Öffne https://developer.atlassian.com/console/myapps/
2. Klicke **"Create"** → **"OAuth 2.0 integration"**
3. **Name:** `OpenTriologue`
4. Akzeptiere die Terms → **"Create"**

---

## Schritt 2: Berechtigungen setzen

1. In der App → Linke Sidebar → **"Permissions"**
2. Bei **"Jira API"** → **"Add"** / **"Configure"**
3. Folgende Scopes aktivieren:
   - **Classic Scopes:**
     - `read:jira-work` — Issues, Projekte, Boards lesen
     - `write:jira-work` — Issues erstellen, bearbeiten, Status ändern

---

## Schritt 3: Callback URL setzen

1. Linke Sidebar → **"Authorization"**
2. Bei **"OAuth 2.0 (3LO)"** → **"Configure"** oder **"Add"**
3. **Callback URL:** `https://opentriologue.ai/api/admin/integrations/oauth/callback`
4. Speichern

---

## Schritt 4: Client Credentials kopieren

1. Linke Sidebar → **"Settings"**
2. Hier findest du:
   - **Client ID**
   - **Secret** (klicke auf "Show" oder "Create" falls noch keins existiert)

---

## Schritt 5: Mir schicken

Schick mir:
- **Client ID**
- **Client Secret**

Ich trage sie in die `.env` ein:
```env
ATLASSIAN_CLIENT_ID=<Client ID>
ATLASSIAN_CLIENT_SECRET=<Client Secret>
ATLASSIAN_REDIRECT_URI=https://opentriologue.ai/api/admin/integrations/oauth/callback
```

---

## Troubleshooting

**"Invalid redirect URI"**
→ Callback URL stimmt nicht exakt überein. Kein trailing Slash, kein http statt https.

**"Scope not granted"**
→ Unter Permissions die Jira API Scopes nicht aktiviert. Zurück zu Schritt 2.

**"Consumer key is not registered"**
→ App ist noch im Draft-Status. Unter "Distribution" auf "Sharing" stellen (für interne Nutzung reicht das).
