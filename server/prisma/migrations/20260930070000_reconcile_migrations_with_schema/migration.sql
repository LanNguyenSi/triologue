-- Reconcile the migration history with schema.prisma (task 6fd386a4).
--
-- Starting point: the statements `prisma migrate diff --from-migrations
-- prisma/migrations --to-schema-datamodel prisma/schema.prisma --script`
-- generated for the four foreign keys and the index rename, made re-runnable
-- because this migration must apply on two database states:
--
--   (a) a database built from the migrations only, where the four foreign keys
--       still lack ON UPDATE CASCADE and the plugin_module_runs index still has
--       the name Postgres truncated;
--   (b) the production database, which `prisma db push` (the deploy hook in
--       .relay.yml, removed by the same task) already brought to the schema:
--       the foreign keys carry ON UPDATE CASCADE, the index is already renamed,
--       and tasks_createdBy_idx and task_attachments_taskId_idx are missing.
--
-- Both states end identical to schema.prisma. The four foreign keys get
-- ON UPDATE CASCADE (ON DELETE CASCADE is unchanged), the truncated index name
-- becomes the one Prisma derives, and the two indexes that schema.prisma now
-- declares with @@index are created if absent. No column, type or
-- delete-behaviour change, and no index is dropped.
--
-- Lock cost: Prisma runs the file in one transaction, so every lock is held
-- to commit. Dropping and re-adding the four foreign keys takes ACCESS
-- EXCLUSIVE on the child tables (projects, tasks, project_secrets,
-- webhook_configs) and, because the drop removes the parent-side triggers, on
-- the parent tables (users, projects) for the duration of the migration; the
-- re-add scans every child row to validate it. ALTER INDEX ... RENAME takes
-- SHARE UPDATE EXCLUSIVE on the index. A non-concurrent CREATE INDEX takes a
-- SHARE lock on its table (blocks writes, not reads) in both database states
-- and builds the index only when it is absent (database state b).

-- DropForeignKey
ALTER TABLE "project_secrets" DROP CONSTRAINT IF EXISTS "project_secrets_projectId_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_projectId_fkey";

-- DropForeignKey
ALTER TABLE "webhook_configs" DROP CONSTRAINT IF EXISTS "webhook_configs_projectId_fkey";

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_secrets" ADD CONSTRAINT "project_secrets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_configs" ADD CONSTRAINT "webhook_configs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex (only when the truncated name exists and the target name does not)
DO $$
BEGIN
  IF to_regclass('"plugin_module_runs_pluginId_moduleKey_projectId_roomId_startedA"') IS NOT NULL
     AND to_regclass('"plugin_module_runs_pluginId_moduleKey_projectId_roomId_star_idx"') IS NULL THEN
    ALTER INDEX "plugin_module_runs_pluginId_moduleKey_projectId_roomId_startedA" RENAME TO "plugin_module_runs_pluginId_moduleKey_projectId_roomId_star_idx";
  END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tasks_createdBy_idx" ON "tasks"("createdBy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "task_attachments_taskId_idx" ON "task_attachments"("taskId");
