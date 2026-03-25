-- Add task creator for per-user connector token resolution
ALTER TABLE "tasks" ADD COLUMN "createdBy" TEXT;

UPDATE "tasks"
SET "createdBy" = "assignedTo"
WHERE "createdBy" IS NULL;

ALTER TABLE "tasks"
ALTER COLUMN "createdBy" SET NOT NULL;

ALTER TABLE "tasks"
ADD CONSTRAINT "tasks_createdBy_fkey"
FOREIGN KEY ("createdBy") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "tasks_createdBy_idx" ON "tasks"("createdBy");

-- Add optional per-user ownership for integration tokens
ALTER TABLE "integration_tokens" ADD COLUMN "userId" TEXT;

ALTER TABLE "integration_tokens"
ADD CONSTRAINT "integration_tokens_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "integration_tokens_userId_idx" ON "integration_tokens"("userId");

DROP INDEX IF EXISTS "integration_tokens_provider_scope_tenantId_key";
CREATE UNIQUE INDEX "integration_tokens_provider_scope_tenantId_userId_key"
ON "integration_tokens"("provider", "scope", "tenantId", "userId");
