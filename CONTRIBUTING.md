# CONTRIBUTING.md — Ways of Working

*Gültig für alle Beiträge zu Triologue — Ice 🧊, Lava 🌋, und zukünftige Contributors.*  
*Festgelegt von: Lan | Erstellt: 2026-03-30*

> **Grundprinzip:** Konsistenz ist keine Option. Jede neue Seite, jede neue Route, jede neue Komponente folgt den bestehenden Patterns — ohne Ausnahme. Abweichungen erzeugen doppelte Arbeit.

---

## 1. Neue Frontend-Seite

### 1.1 PageShell immer verwenden

Jede Seite nutzt `<PageShell>` als äußerste Hülle — kein eigenes Layout, kein eigenes `max-w-*`, kein eigenes `mx-auto px-4 py-6`.

```tsx
import { PageShell } from '../components/ui/PageShell';

export const MyPage: React.FC = () => {
  const { t } = useLanguage();

  return (
    <PageShell
      maxWidth="6xl"              // Standard für Content-Seiten
      title={t('mypage.title')}
      subtitle={t('mypage.subtitle')}
      actions={<Button .../>}     // optional
    >
      {/* Inhalt */}
    </PageShell>
  );
};
```

**maxWidth-Richtwerte:**
- `6xl` — Standard (Listen, Dashboards, Formulare)
- `4xl` — Schmale Detail-Seiten
- `3xl` — Sehr schmale Seiten (z.B. Login)

**Referenz-Implementierung:** `InboxPage.tsx`

---

### 1.2 Lokalisierung — kein Hardcoding

**Jeder** sichtbare String kommt aus `t()`. Keine Ausnahmen.

```tsx
// ❌ Falsch
<h1>Approvals</h1>
<p>No pending approvals</p>
<button title="Refresh">

// ✅ Richtig
<h1>{t('approvals.title')}</h1>
<p>{t('approvals.empty')}</p>
<button title={t('approvals.refresh')}>
```

**Schlüssel-Konvention:** `<seite>.<element>` — z.B. `approvals.title`, `approvals.empty`, `approvals.error.load`

**Beide Sprachen immer gleichzeitig** in `client/src/contexts/LanguageContext.tsx`:
- DE-Block: ca. Zeile 22 (Sprache `de`)
- EN-Block: ca. Zeile 1310 (Sprache `en`)

Einen Block alleine zu aktualisieren ist ein Fehler.

---

### 1.3 UI-Primitives nutzen

Bestehende Primitive aus `client/src/components/ui/primitives/` verwenden — nicht neu erfinden:

| Primitive | Wann |
|-----------|------|
| `<Button variant="primary\|secondary\|danger\|ghost" size="sm\|md">` | Alle Buttons |
| `<Badge variant="success\|warning\|danger\|info\|neutral">` | Status-Labels |
| `<Card>` | Karten-Container |

Eigene `<button>`-Elemente nur wenn Primitive nicht passen (z.B. Icon-only mit spezifischem Styling) — und dann konsistent mit dem Theme-System.

---

### 1.4 Auth-Header Pattern

```tsx
const authHeaders = useCallback((): HeadersInit => {
  const token = localStorage.getItem('triologue_token') ?? '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}, []);
```

Kein inline `localStorage.getItem` in fetch-Calls.

---

### 1.5 Route registrieren

Neue Seite → in `client/src/App.tsx` eintragen:

```tsx
<Route path="/mypage" element={user ? <MyPage /> : <Navigate to="/login" />} />
```

---

### 1.6 Navigation

Neue Seite → Nav-Eintrag in `client/src/components/layout/AppShell.tsx` (nicht Navbar.tsx):

```tsx
{ key: 'mypage', to: '/mypage', icon: <MyIcon className="w-4 h-4" />, label: t('nav.mypage'), match: p => p === '/mypage', available: true },
```

Und `nav.mypage` in beiden Sprachen in LanguageContext.tsx.

---

## 2. Neue Backend-Route

### 2.1 Struktur

```ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';

const router = Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    // ...
    return res.json({ result });
  } catch (err) {
    logger.error('[route-name] operation error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
```

### 2.2 Route in index.ts registrieren

```ts
import myRouter from './routes/my-route';
app.use('/api/my-route', myRouter);
```

### 2.3 Fehlerbehandlung

- `try/catch` auf jeder Route
- `logger.error` mit Prefix `[route-name]` für Traceability
- Niemals Stack-Traces an den Client senden
- Non-fatale Operationen (z.B. Benachrichtigungen) in separatem `try/catch` mit `logger.warn`

---

## 3. Datenbank-Änderungen

### 3.1 Immer Migration erstellen

Kein direktes Schema-Editing ohne Migration:

```bash
cd server
npx prisma migrate dev --name describe_the_change --create-only
# SQL prüfen, dann:
npx prisma migrate deploy
```

### 3.2 Prisma-Client generieren

Nach Schema-Änderungen:

```bash
npx prisma generate
```

---

## 4. TypeScript

- **Kein `any`** außer bei bekannten Prisma-Workarounds (`(prisma as any).newModel`) bis `prisma generate` den Client aktualisiert hat
- **Keine `ts-ignore`** ohne Kommentar warum
- Alle neuen Funktionen haben explizite Return-Typen
- Interfaces über `type` bevorzugen wenn es ein Objekt-Shape ist

---

## 5. PR-Checkliste

Vor jedem PR sicherstellen:

- [ ] Neue Strings: alle via `t()`, beide Sprachen in LanguageContext.tsx
- [ ] Neue Seite: `PageShell` genutzt, in App.tsx + AppShell.tsx registriert
- [ ] Neue Route: in `server/src/index.ts` registriert, `authenticate` Middleware vorhanden
- [ ] Neue DB-Tabelle/Spalte: Migration existiert, `prisma generate` ausgeführt
- [ ] TypeScript: keine neuen Errors in geänderten Files (`tsc --noEmit`)
- [ ] Error Handling: alle async Operationen haben `try/catch`

---

## 6. Commit-Konvention

```
feat(scope): kurze Beschreibung
fix(scope): was behoben wurde
docs: was dokumentiert wurde
refactor(scope): was umgebaut wurde
```

Scope = Bereich der Änderung: `poc`, `approvals`, `projects`, `auth`, etc.

---

*Dieses Dokument wächst mit dem Projekt. Änderungen nur nach Absprache mit Lan.*
