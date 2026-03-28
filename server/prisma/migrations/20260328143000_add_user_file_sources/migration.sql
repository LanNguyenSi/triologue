CREATE TABLE "user_file_sources" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "siteUrl" TEXT,
    "siteId" TEXT,
    "siteName" TEXT,
    "driveId" TEXT,
    "driveName" TEXT,
    "webUrl" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_file_sources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_file_sources_userId_provider_updatedAt_idx" ON "user_file_sources"("userId", "provider", "updatedAt");

ALTER TABLE "user_file_sources" ADD CONSTRAINT "user_file_sources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
