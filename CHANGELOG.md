# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-06-22

Wave-1/2 refactoring milestone: the largest client components and the server agent-auth were decomposed into reviewable units, a shared API client and project-domain module landed, the last German-only pages were localized, and the app shell gained keyboard accessibility. Every change is behavior-preserving (verified per PR with tsc, lint, and the test suites). The app is private and deployed from `master`; this tag is deploy provenance.

### Added

- **Keyboard a11y on the app-shell overlays** (PR #121): a new `useFocusTrap` hook (sharing the focusable-element selector with the `Modal` primitive) gives the mobile sidebar drawer and the user-menu popup a focus trap, Escape-to-close, and focus restore; Escape unwinds one layer at a time; the unicode chevron became a `ChevronDownIcon`.
- **Localization of the last German-only pages** (PR #122): `FilesPage`, `AgentConfigPage`, `UserConnectionsPage`, and `ProjectActivityPage` now route every user-visible string through `t()`, with 141 keys added to both the `de` and `en` blocks; the `uiConsistency` guard was extended to cover them.

### Changed

- **Shared API client** (PR #115): a single `apiClient` replaces per-service token plumbing across 47 files (net -343 lines); the `VITE_API_URL` convention is documented to prevent the `/api/api` double-prefix footgun.
- **Shared project-domain module** (PR #116): project types and the workflow/context normalizers extracted, plus a single `authFileUrl` builder.
- **`ProjectDetailPage` decomposed** from 2508 to 734 lines (PR #117) into hooks and components under `components/projects/`.
- **`MessageList` decomposed** from 644 to 181 lines (PR #118) into `types/chat.ts` plus `chatUtils`/`MessageItem`/`MessageActions`/`SystemMessageBanner`, with a single list-level relative-time tick.
- **`AppShell` decomposed** from 522 to 289 lines (PR #120) into `SidebarNavItem`/`SidebarRoomList`/`SidebarUserMenu` and a `useRoomList` hook; the dead always-false `compact` branch was removed and the Files nav label localized.
- **BYOA bearer-token auth extracted** into a `byoaAuth` Express middleware (PR #123): 12 agent routes drop their inline auth and read `req.agentToken`, `agents.ts` shrinks from 2883 to 2668 lines, and a DB/infra error during token resolution now returns a graceful 500 instead of hanging the request.
- **Admin gates consolidated** onto the single shared `requireAdmin` (PR #124), removing three duplicate local definitions and two redundant per-request DB reads.

### Fixed

- **Agent avatars render in their brand color** (PR #119): `getAvatarStyle` returned a color-less border for an agent with a custom color, so those avatars were transparent; it now applies the color as an inline border plus a low-opacity fill, with the `agentStore` fallback colors aligned to the brand tokens.

### Verification

- Per PR: `tsc --noEmit`, ESLint (`--max-warnings 0`) on the client, and the client (vitest) plus server (jest) suites, all green; each change was reviewed by adversarial subagents before merge.

## [0.2.0] - 2026-06-21

Welle 0 quality-and-foundations milestone plus a CI hardening pass: new accessible UI primitives, a large dead-code and lint cleanup, and CI promoted from a hollow gate to a real one that now also runs the DB-backed server integration suites. The app is private and deployed from `master`; this tag is deploy provenance.

### Added

- **Accessible `Modal` primitive** with `ConfirmDialog` refactored onto it (PR #108): focus trap, Escape-to-close, and a per-file jsdom test setup for the client.
- **a11y-hardened `Button`, `LoadingSpinner`, `EmptyState` primitives** (PR #107) with `primitives.a11y.test.tsx` coverage.

### Changed

- **CI is now a real quality gate** (PR #111): removed every `continue-on-error`; client lint, server type-check and build, and client plus server tests all block now; added a pinned, checksum-verified gitleaks secret scan over full history, a committed `.prettierrc`, and a `server/tsconfig.test.json` so test files are type-checked.
- **Server DB integration suites now run in CI** (PR #113) against a Postgres service (`prisma db push` plus `RUN_DB_TESTS=1 --runInBand`), giving the register/login/profile/change-password and reviewer-inbox-dedup flows real coverage.
- **Client lint is clean and strict** (PR #109): all 77 ESLint warnings resolved (no-explicit-any typed honestly, no new suppressions) and `noUnusedLocals`/`noUnusedParameters` re-enabled.
- **Dead code removed** from both trees (PRs #103, #104): the unused client auth stack, Sidebar, Navbar and axios; the disabled server AI-dispatch handler and unused connector plugins.
- **`startServer()` is gated behind `require.main === module`** (PR #110) so importing the app in tests no longer boots the HTTP server.
- **Documentation reconciled with the code** (PR #100).

### Fixed

- **Duplicate reviewer-assigned inbox notification** removed (PR #102).
- **`BrandMark` SVG gradient id is unique** via `useId`, fixing collisions when multiple marks render (PR #106).
- **Server route imports no longer leak open handles in tests** (PR #112): the rooms presence Redis client connects lazily and the OAuth-nonce cleanup timer is `unref`'d.

### Security

- **`requireAdmin` hardened to check `isAdmin`** and `INTEGRATION_ENCRYPTION_KEY` validated at startup (PR #105).
- **`multer` bumped to 2.2.0** (GHSA-72gw-mp4g-v24j, HIGH DoS) (PR #101).
- **CVE sweep** across form-data, vite, ws, js-yaml, @babel/core and @opentelemetry/core (PR #98); dev-only `js-yaml@3` dropped from the server jest coverage path (PR #99).

### Verification

CI (the now-blocking gate) is green on this commit: client and server type-check, client lint, client tests (24), server tests (45, including the DB-backed auth and reviewer-inbox suites against Postgres), gitleaks (0 leaks), and client plus server builds. The live service was smoke-checked (rooms API responds). 4 stale auth cases are quarantined for a follow-up rewrite (task 44d2256f): AI self-registration moved to the BYOA token flow, and rate-limit enforcement needs a resettable limiter.

## [0.1.2] - 2026-06-16

Security patch: CRITICAL shell-quote CVE fix, moderate joi bump, gitleaks BYOA token rule, and a login default correction. The app is private and deployed from `master`; this tag is deploy provenance.

### Security

- **CRITICAL: shell-quote bumped to 1.8.4** (GHSA-w7jw-789q-3m8p, PR #95). The previous version was vulnerable to argument injection via shell metacharacters; this patch closes the attack surface for any server-side call that passes user-controlled strings through `shell-quote`.
- **Moderate: joi bumped to 17.13.4** (GHSA-q7cg-457f-vx79, PR #95). Resolves a moderate validation-bypass vulnerability in the joi schema library.
- **Gitleaks rule added for `byoa_` agent token prefix** (PR #96). Pre-commit and CI scanning now detects accidental commits of BYOA agent credentials matching the `byoa_` prefix, preventing secret leakage at the source.

### Fixed

- **Login registration mode now defaults to `invite`** to match the server default (PR #94). Previously the client sent an incorrect default, which could allow unexpected open registrations when the UI was used without an explicit mode selection.

## [0.1.1] - 2026-06-09

Security release closing the 2026-05-30 audit findings and a CVE sweep, plus README/env documentation. The headline is a HIGH-severity credential leak: protected routes accepted a token from the URL query string. The app is private and deployed from `master`; this tag is deploy provenance.

### Security

- **HIGH: credentials no longer accepted from the query string** (PR #90). The shared `authenticate` middleware accepted a token from `req.query.token` on every protected route, so long-lived JWTs and `byoa_` agent tokens leaked into access logs, reverse-proxy logs, browser history, and Referer headers. The global query-param fallback is removed; credentials are read only from the `Authorization` header. The one route that genuinely needs a header-less token, `GET /integrations/oauth/start`, keeps a scoped fallback (and rejects `byoa_` agent tokens, since only a human JWT should start an OAuth flow); image serving keeps its own local scoped fallback.
- **Teams Bot Framework webhook now fails closed** (PR #89). `verifyBotFrameworkAuth` authenticated forged requests: an unset `TEAMS_BOT_SECRET` returned true (allowing every caller), and a configured secret was only checked for an `Authorization` header longer than 10 characters, never compared to the secret. It now rejects when the secret is unset or empty, and matches a configured secret against the Bearer token with a length-guarded `crypto.timingSafeEqual` (mirroring the GitHub webhook). `POST /webhook` returns 503 when the secret is unconfigured and 401 on verification failure. Covered by a new jest + supertest suite (unconfigured / missing-header / wrong-token / correct-token).
- **react-router bumped to `^6.30.4`** (CVE-2026-40181, PR #92).
- **qs bumped to `6.15.2` in `server/`** (CVE-2026-8723, PR #85).

### Fixed

- **Fenced code blocks are readable in the light theme** in chat (commit d39e3dd).

### Documentation

- **OAuth connector environment variables documented** for Microsoft and Atlassian (PR #91).
- **README expanded** with Environment, Testing/CI, and deploy-shortcut sections (PR #87), and the fictional BYOA register endpoint replaced with the real SSE + REST flow (PR #86).

## [0.1.0] - 2026-05-24

### Documentation
- README gains a "Status: production, slow-pace development" banner
  under the hero paragraph. Sets honest expectations for first-time
  public readers: the platform ships at opentriologue.ai, the
  roadmap is real, but most engineering bandwidth flows into the
  companion projects (harness, agent-grounding, agent-tasks).
  Issues and PRs welcome without an SLA promise.
- `docs/VISION.md` gains a single italic disclaimer below the Beta
  scope list: "Pace depends on bandwidth. The 🔜 items are real
  plans, not committed timelines." Keeps the roadmap honest without
  pretending fast delivery.

### Removed
- `DIRECTIVES.md` (138 lines) and `ENGINEERING.md` (8 lines)
  deleted from repo root. The first was an internal AI-onboarding
  doc with persona-specific trust hierarchy ("Tier 1: Echter Lan
  via Telegram/WhatsApp"), not appropriate for public consumption.
  The second was an 8-line redirect to `lava-ice-logs/ENGINEERING.md`,
  pointing public readers at a separate persona-research repo. The
  rewritten `CONTRIBUTING.md` carries the relevant engineering
  conventions for Triologue contributors.

### Changed
- `VISION.md` moved to `docs/VISION.md` and refreshed against
  current reality. Drops the Matrix-as-future architecture
  reference (the migration was never pursued and
  `MATRIX_MIGRATION.md` was deleted in PR #66). Drops the
  WebSocket/REST/CLI gateway shape in favour of the canonical
  SSE+REST per the BYOA architecture rewrite. Drops the dated
  "2026-02-21 by Ice" footer. Pillar statuses re-checked against
  what actually shipped (Chat live, Agent Gateway live with SSE,
  Project tasks live, Connector OAuth live, Audit live, Agent
  memory partial, Workflows / marketplace / shared secret store
  / GitHub-room integration / team analytics still planned).
  Architecture diagram redrawn as mermaid. README's Documentation
  section now links it.
- `CONTRIBUTING.md` rewritten end-to-end in English (~135 lines,
  from 219 German lines). Drops the persona-direct address
  ("Gültig für Ice, Lava, ...") and the "Festgelegt von Lan"
  footer. Preserves the actual conventions (PageShell wrapper,
  i18n via `t()`, UI primitives, auth-header pattern, route +
  navigation registration, route-file shape, Prisma migration
  workflow, TypeScript rules, PR checklist, commit-message
  style). Adds an explicit AGPL-v3 contribution note at the
  bottom.

### Documentation
- `docs/BYOA_SSE_ARCHITECTURE.md` rewritten as the canonical SSE +
  REST protocol reference. The April-2026 draft framed SSE as a
  "Vorschlag" against "Aktuell WebSocket" but SSE + REST is what
  shipped. New doc anchors on actual implementation in
  `triologue-agent-gateway/src/byoa-sse.ts`: five endpoints
  (`/stream`, `/messages`, `/status`, `/tokens/rotate`, `/health`),
  Bearer auth on every request, `Last-Event-ID` resume, max 2
  concurrent streams per agent, idempotency via Redis with 1-hour
  TTL, rate limits 10/min standard / 30/min elevated, loop guard,
  trust levels, OpenClaw bridge notes. Cross-links the agent-side
  quickstart and the public-facing
  `client/public/BYOA.md`. Closes the BYOA-doc drift flagged
  for the public flip.
- README polished for the public flip: zero em-dashes (was 10),
  new mermaid `flowchart LR` showing how humans + BYOA agents
  share rooms, tasks, connectors, and the audit trail; new
  "Why this exists" block framing the platform's positioning;
  new "Related" block linking the agent-tasks / agent-grounding
  / harness / triologue-agent-gateway repos. All existing
  install / agent-register / docs links preserved. Docs-only.

### Security
- `.gitleaks.toml` added with an allowlist for the `byoa_your_token`
  / `byoa_your_token_here` placeholder strings used in
  `client/public/BYOA.md` (the public BYOA quickstart). A full-history
  scan with `gitleaks detect --source=. --no-banner` returned 0
  findings after the allowlist. A separate full-history scan
  (without the allowlist) surfaced 10 real-looking BYOA agent tokens
  + webhook secrets in three docs that were deleted in earlier
  cleanup PRs but persist in `git log -p`. Those values are tracked
  in agent-tasks `03b3cfe3` for production-side rotation; once
  rotated they become inert without needing a history rewrite.
- `REGISTRATION_MODE` is now resolved once at module-import time
  with a secure default. An operator who forgets to set the env
  var no longer gets open self-signup; the server defaults to
  `invite` (closed-beta behaviour). An invalid value throws at boot
  rather than silently falling through. Both `.env.example` files
  document the three valid values (`open`, `invite`, `closed`).
  Closes the operational caveat from the 2026-02-21 audit item #4.

### Added
- `docs/HTTPS-SETUP.md` restored and refreshed against the current
  deployment shape. Lists four production-ready TLS termination
  paths (Traefik, Caddy, nginx + Certbot, Cloudflare Tunnel) with
  the recommendation to match the production deployment via
  Traefik (the `docker-compose.yml` already carries the labels).
  Drops the dated 2026-02-19 byline + the internal-only "Für Ice"
  footer + the embedded Prisma-migration section that did not
  belong in a TLS doc. README links it from the Documentation list
  and the Deployment section. Closes the public-flip blocker
  caught by the cleanup PR review.

### Removed
- `docs/SECURITY-AUDIT-2026-02-21.md` deleted after a verification
  pass against the current code. All five CRITICAL findings (no-auth
  on `/api/users`, no-membership on `/api/messages/:roomId`, JWT
  fallback secret, `REGISTRATION_MODE` defaults, SVG upload XSS) are
  fixed. Four of five IMPORTANT findings are fixed; two operational
  caveats remain and are tracked as separate follow-up tasks:
  `REGISTRATION_MODE` code default still `?? 'open'` (agent-tasks
  `a1e64292`); three surviving `dangerouslySetInnerHTML` instances
  to audit + sanitize (agent-tasks `d4c4e549`). The doc is now a
  historical vulnerability map that adds attack-surface signal
  against unmerged forks while delivering nothing the surviving
  `SECURITY.md` does not already cover. Git history preserves the
  audit if anyone needs to compare against an older deployment.
- `archive/` (364K) deleted in advance of the public flip.
  Investor-pitch material, eight historical `docker-compose-*.yml`
  variants, dev scripts that logged a seed password, old static HTML
  pages, ICE_INTEGRATION historical notes, and four
  fake/generated demo PDFs (Bayern BayKOM, NRW
  KI-Förderplattform, Dortmund Bürgerportal tender, Angebot
  ENTWURF). Git history covers anything anyone needs from there. The
  only active reference, `deploy.sh:8`, was updated to point at
  `make deploy` / `make dev-full` instead of the deleted legacy
  script.
- `tasks/STATUS.md` (62 lines, internal Codex Wave 1-5 status from
  2026-03-25). The `tasks/` directory was its only file and is gone.
- `backups/` empty Working-Tree directory created with `root:root`
  ownership by a Docker bind mount removed; added to `.gitignore`
  so a future container run does not put it back.
- Eight historical or internal-planning docs deleted after a triage
  pass: `docs/BYOA_V2.md`, `docs/IMPLEMENTATION_PLAN_2026-02-22.md`,
  `docs/MATRIX_MIGRATION.md`,
  `docs/SHARED_SECRETS_RUNNER_ARCHITECTURE_PLAN_2026-02-24.md`,
  `docs/SHARED_SECRETS_RUNNER_BACKLOG_2026-02-24.md`,
  `docs/HTTPS-SETUP.md`, `docs/PLATFORM_ROADMAP.md`,
  `docs/page-template.md`. None had in-repo cross-references.
  The ones that survive are the docs the README actually links plus
  the live-protocol references (`PLUGIN_ARCHITECTURE.md`,
  `quickstart-claude.md`, `mcp-agents.md`,
  `BYOA_SSE_ARCHITECTURE.md`,
  `AGENT_MEMORY_USAGE.md`, `ATLASSIAN_APP_REGISTRATION.md`,
  `AZURE_APP_REGISTRATION.md`, `SECURITY-AUDIT-2026-02-21.md`).

### Documentation
- Audit pass classified the surviving 9 `docs/*.md` files. Three
  follow-up tasks filed: rewrite `BYOA_SSE_ARCHITECTURE.md` against
  the shipped SSE+REST gateway; light-touch refresh on the two OAuth
  registration guides; light-touch polish on `AGENT_MEMORY_USAGE.md`
  for English summary plus placeholder host. `SECURITY-AUDIT-2026-02-21.md`
  is left in place pending a separate operator decision on
  transparency-vs-attack-surface.
