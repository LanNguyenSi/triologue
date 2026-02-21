-- Add per-agent webhook secret
ALTER TABLE "agent_tokens" ADD COLUMN "webhookSecret" TEXT;
