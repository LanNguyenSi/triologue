-- Link projects to private rooms and enforce assignee on tasks

-- 1) Project ↔ Room link (1:1, optional)
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "roomId" TEXT;

-- Backfill roomId from deterministic default naming if room exists
UPDATE "projects" p
SET "roomId" = candidate.id
FROM (
  SELECT r.id, split_part(r.id, '-room-', 1) AS project_id
  FROM "rooms" r
  WHERE r.id LIKE '%-room-%'
) AS candidate
WHERE p.id = candidate.project_id
  AND p."roomId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "projects_roomId_key" ON "projects"("roomId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_roomId_fkey'
  ) THEN
    ALTER TABLE "projects"
      ADD CONSTRAINT "projects_roomId_fkey"
      FOREIGN KEY ("roomId") REFERENCES "rooms"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 2) Tasks must always have an assignee
UPDATE "tasks" t
SET "assignedTo" = p."ownerId"
FROM "projects" p
WHERE t."projectId" = p."id"
  AND t."assignedTo" IS NULL;

ALTER TABLE "tasks" ALTER COLUMN "assignedTo" SET NOT NULL;
