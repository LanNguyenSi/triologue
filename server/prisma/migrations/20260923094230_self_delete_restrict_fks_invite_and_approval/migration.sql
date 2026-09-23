-- Hand-scoped to invite_codes.createdById and approval_request.requestedBy
-- only (task eb405d43, decision D-001). `prisma migrate dev --create-only`
-- against a scratch database also proposed dropping and re-adding four
-- unrelated foreign keys (project_secrets_projectId_fkey,
-- projects_ownerId_fkey, tasks_projectId_fkey, webhook_configs_projectId_fkey)
-- plus two index drops and one index rename, reflecting the same
-- pre-existing drift between server/prisma/migrations/ and schema.prisma
-- documented in docs/okf/prisma-data-model-invariants.md Invariant 6 and
-- tracked by task 6fd386a4; only the two statements below, for the two FKs
-- this task actually changes, are kept, matching that migration's precedent.
--
-- invite_codes.createdById: an unused invite code created by a
-- self-deleting user is deleted by the same DELETE /me transaction
-- (routes/auth.ts) before this FK is ever reached; a USED one survives with
-- createdById nulled here, since it is the audit record of who redeemed it.
ALTER TABLE "invite_codes" DROP CONSTRAINT "invite_codes_createdById_fkey";
ALTER TABLE "invite_codes" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- approval_request.requestedBy: a still-pending request from a
-- self-deleting requester is deleted by the same transaction before this FK
-- is ever reached; a decided (approved/rejected) one survives with
-- requestedBy nulled here, since it is the audit record of the decision.
ALTER TABLE "approval_request" DROP CONSTRAINT "approval_request_requestedBy_fkey";
ALTER TABLE "approval_request" ALTER COLUMN "requestedBy" DROP NOT NULL;
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
