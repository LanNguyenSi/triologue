-- Add visibility columns to agent_tokens table
ALTER TABLE "agent_tokens" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'private';
ALTER TABLE "agent_tokens" ADD COLUMN IF NOT EXISTS "sharedWith" TEXT[] DEFAULT ARRAY[]::TEXT[];
