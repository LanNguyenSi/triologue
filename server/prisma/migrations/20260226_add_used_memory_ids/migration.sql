-- AlterTable tasks
ALTER TABLE "tasks"
ADD COLUMN "usedMemoryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable plugin_module_runs
ALTER TABLE "plugin_module_runs"
ADD COLUMN "usedMemoryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
