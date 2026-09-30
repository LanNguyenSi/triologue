-- Reconcile the migration history with schema.prisma (task 6fd386a4).
--
-- Generated with `prisma migrate diff --from-migrations prisma/migrations
-- --to-schema-datamodel prisma/schema.prisma --script` and kept verbatim.
-- It brings four foreign keys to the ON UPDATE CASCADE that the schema
-- declares (the ON DELETE CASCADE behaviour is unchanged) and renames one
-- index whose name was truncated by Postgres to the name Prisma derives for
-- it. task_attachments_taskId_idx and tasks_createdBy_idx are kept: the
-- schema now declares them with @@index, so no index is dropped. No column,
-- type or delete-behaviour change.
--
-- Lock cost: each foreign key is dropped and re-added, which takes an
-- ACCESS EXCLUSIVE lock on the child table and a SHARE ROW EXCLUSIVE lock on
-- the parent, and the re-add validates every existing child row. The
-- RENAME INDEX is catalog-only.

-- DropForeignKey
ALTER TABLE "project_secrets" DROP CONSTRAINT "project_secrets_projectId_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_projectId_fkey";

-- DropForeignKey
ALTER TABLE "webhook_configs" DROP CONSTRAINT "webhook_configs_projectId_fkey";

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_secrets" ADD CONSTRAINT "project_secrets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_configs" ADD CONSTRAINT "webhook_configs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "plugin_module_runs_pluginId_moduleKey_projectId_roomId_startedA" RENAME TO "plugin_module_runs_pluginId_moduleKey_projectId_roomId_star_idx";

