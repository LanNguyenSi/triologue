-- Add workflow config to projects
ALTER TABLE "projects"
ADD COLUMN "workflowConfig" JSONB NOT NULL DEFAULT '{}';
