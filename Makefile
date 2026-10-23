# ============================================================================
# OpenTriologue — Makefile
#
# Usage:
#   make deploy      Production deploy (backup → build → restart → status)
#   make up          Start all services
#   make down        Stop all services (keeps data!)
#   make local-env   Create/fix local .env (incl. JWT_SECRET and ENCRYPTION_KEY)
#   make migrate     Run Prisma migrations in api container
#   make backup      dump + uploads + api_data archives → backups/
#   make restore     Restore latest backup
#   make logs        Tail all logs
#   make status      Wait for health and report (non-zero if not healthy)
#   make dev         Local backend stack (api+db+redis) on the dev project
#   make dev-full    Full local stack incl. frontend :3000 on the dev project
#
# ⚠️  NEVER use `docker compose down -v` — it deletes the database!
# ============================================================================

SHELL := /bin/bash
COMPOSE := docker compose
BACKUP_DIR := ./backups
TIMESTAMP := $(shell date +%Y%m%d_%H%M%S)
ENV_FILE := .env
ENV_LOCAL_FALLBACK := .env.local
DEV_COMPOSE_FILE := docker-compose.dev.yml

# ── Production ──────────────────────────────────────────────────────────────

.PHONY: deploy
deploy: backup build restart ## Full production deploy (safe; restart ends in status)
	@echo "✅ Deploy complete!"

.PHONY: up
up: ## Start all services
	$(COMPOSE) up -d
	@echo "⏳ Waiting for health checks..."
	@$(MAKE) status

