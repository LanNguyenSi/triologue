# Frontend primitives adoption guide

Client UI primitives live in `client/src/components/ui/primitives/` (`Button`,
`Input`, `Card`, plus `Select`, `Badge`, `EmptyState`, `SectionHeader`,
exported from `index.ts`). This is the compact map for converting raw
`<button>` / `<input>` / ad-hoc "card" `<div>`s onto them, and the escape
hatches for when raw markup is still correct.

## Reference conversions

`DashboardPage.tsx`, `InboxPage.tsx`, `FilesPage.tsx`, and `ApprovalsPage.tsx`
are the first slice converted onto the primitives and are the pattern to
copy for the rest of the sweep. Read their diffs for concrete examples of
both conversions and documented left-raw exceptions.

## Button: variant/size mapping

| Look in the wild | Variant |
| --- | --- |
| Solid blue action (primary CTA) | `primary` (default) |
| Bordered/neutral action | `secondary` |
| Destructive action (red) | `danger` |
| Positive/confirm action (green, e.g. approve) | `success` |
| Borderless icon/text action | `ghost` (`size="icon"` for icon-only) |

Sizes: `xs`/`sm`/`md` for text density, `icon` for square icon-only buttons.

Icon+text children need no wrapper: `Button` establishes its own flex
context (`items-center justify-center gap-1.5`, plus `flex` when the `block`
prop is set and `inline-flex` otherwise), so `<Button><Icon/>{label}</Button>`
lays out and spaces correctly. This is deliberate — Tailwind's preflight sets
`svg { display: block }`, so an icon inside a plain inline-block button pushes
the label onto a second line. The primitive owns the flex context precisely so
no call site has to remember a wrapper span.

Consequently `Button` now OWNS these utilities; passing them via `className`
silently loses to the base (see the caveat below): `display` (use the `block`
prop for a full-width block-level button), `items-*`, `justify-start` /
`justify-end`, and any `gap` below `gap-1.5`. Wider gaps (`gap-2`+) and
`justify-between` still win, because they are emitted later.

**Leave raw** when the button is:
- a tab or a toggle-pill (`aria-pressed`, active/inactive state styling) —
  e.g. `InboxPage`'s "all"/"unread" filter pills.
- a link-styled inline text button (no background, just colored text,
  often with an icon) — e.g. `FilesPage`'s breadcrumb segments and the
  file-name-as-button in the file browser row.
- a content-wrapping row trigger where the button holds a whole block of
  child markup (title + badges + timestamp) rather than a text/icon label —
  `Button`'s fixed padding/typography would misalign the row; keep the
  raw `<button>` for click/keyboard semantics only.
- semantically colored in a way `Button` has no variant for. Do not
  force-fit a color via `className` override; leave it raw and flag the
  gap instead of extending the primitive from inside a page conversion.
  (This is how the `success` variant came to exist: the green approve
  button in `ApprovalsPage` was flagged first, then the variant was added
  deliberately and the button converted.)

## Input: mapping

Any single-line text entry field (`type="text"`/unset, `type="email"`,
`type="search"`, etc.) → `<Input>`. It forwards a ref and passes through
`value`/`onChange`/`placeholder`/`aria-*` like a native `<input>`; only
`className` needs adjusting (drop manual border/bg/focus-ring classes,
keep layout classes like `flex-1`).

**className caveat (applies to all primitives):** there is no
tailwind-merge in play. A `className` utility that conflicts with a base
utility of the primitive (e.g. `text-xs` vs `Input`'s own `text-sm`, or
`flex` vs `Button`'s `inline-flex`) is resolved by CSS source order, not by
"last prop wins" — it may silently lose, with no type or lint error. Use
`className` only for utilities the primitive does not set: width, margins,
positioning. Never use it to fight the primitive's display, alignment,
typography, padding, or colors; if you need a different density or layout,
that is a size/variant/prop question.

**Leave raw**: `checkbox`, `radio`, and `file` inputs — `Input` is a
text-entry primitive only (see `FilesPage`'s hidden `type="file"` upload
input).

## Card: mapping

Pick the tone by the original fill so the swap stays visually
like-for-like: dark `bg-gray-800/60`-class fills map to the `default`
tone, lighter `bg-gray-800/40`/`bg-gray-900`-class fills map to `muted`,
blue-tinted info fills map to `accent`.

An ad-hoc `rounded-lg border` `<div>` with its own background (tone
default/muted/accent-ish colors) that represents a real panel or list-item
card → `<Card tone="default" | "muted" | "accent">`, with page-specific
layout (padding overrides, `min-h`, `flex flex-col`, ring/active-state
overrides) passed via `className`.

**Leave raw / don't force-fit**:
- rows rendered as `<Link>`/`<a>` rather than `<div>` where the hover/active
  styling lives directly on the anchor — `Card` is a `div`-only wrapper;
  wrapping the anchor would require restructuring hover state (e.g.
  `group-hover`) beyond a like-for-like swap. See `DashboardPage`'s
  `actionItemClass` rows.
- bordered placeholder boxes that intentionally have **no** background
  (text + border only) — none of `Card`'s tones fit without adding an
  unwanted fill. See `InboxPage`'s loading/empty placeholder boxes.
- small inline pill/toggle-group wrappers (`inline-flex ... rounded-lg
  border`) that aren't a content card.
- semantically colored alert/banners (e.g. a red error banner) — `Card` has
  no danger tone; forcing `default`/`muted`/`accent` would drop the color
  semantics.

Visual parity is the goal; small deltas toward the primitives' canonical
look (radius, focus ring, hover, shadow) are the expected result of
adoption, not a regression.

## Known primitive gap

`Button` has no `success`/green variant. `ApprovalsPage`'s green "approve"
button was left raw for this reason — worth deciding in a follow-up whether
to add the variant or keep approve-style actions raw by convention.
