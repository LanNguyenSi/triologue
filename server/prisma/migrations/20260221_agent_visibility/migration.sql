-- Add visibility and sharedWith to agent_tokens
ALTER TABLE "agent_tokens" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';
ALTER TABLE "agent_tokens" ADD COLUMN "sharedWith" TEXT[] DEFAULT '{}';

-- Set existing elevated agents (Ice, Lava) to public
UPDATE "agent_tokens" SET "visibility" = 'public' WHERE "trustLevel" = 'elevated';
