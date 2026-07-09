---
type: overview
title: Frontend UI primitives — where the convention lives
description: Pointer doc — client UI work must follow docs/frontend-primitives.md (Button/Input/Card variant mapping, className precedence, leave-raw exceptions); this entry only names the primitive set and the open adoption sweep so an agent starts in the right place.
tags: [frontend, ui, primitives, conventions, pointer]
timestamp: 2026-07-09T03:34:19.437907Z
sources:
  - docs/frontend-primitives.md
  - client/src/components/ui/primitives/index.ts
---

# Frontend UI primitives — pointer

The authoritative convention document is
[../frontend-primitives.md](../frontend-primitives.md): which primitive to
use for which raw element, variant mapping, the `className` precedence
caveat, and the sanctioned "leave raw" exceptions. It is current against
master and deliberately NOT restated here.

For orientation:

- The primitive set lives under `client/src/components/ui/primitives/`
  (exported via `index.ts`): `Badge`, `Button`, `Card`, `EmptyState`,
  `Input`, `SectionHeader`, `Select`.
- Adoption across the client is not complete; the remaining raw
  buttons/inputs/card-divs are tracked as an explicit rest-sweep task
  (agent-tasks `72da6252`). New client code must use the primitives; do not
  convert unrelated raw elements in passing — that sweep is its own task.
