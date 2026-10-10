-- Self-delete (DELETE /api/auth/me): project_secrets.createdBy is a plain
-- string with no foreign key, so deleting the creator left the id behind on
-- secrets that sit inside another owner's project. The column becomes
-- nullable and the route's transaction nulls it for the deleting user, the
-- same end state the six creator foreign keys of
-- 20261005120000_self_delete_keep_other_owners_rows reach through SET NULL.
-- No foreign key is added: existing rows may name users that are already
-- gone, and a new constraint would fail on them.

ALTER TABLE "project_secrets" ALTER COLUMN "createdBy" DROP NOT NULL;
