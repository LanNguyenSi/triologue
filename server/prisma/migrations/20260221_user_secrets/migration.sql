CREATE TABLE "user_secrets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "projectId" TEXT,
    "description" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "lastUsedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_secrets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_secrets_userId_name_key" ON "user_secrets"("userId", "name");

ALTER TABLE "user_secrets" ADD CONSTRAINT "user_secrets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_secrets" ADD CONSTRAINT "user_secrets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
