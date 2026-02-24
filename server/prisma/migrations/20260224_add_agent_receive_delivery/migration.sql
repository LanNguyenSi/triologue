-- AlterTable: Add receiveMode and delivery columns to agent_tokens
ALTER TABLE "agent_tokens" ADD COLUMN IF NOT EXISTS "receiveMode" TEXT NOT NULL DEFAULT 'mentions';
ALTER TABLE "agent_tokens" ADD COLUMN IF NOT EXISTS "delivery" TEXT NOT NULL DEFAULT 'webhook';

-- Set existing agents
UPDATE "agent_tokens" SET "delivery" = 'openclaw-inject' WHERE "mentionKey" = 'ice';
UPDATE "agent_tokens" SET "receiveMode" = 'mentions' WHERE "receiveMode" IS NULL;
