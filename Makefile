ENV_FILE := .env.local
ENV_TEMPLATE := .env.example
COMPOSE := docker compose --env-file $(ENV_FILE)

PROD_ENV_FILE := .env.ice
PROD_COMPOSE := docker compose -f docker-compose-ice.yml --env-file $(PROD_ENV_FILE)

.PHONY: install up down build rebuild logs status restart clean \
        shell-api shell-db db-migrate db-seed db-studio health \
        deploy deploy-down deploy-logs deploy-status

# ── Local Development ─────────────────────────────────────────────────────────

install: $(ENV_FILE)
	$(COMPOSE) up -d --build
	@echo ""
	@echo "Waiting for services..."
	@sleep 10
	@$(MAKE) --no-print-directory health
	@echo ""
	@echo "Triologue is running."
	@echo "  Frontend: http://localhost:3000"
	@echo "  API:      http://localhost:4001"

$(ENV_FILE):
	@echo "Creating $(ENV_FILE) from $(ENV_TEMPLATE)..."
	cp $(ENV_TEMPLATE) $(ENV_FILE)
	@JWT=$$(openssl rand -hex 32) && \
	 DBPW=$$(openssl rand -hex 16) && \
	 ICE=$$(openssl rand -hex 16) && \
	 LAVA=$$(openssl rand -hex 16) && \
	 sed -i "s|your-super-secret-jwt-key-change-in-production-make-it-long-and-random|$$JWT|" $(ENV_FILE) && \
	 sed -i "s|triologue_secure_password_change_me|$$DBPW|g" $(ENV_FILE) && \
	 sed -i "s|ICE_AI_TOKEN=ice-secure-token|ICE_AI_TOKEN=$$ICE\nICE_TOKEN=$$ICE|" $(ENV_FILE) && \
	 sed -i "s|LAVA_AI_TOKEN=lava-secure-token|LAVA_AI_TOKEN=$$LAVA\nLAVA_TOKEN=$$LAVA|" $(ENV_FILE) && \
	 sed -i "s|ADMIN_PASSWORD=change_this_secure_password|ADMIN_PASSWORD=test|" $(ENV_FILE)
	@echo "Generated secrets in $(ENV_FILE) — review before first run."
	@echo "  Default login: lan / test"

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

build:
	$(COMPOSE) build

rebuild:
	$(COMPOSE) up -d --build --force-recreate

logs:
	$(COMPOSE) logs -f

status:
	$(COMPOSE) ps

restart:
	$(COMPOSE) restart

clean:
	$(COMPOSE) down -v --remove-orphans
	@echo "Volumes removed. Data is gone."

shell-api:
	$(COMPOSE) exec api sh

shell-db:
	$(COMPOSE) exec postgres psql -U triologue_user -d triologue

db-migrate:
	$(COMPOSE) exec api npx prisma migrate deploy

db-seed:
	$(COMPOSE) exec api npx ts-node prisma/seed.ts

db-studio:
	$(COMPOSE) exec api npx prisma studio

health:
	@printf "postgres: " && ($(COMPOSE) exec -T postgres pg_isready -U triologue_user -d triologue > /dev/null 2>&1 && echo "ok" || echo "not ready")
	@printf "redis:    " && ($(COMPOSE) exec -T redis redis-cli ping 2>/dev/null | grep -q PONG && echo "ok" || echo "not ready")
	@printf "api:      " && (curl -sf http://localhost:4001/api/health > /dev/null 2>&1 && echo "ok" || echo "not ready")
	@printf "frontend: " && (curl -sf http://localhost:3000 > /dev/null 2>&1 && echo "ok" || echo "not ready")

# ── Production (triologue.duckdns.org) ────────────────────────────────────────

deploy: $(PROD_ENV_FILE)
	@docker volume create triologue_certbot_data > /dev/null 2>&1 || true
	@docker volume create triologue_certbot_www > /dev/null 2>&1 || true
	$(PROD_COMPOSE) up -d --build

deploy-down:
	$(PROD_COMPOSE) down

deploy-logs:
	$(PROD_COMPOSE) logs -f

deploy-status:
	$(PROD_COMPOSE) ps

$(PROD_ENV_FILE):
	@echo "Creating $(PROD_ENV_FILE) from $(ENV_TEMPLATE)..."
	cp $(ENV_TEMPLATE) $(PROD_ENV_FILE)
	@JWT=$$(openssl rand -hex 32) && \
	 DBPW=$$(openssl rand -hex 16) && \
	 ICE=$$(openssl rand -hex 16) && \
	 LAVA=$$(openssl rand -hex 16) && \
	 sed -i "s|your-super-secret-jwt-key-change-in-production-make-it-long-and-random|$$JWT|" $(PROD_ENV_FILE) && \
	 sed -i "s|triologue_secure_password_change_me|$$DBPW|g" $(PROD_ENV_FILE) && \
	 sed -i "s|ICE_AI_TOKEN=ice-secure-token|ICE_AI_TOKEN=$$ICE\nICE_TOKEN=$$ICE|" $(PROD_ENV_FILE) && \
	 sed -i "s|LAVA_AI_TOKEN=lava-secure-token|LAVA_AI_TOKEN=$$LAVA\nLAVA_TOKEN=$$LAVA|" $(PROD_ENV_FILE)
	@echo "Generated secrets in $(PROD_ENV_FILE) — review before deploying."
