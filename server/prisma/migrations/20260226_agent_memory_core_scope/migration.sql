-- AlterTable agent_memory_entries
ALTER TABLE "agent_memory_entries"
ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'PROJECT',
ADD COLUMN "title" TEXT,
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "updatedBy" TEXT;

-- Make project optional for GLOBAL memory scope
ALTER TABLE "agent_memory_entries"
ALTER COLUMN "projectId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "agent_memory_entries_scope_createdAt_idx"
ON "agent_memory_entries"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "agent_memory_entries_scope_projectId_archivedAt_createdAt_idx"
ON "agent_memory_entries"("scope", "projectId", "archivedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "agent_memory_entries"
ADD CONSTRAINT "agent_memory_entries_updatedBy_fkey"
FOREIGN KEY ("updatedBy")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
