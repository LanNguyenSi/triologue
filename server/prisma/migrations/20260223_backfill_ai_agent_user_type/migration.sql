-- Backfill deprecated AI user types to AI_AGENT after enum change was committed

UPDATE "users"
SET "userType" = 'AI_AGENT'
WHERE "userType" IN ('AI_ICE', 'AI_LAVA', 'AI_OTHER');
