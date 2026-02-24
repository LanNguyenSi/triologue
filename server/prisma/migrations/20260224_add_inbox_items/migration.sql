-- CreateTable inbox_items
CREATE TABLE "inbox_items" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "link" TEXT,
    "metadata" JSONB,
    "projectId" TEXT,
    "roomId" TEXT,
    "taskId" TEXT,
    "messageId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inbox_items_recipientId_createdAt_idx" ON "inbox_items"("recipientId", "createdAt");
CREATE INDEX "inbox_items_recipientId_isRead_idx" ON "inbox_items"("recipientId", "isRead");
CREATE INDEX "inbox_items_recipientId_archivedAt_idx" ON "inbox_items"("recipientId", "archivedAt");
CREATE INDEX "inbox_items_projectId_idx" ON "inbox_items"("projectId");
CREATE INDEX "inbox_items_roomId_idx" ON "inbox_items"("roomId");
CREATE INDEX "inbox_items_taskId_idx" ON "inbox_items"("taskId");

ALTER TABLE "inbox_items"
ADD CONSTRAINT "inbox_items_recipientId_fkey"
FOREIGN KEY ("recipientId")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "inbox_items"
ADD CONSTRAINT "inbox_items_actorId_fkey"
FOREIGN KEY ("actorId")
REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
