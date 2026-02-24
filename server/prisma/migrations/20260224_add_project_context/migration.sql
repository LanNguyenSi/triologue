ALTER TABLE "projects"
ADD COLUMN "projectContext" JSONB NOT NULL DEFAULT '{}';
