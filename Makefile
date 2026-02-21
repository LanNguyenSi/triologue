# ============================================================================
# OpenTriologue — Makefile
#
# Usage:
#   make deploy      Production deploy (backup → build → restart)
#   make up          Start all services
#   make down        Stop all services (keeps data!)
#   make backup      pg_dump → backups/
#   make restore     Restore latest backup
#   make logs        Tail all logs
#   make status      Show service health
#   make dev         Local dev (no SSL)
#
# ⚠️  NEVER use `docker compose down -v` — it deletes the database!
# ============================================================================

SHELL := /bin/bash
COMPOSE := docker compose
BACKUP_DIR := ./backups
TIMESTAMP := $(shell date +%Y%m%d_%H%M%S)

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

# ── Development ─────────────────────────────────────────────────────────────

.PHONY: dev
dev: ## Local dev (HTTP only, port 3000)
	COMPOSE_FILE=docker-compose.yml $(COMPOSE) \
		-f docker-compose.yml \
		up -d \
		--build
	@echo "🔧 Dev mode: http://localhost:3000"

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
