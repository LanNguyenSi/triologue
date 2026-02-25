-- CreateTable project_attachments
CREATE TABLE "project_attachments" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "type" "AttachmentType" NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "sourcePluginId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_attachments_projectId_createdAt_idx"
ON "project_attachments"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "project_attachments"
ADD CONSTRAINT "project_attachments_projectId_fkey"
FOREIGN KEY ("projectId")
REFERENCES "projects"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_attachments"
ADD CONSTRAINT "project_attachments_uploadedBy_fkey"
FOREIGN KEY ("uploadedBy")
REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
