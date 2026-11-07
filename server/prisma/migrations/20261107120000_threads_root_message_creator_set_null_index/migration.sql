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
-- 4. messages(threadId): deleting a thread (a room delete cascades to its
--    threads) nulls messages.threadId through the SET NULL foreign key, and
--    the thread filter of the message list reads by it. Without the index each
--    deleted thread scanned the whole messages table: on 3 million messages
--    deleting a room with 40 threads failed after 5.2 s and one with 80 threads
--    after 10.1 s (the room delete has a 5 s transaction timeout), while a room
--    without threads took 0.2 s.
--
-- Additive: no column, row or constraint is dropped, and every existing row
-- keeps its values, except that a threads.createdBy naming no user is set to
-- NULL (step 2).
--
-- The table lock comes first. Adding the foreign keys takes locks on messages
-- and threads, and a migration that runs while messages are being inserted can
-- deadlock with those inserts; the database then aborts the migration, and a
-- failed migration stops the next deploy at P3009 until it is resolved by hand.
-- Taking the lock on messages up front makes the migration wait for running
-- inserts instead. Replayed against a copy of the schema with four concurrent
-- inserters: see the CHANGELOG entry for the measured counts.

LOCK TABLE "messages" IN SHARE ROW EXCLUSIVE MODE;

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

-- CreateIndex
CREATE INDEX "messages_threadId_idx" ON "messages"("threadId");

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_rootMessageId_fkey" FOREIGN KEY ("rootMessageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
