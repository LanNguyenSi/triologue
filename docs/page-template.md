# Page Template (UI Konsistenz)

Ziel: Neue Seiten sollen ohne Nacharbeit denselben Layout- und Spacing-Rhythmus wie `Projects`, `Memory`, `Secrets`, `Inbox`, `Admin`, `Settings` nutzen.

## 1) Grundstruktur

```tsx
<PageShell
  maxWidth="6xl"
  title={<span className="inline-flex items-center gap-2">📄 Seitentitel</span>}
  subtitle="Kurze Kontextzeile"
  actions={<Button size="sm">Aktion</Button>}
>
  <div className="space-y-4 sm:space-y-5">
    {/* Error (optional) */}
    {/* Top control card */}
    {/* Main content */}
    {/* Pagination (optional) */}
  </div>
</PageShell>
```

## 2) Verbindliche Regeln

- `PageShell` für alle App-Seiten verwenden.
- Standardbreite: `maxWidth="6xl"` (nur bewusst abweichen, z. B. Legal-Seiten).
- Innerer Seiten-Stack immer: `space-y-4 sm:space-y-5`.
- Keine gemischte vertikale Steuerung mit vielen `mb-*`/`mt-*` zwischen Hauptblöcken.
- Erste Steuer-/Filter-/Tab-Card: `Card tone="muted" className="p-3 sm:p-4"`.
- Pagination-Card: `Card tone="muted" className="p-3 sm:p-4"` (als normaler Stack-Block, kein extra `mt-*` nötig).
- Titel mit Icon konsistent: `<span className="inline-flex items-center gap-2">…</span>`.

## 3) States

- `loading`: im `PageShell` rendern (kein separater `min-h-screen` Fullpage-Wrapper).
- `error`: eigener Block im Stack (z. B. `rounded p-3 text-sm ...`).
- `empty`: `EmptyState` im Main-Content-Bereich.

## 4) Tabs-Muster

- Tab-Leiste in eigener `muted`-Card.
- Tab-Content als nächster Stack-Block.
- Abstand zwischen Tab-Leiste und Tab-Content nicht über `pt-*`, sondern über normalen Stack-Rhythmus.

## 5) Referenz-Skeleton

```tsx
return (
  <PageShell
    maxWidth="6xl"
    title={<span className="inline-flex items-center gap-2">🧩 {t("page.title")}</span>}
    subtitle={t("page.subtitle")}
    actions={<Button size="sm">{t("page.create")}</Button>}
  >
    <div className="space-y-4 sm:space-y-5">
      {error && (
        <div className={`rounded p-3 text-sm ${isDark ? "bg-red-900/50 text-red-200" : "bg-red-50 text-red-700"}`}>
          {error}
        </div>
      )}

      <Card tone="muted" className="p-3 sm:p-4">
        {/* Search / Filter / Tabs */}
      </Card>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon="📭" title={t("page.empty")} />
      ) : (
        <Card className="p-4 sm:p-5">
          {/* Main list/grid/content */}
        </Card>
      )}

      <Card tone="muted" className="p-3 sm:p-4">
        {/* Pagination row */}
      </Card>
    </div>
  </PageShell>
);
```

## 6) Review-Checkliste (PR)

- Nutzt die Seite `PageShell`?
- Ist `maxWidth` bewusst gewählt?
- Ist der innere Root-Container `space-y-4 sm:space-y-5`?
- Sind Top-Controls/Pagination als `muted`-Card umgesetzt?
- Sind `loading/error/empty` konsistent?
- Gibt es unnötige `mt-*`/`mb-*`-Sonderabstände zwischen Hauptblöcken?

