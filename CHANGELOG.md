# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Removed
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
