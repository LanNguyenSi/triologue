CREATE TABLE "integration_tokens" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_tokens_provider_scope_tenantId_key" ON "integration_tokens"("provider", "scope", "tenantId");
CREATE INDEX "integration_tokens_provider_idx" ON "integration_tokens"("provider");
CREATE INDEX "integration_tokens_status_idx" ON "integration_tokens"("status");

ALTER TABLE "integration_tokens" ADD CONSTRAINT "integration_tokens_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
