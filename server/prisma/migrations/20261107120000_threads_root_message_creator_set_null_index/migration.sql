-- Threads become writable through the API.
--
-- 1. threads.rootMessageId: the room message a thread is about. Nullable,
--    unique (one message roots at most one thread), ON DELETE SET NULL. The
--    message itself is not touched when a thread is created from it.
-- 2. threads.createdBy: nullable with a foreign key to users, ON DELETE SET
--    NULL, the pattern of tasks.createdBy. Self-delete then nulls the column
--    instead of leaving the deleted user's id on the thread. The column had no
--    foreign key and nothing wrote it before, but any id that no longer names a
--    user is nulled first so the constraint can be added to existing rows.
-- 3. threads(roomId, lastActivity): the room's thread list is ordered by
--    lastActivity and would otherwise scan the whole table.
--
-- Additive; existing rows keep their values.

-- AlterTable
ALTER TABLE "threads" ADD COLUMN     "rootMessageId" TEXT,
ALTER COLUMN "createdBy" DROP NOT NULL;

UPDATE "threads" SET "createdBy" = NULL
WHERE "createdBy" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "threads"."createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "threads_rootMessageId_key" ON "threads"("rootMessageId");

-- CreateIndex
CREATE INDEX "threads_roomId_lastActivity_idx" ON "threads"("roomId", "lastActivity");

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_rootMessageId_fkey" FOREIGN KEY ("rootMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
