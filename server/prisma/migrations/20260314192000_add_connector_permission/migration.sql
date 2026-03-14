CREATE TABLE "connector_permissions" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "allowedActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "grantedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "connector_permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "connector_permissions_connectorId_userId_key" ON "connector_permissions"("connectorId", "userId");
ALTER TABLE "connector_permissions" ADD CONSTRAINT "connector_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
