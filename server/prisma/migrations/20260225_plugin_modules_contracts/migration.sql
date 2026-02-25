-- CreateTable plugin_module_instances
CREATE TABLE "plugin_module_instances" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_module_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable plugin_module_runs
CREATE TABLE "plugin_module_runs" (
    "id" TEXT NOT NULL,
    "moduleInstanceId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'started',
    "runInput" JSONB NOT NULL DEFAULT '{}',
    "runOutput" JSONB,
    "errorText" TEXT,
    "startedBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plugin_module_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable plugin_task_syncs
CREATE TABLE "plugin_task_syncs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "moduleRunId" TEXT NOT NULL,
    "syncKey" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugin_task_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plugin_module_instances_pluginId_moduleKey_projectId_roomId_key"
ON "plugin_module_instances"("pluginId", "moduleKey", "projectId", "roomId");

-- CreateIndex
CREATE INDEX "plugin_module_instances_projectId_roomId_idx"
ON "plugin_module_instances"("projectId", "roomId");

-- CreateIndex
CREATE INDEX "plugin_module_runs_pluginId_moduleKey_projectId_roomId_startedAt_idx"
ON "plugin_module_runs"("pluginId", "moduleKey", "projectId", "roomId", "startedAt");

-- CreateIndex
CREATE INDEX "plugin_module_runs_projectId_roomId_status_idx"
ON "plugin_module_runs"("projectId", "roomId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "plugin_task_syncs_projectId_syncKey_key"
ON "plugin_task_syncs"("projectId", "syncKey");

-- CreateIndex
CREATE INDEX "plugin_task_syncs_roomId_idx"
ON "plugin_task_syncs"("roomId");

-- CreateIndex
CREATE INDEX "plugin_task_syncs_moduleRunId_idx"
ON "plugin_task_syncs"("moduleRunId");

-- CreateIndex
CREATE INDEX "plugin_task_syncs_taskId_idx"
ON "plugin_task_syncs"("taskId");

-- AddForeignKey
ALTER TABLE "plugin_module_instances"
ADD CONSTRAINT "plugin_module_instances_projectId_fkey"
FOREIGN KEY ("projectId")
REFERENCES "projects"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_module_instances"
ADD CONSTRAINT "plugin_module_instances_roomId_fkey"
FOREIGN KEY ("roomId")
REFERENCES "rooms"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_module_instances"
ADD CONSTRAINT "plugin_module_instances_createdBy_fkey"
FOREIGN KEY ("createdBy")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_module_runs"
ADD CONSTRAINT "plugin_module_runs_moduleInstanceId_fkey"
FOREIGN KEY ("moduleInstanceId")
REFERENCES "plugin_module_instances"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_module_runs"
ADD CONSTRAINT "plugin_module_runs_projectId_fkey"
FOREIGN KEY ("projectId")
REFERENCES "projects"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_module_runs"
ADD CONSTRAINT "plugin_module_runs_roomId_fkey"
FOREIGN KEY ("roomId")
REFERENCES "rooms"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_module_runs"
ADD CONSTRAINT "plugin_module_runs_startedBy_fkey"
FOREIGN KEY ("startedBy")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_task_syncs"
ADD CONSTRAINT "plugin_task_syncs_projectId_fkey"
FOREIGN KEY ("projectId")
REFERENCES "projects"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_task_syncs"
ADD CONSTRAINT "plugin_task_syncs_roomId_fkey"
FOREIGN KEY ("roomId")
REFERENCES "rooms"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_task_syncs"
ADD CONSTRAINT "plugin_task_syncs_moduleRunId_fkey"
FOREIGN KEY ("moduleRunId")
REFERENCES "plugin_module_runs"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_task_syncs"
ADD CONSTRAINT "plugin_task_syncs_taskId_fkey"
FOREIGN KEY ("taskId")
REFERENCES "tasks"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
