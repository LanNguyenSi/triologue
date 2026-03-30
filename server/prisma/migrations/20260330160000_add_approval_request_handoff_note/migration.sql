-- CreateTable
CREATE TABLE "approval_request" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "actionInput" JSONB NOT NULL DEFAULT '{}',
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "approval_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_request_requestedBy_idx" ON "approval_request"("requestedBy");

-- CreateIndex
CREATE INDEX "approval_request_taskId_idx" ON "approval_request"("taskId");

-- CreateIndex
CREATE INDEX "approval_request_status_idx" ON "approval_request"("status");

-- CreateIndex
CREATE INDEX "approval_request_createdAt_idx" ON "approval_request"("createdAt");

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: add handoffNote to tasks
ALTER TABLE "tasks" ADD COLUMN "handoffNote" JSONB;
