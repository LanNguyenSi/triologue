-- AlterTable: Make webhookUrl optional (SSE agents don't need it)
ALTER TABLE "agent_tokens" ALTER COLUMN "webhookUrl" DROP NOT NULL;
