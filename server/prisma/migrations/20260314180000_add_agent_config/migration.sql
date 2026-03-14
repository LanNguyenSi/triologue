-- AlterTable
ALTER TABLE "agent_tokens" ADD COLUMN "config" JSONB NOT NULL DEFAULT '{}';
