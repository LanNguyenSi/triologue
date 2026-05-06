# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Documentation
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
