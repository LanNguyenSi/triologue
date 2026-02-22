-- Add visibility and sharedWith to agent_tokens
ALTER TABLE "agent_tokens" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'private';
ALTER TABLE "agent_tokens" ADD COLUMN IF NOT EXISTS "sharedWith" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Set existing elevated agents (Ice, Lava) to public
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent_tokens'
      AND column_name = 'trustLevel'
  ) THEN
    UPDATE "agent_tokens" SET "visibility" = 'public' WHERE "trustLevel" = 'elevated';
  END IF;
END $$;
