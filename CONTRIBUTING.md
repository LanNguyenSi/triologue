# Contributing to Triologue

Thanks for picking up a piece of Triologue. The point of this guide is consistency: every new page, route, or component should follow the existing patterns, not invent new ones. Drift is the most expensive thing.

## Frontend conventions

### `PageShell` is the page wrapper

Every page uses `<PageShell>` as its outermost element. Do not roll your own `max-w-*` or `mx-auto px-4 py-6`.

```tsx
import { PageShell } from '../components/ui/PageShell';

export const MyPage: React.FC = () => {
  const { t } = useLanguage();
  return (
    <PageShell
      maxWidth="6xl"
      title={t('mypage.title')}
      subtitle={t('mypage.subtitle')}
      actions={<Button .../>}  // optional
    >
      {/* content */}
    </PageShell>
  );
};
```

Width defaults: `6xl` for lists / dashboards / forms, `4xl` for narrow detail pages, `3xl` for very narrow (e.g. login). Reference: `client/src/pages/InboxPage.tsx`.

### All visible strings go through `t()`

No hardcoded strings in JSX. Both DE and EN must be updated together in `client/src/contexts/LanguageContext.tsx` (DE block around line 22, EN block around line 1310). Updating only one language is a bug.

Key convention: `<page>.<element>`, e.g. `approvals.title`, `approvals.empty`, `approvals.error.load`.

### Use the UI primitives

Reach for the components in `client/src/components/ui/primitives/` before writing a new one:

| Primitive | When |
|---|---|
| `<Button variant="primary\|secondary\|danger\|ghost" size="sm\|md">` | All buttons |
| `<Badge variant="success\|warning\|danger\|info\|neutral">` | Status labels |
| `<Card>` | Card containers |

Custom `<button>` elements are fine only when no primitive fits (e.g. icon-only with specific styling), and they must respect the theme system.

### Auth header pattern

```tsx
const authHeaders = useCallback((): HeadersInit => {
  const token = localStorage.getItem('triologue_token') ?? '';
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}, []);
```

Don't inline `localStorage.getItem` in `fetch` calls.

### Routes and navigation

A new page goes in two places:

- `client/src/App.tsx`: route entry, e.g. `<Route path="/mypage" element={user ? <MyPage /> : <Navigate to="/login" />} />`.
- `client/src/components/layout/AppShell.tsx`: nav entry, plus the `nav.mypage` key in both languages.

Don't edit `Navbar.tsx` for new nav entries; it's the older surface.

## Backend conventions

### Route file shape

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

Mount in `server/src/index.ts`: `app.use('/api/my-route', myRouter)`.

### Error handling

- `try/catch` on every route handler.
- `logger.error` with a `[route-name]` prefix so traces are greppable.
- Never send stack traces to the client.
- Non-fatal side effects (notifications, audit hooks) get their own `try/catch` with `logger.warn`, so the primary path keeps succeeding.

## Database changes

Schema changes always go through a Prisma migration. Don't hand-edit the schema and skip the migration.

```bash
cd server
npx prisma migrate dev --name describe_the_change --create-only
# review the generated SQL, then:
npx prisma migrate deploy
npx prisma generate
```

## TypeScript

- No `any` outside known Prisma workarounds (`(prisma as any).newModel` is fine until `prisma generate` updates the client).
- No `ts-ignore` without a comment explaining why.
- New functions get explicit return types.
- Prefer `type` for object shapes; use `interface` only when extending or merging.

## PR checklist

Before opening a PR:

- [ ] New strings go through `t()`, both languages updated in `LanguageContext.tsx`.
- [ ] New page uses `PageShell`, registered in both `App.tsx` and `AppShell.tsx`.
- [ ] New route registered in `server/src/index.ts`, `authenticate` middleware applied where appropriate.
- [ ] New DB column or table has a migration; `prisma generate` was run.
- [ ] `tsc --noEmit` clean on touched files.
- [ ] Every `async` operation has `try/catch`.

## Commit style

```
feat(scope): short description
fix(scope): what was fixed
docs: what was documented
refactor(scope): what was rebuilt
```

`scope` is the area touched: `auth`, `approvals`, `projects`, `byoa`, `gateway`, etc.

## License

By contributing you agree your contribution is licensed under AGPL v3, the project's [LICENSE](LICENSE).
