# ============================================================================
# OpenTriologue — Makefile
#
# Usage:
#   make deploy      Production deploy (backup → build → restart)
#   make up          Start all services
#   make down        Stop all services (keeps data!)
#   make local-env   Create/fix local .env (incl. ENCRYPTION_KEY)
#   make migrate     Run Prisma migrations in api container
#   make backup      pg_dump → backups/
#   make restore     Restore latest backup
#   make logs        Tail all logs
#   make status      Show service health
#   make dev         Local backend stack (api+db+redis)
#   make dev-full    Full local stack incl. frontend on :3000
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
deploy: backup build restart status ## Full production deploy (safe)
	@echo "✅ Deploy complete!"

.PHONY: up
up: ## Start all services
	$(COMPOSE) up -d
	@echo "⏳ Waiting for health checks..."
	@sleep 10
	@$(MAKE) status

.PHONY: local-env
local-env: ## Ensure local .env exists and includes ENCRYPTION_KEY
	@if [ ! -f "$(ENV_FILE)" ]; then \
		if [ -f "$(ENV_LOCAL_FALLBACK)" ]; then \
			cp "$(ENV_LOCAL_FALLBACK)" "$(ENV_FILE)"; \
			echo "✅ Created $(ENV_FILE) from $(ENV_LOCAL_FALLBACK)"; \
		else \
			cp .env.example "$(ENV_FILE)"; \
			echo "✅ Created $(ENV_FILE) from .env.example"; \
		fi; \
	fi
	@if ! grep -q '^ENCRYPTION_KEY=' "$(ENV_FILE)"; then \
		KEY=$$(openssl rand -hex 32 2>/dev/null || od -An -N32 -tx1 /dev/urandom | tr -d ' \n'); \
		echo "ENCRYPTION_KEY=$$KEY" >> "$(ENV_FILE)"; \
		echo "✅ Added ENCRYPTION_KEY to $(ENV_FILE)"; \
	fi

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
	@echo "⏳ Waiting for health checks..."
	@sleep 15
	@$(MAKE) status

# ── Database ────────────────────────────────────────────────────────────────

.PHONY: backup
backup: ## pg_dump → backups/YYYYMMDD_HHMMSS.sql
	@mkdir -p $(BACKUP_DIR)
	$(COMPOSE) exec -T postgres pg_dump -U triologue_user triologue > $(BACKUP_DIR)/$(TIMESTAMP).sql
	@echo "✅ Backup: $(BACKUP_DIR)/$(TIMESTAMP).sql ($(shell wc -c < $(BACKUP_DIR)/$(TIMESTAMP).sql) bytes)"

.PHONY: restore
restore: ## Restore latest backup
	@LATEST=$$(ls -t $(BACKUP_DIR)/*.sql 2>/dev/null | head -1); \
	if [ -z "$$LATEST" ]; then echo "❌ No backups found"; exit 1; fi; \
	echo "⚠️  Restoring from $$LATEST ..."; \
	read -p "Are you sure? [y/N] " confirm; \
	if [ "$$confirm" = "y" ]; then \
		$(COMPOSE) exec -T postgres psql -U triologue_user -d triologue < $$LATEST; \
		echo "✅ Restored from $$LATEST"; \
	fi

.PHONY: backup-list
backup-list: ## List available backups
	@ls -lh $(BACKUP_DIR)/*.sql 2>/dev/null || echo "No backups found"

# ── Monitoring ──────────────────────────────────────────────────────────────

.PHONY: status
status: ## Show service health
	@$(COMPOSE) ps
	@echo ""
	@curl -sf http://localhost:4001/api/health && echo " ← API" || echo "❌ API down"
	@curl -sf http://localhost/ > /dev/null && echo "✅ Frontend up" || echo "❌ Frontend down"

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
dev: ## Local backend stack (api+db+redis)
	@$(MAKE) _dev MODE=api

.PHONY: dev-full
dev-full: ## Full local stack incl. frontend reverse proxy on :3000
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
		COMPOSE_FILE=docker-compose.yml $(COMPOSE) -f docker-compose.yml up -d --build postgres redis api; \
		echo "⏳ Waiting for API to become healthy..."; \
		sleep 10; \
		$(MAKE) migrate || true; \
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
		$(MAKE) backup; \
		$(COMPOSE) down -v; \
		echo "💀 Everything deleted. Backup saved."; \
	else \
		echo "Cancelled."; \
	fi

# ── Help ────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
