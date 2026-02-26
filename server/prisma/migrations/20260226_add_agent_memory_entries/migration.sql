-- CreateTable agent_memory_entries
CREATE TABLE "agent_memory_entries" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "roomId" TEXT,
    "pluginId" TEXT NOT NULL,
    "moduleKey" TEXT,
    "memoryType" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sourceRunId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_memory_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_memory_entries_projectId_memoryType_createdAt_idx"
ON "agent_memory_entries"("projectId", "memoryType", "createdAt");

-- CreateIndex
CREATE INDEX "agent_memory_entries_projectId_expiresAt_idx"
ON "agent_memory_entries"("projectId", "expiresAt");

-- CreateIndex
CREATE INDEX "agent_memory_entries_projectId_pluginId_moduleKey_createdAt_idx"
ON "agent_memory_entries"("projectId", "pluginId", "moduleKey", "createdAt");

-- CreateIndex
CREATE INDEX "agent_memory_entries_roomId_idx"
ON "agent_memory_entries"("roomId");

-- AddForeignKey
ALTER TABLE "agent_memory_entries"
ADD CONSTRAINT "agent_memory_entries_projectId_fkey"
FOREIGN KEY ("projectId")
REFERENCES "projects"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memory_entries"
ADD CONSTRAINT "agent_memory_entries_roomId_fkey"
FOREIGN KEY ("roomId")
REFERENCES "rooms"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memory_entries"
ADD CONSTRAINT "agent_memory_entries_createdBy_fkey"
FOREIGN KEY ("createdBy")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memory_entries"
ADD CONSTRAINT "agent_memory_entries_sourceRunId_fkey"
FOREIGN KEY ("sourceRunId")
REFERENCES "plugin_module_runs"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