.PHONY: local-env
local-env: ## Ensure local .env exists and has real JWT_SECRET and ENCRYPTION_KEY
	@if [ ! -f "$(ENV_FILE)" ]; then \
		if [ -f "$(ENV_LOCAL_FALLBACK)" ]; then \
			cp "$(ENV_LOCAL_FALLBACK)" "$(ENV_FILE)"; \
			echo "✅ Created $(ENV_FILE) from $(ENV_LOCAL_FALLBACK)"; \
		else \
			cp .env.example "$(ENV_FILE)"; \
			echo "✅ Created $(ENV_FILE) from .env.example"; \
		fi; \
	fi
	@# A secret is (re)generated when it is missing, empty or whitespace-only, or
	@# still equal to the placeholder that .env.example ships (the server refuses
	@# to start with any of these). The last assignment wins, as in dotenv, and an
	@# `export VAR=` or indented line counts as an assignment.
	@for VAR in JWT_SECRET ENCRYPTION_KEY; do \
		CUR=$$(grep -E "^[[:space:]]*(export[[:space:]]+)?$$VAR=" "$(ENV_FILE)" | tail -n 1 | cut -d= -f2- | tr -d "\"'" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$$//'); \
		PLACEHOLDER=$$(grep "^$$VAR=" .env.example | tail -n 1 | cut -d= -f2- | tr -d "\"'"); \
		if [ -z "$$CUR" ] || [ "$$CUR" = "$$PLACEHOLDER" ]; then \
			KEY=$$(openssl rand -hex 32 2>/dev/null || od -An -N32 -tx1 /dev/urandom | tr -d ' \n'); \
			TMP=$$(mktemp) || exit 1; \
			grep -Ev "^[[:space:]]*(export[[:space:]]+)?$$VAR=" "$(ENV_FILE)" > "$$TMP" || true; \
			echo "$$VAR=$$KEY" >> "$$TMP"; \
			cat "$$TMP" > "$(ENV_FILE)"; \
			rm -f "$$TMP"; \
			echo "✅ Generated $$VAR in $(ENV_FILE)"; \
		fi; \
	done

.PHONY: migrate
migrate: ## Run Prisma migrations in api container
	@set -e; \
	if $(COMPOSE) run --rm --no-deps --entrypoint "" api sh -lc "npx prisma migrate deploy"; then \
		echo "✅ Prisma migrations applied"; \
	else \
		echo "⚠️  migrate deploy failed. Trying local recovery for known failed migrations..."; \
		$(COMPOSE) run --rm --no-deps --entrypoint "" api sh -lc "npx prisma migrate resolve --rolled-back 20260221_agent_visibility" || true; \
		$(COMPOSE) run --rm --no-deps --entrypoint "" api sh -lc "npx prisma migrate resolve --rolled-back 20260221_byoa_unified_agents" || true; \
		$(COMPOSE) run --rm --no-deps --entrypoint "" api sh -lc "npx prisma migrate deploy"; \
		echo "✅ Prisma migrations applied (after recovery)"; \
	fi

.PHONY: down
down: ## Stop services (keeps data!)
	$(COMPOSE) down
	@echo "⚠️  Services stopped. Data intact."

.PHONY: build
build: ## Rebuild all images
	$(COMPOSE) build

.PHONY: restart
restart: ## Restart all services
	$(COMPOSE) down
	$(COMPOSE) up -d
	@echo "⏳ Waiting for containers to become healthy..."
	@$(MAKE) status

# ── Database ────────────────────────────────────────────────────────────────

.PHONY: backup
backup: ## Dump + uploads + api_data archives → backups/YYYYMMDD_HHMMSS.* (validated + rotated, see scripts/backup.sh)
	@BACKUP_DIR="$(BACKUP_DIR)" ./scripts/backup.sh

.PHONY: restore
restore: ## Restore latest backup
	@LATEST=$$(ls -t "$(BACKUP_DIR)"/*.sql 2>/dev/null | head -1); \
	if [ -z "$$LATEST" ]; then echo "❌ No backups found"; exit 1; fi; \
	echo "⚠️  Restoring from $$LATEST ..."; \
	read -p "Are you sure? [y/N] " confirm; \
	if [ "$$confirm" = "y" ]; then \
		$(COMPOSE) exec -T postgres psql -v ON_ERROR_STOP=1 -U triologue_user -d triologue < "$$LATEST"; \
		echo "✅ Restored from $$LATEST"; \
	fi

.PHONY: backup-list
backup-list: ## List available backups (dumps, uploads and api_data archives)
	@ls -lh "$(BACKUP_DIR)"/*.sql "$(BACKUP_DIR)"/*.uploads.tar.gz "$(BACKUP_DIR)"/*.api_data.tar.gz 2>/dev/null | grep . || echo "No backups found"

.PHONY: backup-freshness
backup-freshness: ## Alarm if the newest backup is stale or empty (see scripts/check-backup-freshness.sh)
	@BACKUP_DIR="$(BACKUP_DIR)" ./scripts/check-backup-freshness.sh

# ── Monitoring ──────────────────────────────────────────────────────────────

.PHONY: status
status: ## Wait for health and report (non-zero if not healthy)
	@$(COMPOSE) ps
	@echo ""
	@HEALTH_TIMEOUT="$(HEALTH_TIMEOUT)" HEALTH_INTERVAL="$(HEALTH_INTERVAL)" ./scripts/wait-healthy.sh triologue-api triologue-frontend triologue-postgres
	@curl -sf http://localhost:4001/api/health > /dev/null && echo "ℹ️  API also answered /api/health on host :4001" || true

.PHONY: logs
logs: ## Tail all logs
	$(COMPOSE) logs -f --tail=50

.PHONY: logs-api
logs-api: ## Tail API logs
	$(COMPOSE) logs -f --tail=50 api

.PHONY: logs-frontend
logs-frontend: ## Tail frontend logs
	$(COMPOSE) logs -f --tail=50 frontend

.PHONY: docs
docs: docs-openapi docs-ui ## Fetch OpenAPI spec and print Swagger UI URL

.PHONY: docs-openapi
docs-openapi: ## Download local OpenAPI spec to /tmp/triologue-openapi.yaml
	@curl -sf http://localhost:4001/api/openapi.yaml > /tmp/triologue-openapi.yaml && \
		echo "✅ OpenAPI fetched: /tmp/triologue-openapi.yaml" && \
		echo "🔎 Source: http://localhost:4001/api/openapi.yaml" || \
		(echo "❌ API not reachable or spec missing. Start API first (make dev/dev-full)."; exit 1)

.PHONY: docs-ui
docs-ui: ## Show local Swagger UI endpoint
	@echo "📘 Swagger UI: http://localhost:4001/api/docs"
	@echo "📄 OpenAPI:    http://localhost:4001/api/openapi.yaml"

# ── Development ─────────────────────────────────────────────────────────────

.PHONY: dev
dev: ## Local backend stack (api+db+redis) on the dev project
	@$(MAKE) _dev MODE=api

.PHONY: dev-full
dev-full: ## Full local stack incl. frontend reverse proxy :3000 on the dev project
	@$(MAKE) _dev MODE=full

.PHONY: _dev
_dev: local-env
	@set -e; \
	if [ "$(MODE)" = "full" ]; then \
		COMPOSE_FILE=$(DEV_COMPOSE_FILE) $(COMPOSE) -f $(DEV_COMPOSE_FILE) up -d --build; \
		echo "⏳ Waiting for API to become healthy..."; \
		sleep 10; \
		$(MAKE) migrate COMPOSE="docker compose -f $(DEV_COMPOSE_FILE)" || true; \
		echo "🔧 API: http://localhost:4001"; \
		echo "🖥️  Frontend: http://localhost:3000"; \
	else \
		COMPOSE_FILE=$(DEV_COMPOSE_FILE) $(COMPOSE) -f $(DEV_COMPOSE_FILE) up -d --build postgres redis api; \
		echo "⏳ Waiting for API to become healthy..."; \
		sleep 10; \
		$(MAKE) migrate COMPOSE="docker compose -f $(DEV_COMPOSE_FILE)" || true; \
		echo "🔧 API: http://localhost:4001"; \
		echo "🖥️  Frontend lokal starten: cd client && npm run dev"; \
	fi

# ── Cleanup ─────────────────────────────────────────────────────────────────

.PHONY: clean
clean: ## Remove old images (keeps data!)
	docker image prune -f
	@echo "✅ Old images removed. Data intact."

# DANGER ZONE — requires explicit confirmation
.PHONY: nuke
nuke: ## ⚠️  DELETE EVERYTHING (database, volumes, images)
	@echo "🚨 This will DELETE ALL DATA including the database!"
	@read -p "Type 'DELETE EVERYTHING' to confirm: " confirm; \
	if [ "$$confirm" = "DELETE EVERYTHING" ]; then \
		$(MAKE) backup && $(COMPOSE) down -v && echo "💀 Everything deleted. Backup saved."; \
	else \
		echo "Cancelled."; \
	fi

# ── Help ────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
