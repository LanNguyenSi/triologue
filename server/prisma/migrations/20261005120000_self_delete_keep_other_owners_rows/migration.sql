-- Self-delete (DELETE /api/auth/me) must not destroy rows that live inside a
-- project owned by someone else. These six creator-style columns were NOT NULL
-- with ON DELETE CASCADE, so deleting the creator deleted the row (and, for a
-- module instance, its runs) even when it sat in another owner's project.
-- They become nullable with ON DELETE SET NULL: the row survives with the
-- column nulled. Rows inside the deleting user's own projects still go with
-- the project (projects.ownerId stays CASCADE); agent_memory_entries the user
-- created without a project or in their own projects are deleted by an
-- explicit statement in the route's transaction, since SET NULL alone would
-- now keep them.
--
-- Hand-scoped to these six foreign keys, matching the precedent of
-- 20260923094230_self_delete_restrict_fks_invite_and_approval.

ALTER TABLE "tasks" DROP CONSTRAINT "tasks_createdBy_fkey";
ALTER TABLE "tasks" ALTER COLUMN "createdBy" DROP NOT NULL;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "plugin_module_instances" DROP CONSTRAINT "plugin_module_instances_createdBy_fkey";
ALTER TABLE "plugin_module_instances" ALTER COLUMN "createdBy" DROP NOT NULL;
ALTER TABLE "plugin_module_instances" ADD CONSTRAINT "plugin_module_instances_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "plugin_module_runs" DROP CONSTRAINT "plugin_module_runs_startedBy_fkey";
ALTER TABLE "plugin_module_runs" ALTER COLUMN "startedBy" DROP NOT NULL;
ALTER TABLE "plugin_module_runs" ADD CONSTRAINT "plugin_module_runs_startedBy_fkey" FOREIGN KEY ("startedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_plugin_links" DROP CONSTRAINT "project_plugin_links_linkedBy_fkey";
ALTER TABLE "project_plugin_links" ALTER COLUMN "linkedBy" DROP NOT NULL;
ALTER TABLE "project_plugin_links" ADD CONSTRAINT "project_plugin_links_linkedBy_fkey" FOREIGN KEY ("linkedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_attachments" DROP CONSTRAINT "project_attachments_uploadedBy_fkey";
ALTER TABLE "project_attachments" ALTER COLUMN "uploadedBy" DROP NOT NULL;
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_memory_entries" DROP CONSTRAINT "agent_memory_entries_createdBy_fkey";
ALTER TABLE "agent_memory_entries" ALTER COLUMN "createdBy" DROP NOT NULL;
ALTER TABLE "agent_memory_entries" ADD CONSTRAINT "agent_memory_entries_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

