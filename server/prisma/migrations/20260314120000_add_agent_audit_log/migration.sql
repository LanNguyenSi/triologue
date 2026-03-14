CREATE TABLE "agent_audit_log" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "projectId" TEXT,
    "roomId" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "success" BOOLEAN NOT NULL DEFAULT true,
    "durationMs" INTEGER,

    CONSTRAINT "agent_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_audit_log_agentId_idx" ON "agent_audit_log"("agentId");

CREATE INDEX "agent_audit_log_projectId_idx" ON "agent_audit_log"("projectId");

CREATE INDEX "agent_audit_log_timestamp_idx" ON "agent_audit_log"("timestamp");

CREATE INDEX "agent_audit_log_action_idx" ON "agent_audit_log"("action");

ALTER TABLE "agent_audit_log" ADD CONSTRAINT "agent_audit_log_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
