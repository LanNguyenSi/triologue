-- AlterTable: Make agentId nullable in agent_audit_log (allow user deletion;
-- self-deletion via DELETE /api/auth/me anonymises the deleted user's audit
-- trail instead of blocking on the FK, see docs/okf/prisma-data-model-invariants.md
-- Invariant 6).
ALTER TABLE "agent_audit_log" ALTER COLUMN "agentId" DROP NOT NULL;

-- DropForeignKey: Drop existing foreign key constraint
ALTER TABLE "agent_audit_log" DROP CONSTRAINT "agent_audit_log_agentId_fkey";

-- AddForeignKey: Re-add with ON DELETE SET NULL
ALTER TABLE "agent_audit_log" ADD CONSTRAINT "agent_audit_log_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
