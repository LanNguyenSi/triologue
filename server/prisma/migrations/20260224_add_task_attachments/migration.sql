-- CreateTable task_attachments
CREATE TABLE "task_attachments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "type" "AttachmentType" NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_attachments_taskId_idx" ON "task_attachments"("taskId");

ALTER TABLE "task_attachments"
ADD CONSTRAINT "task_attachments_taskId_fkey"
FOREIGN KEY ("taskId")
REFERENCES "tasks"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
