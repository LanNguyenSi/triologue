import { PrismaClient, Project } from '@prisma/client';

/** A client that can run a raw statement: the root client or a transaction client. */
type RawExecutor = Pick<PrismaClient, '$executeRaw'>;
type ProjectReader = Pick<PrismaClient, 'project'>;

/**
 * Add `userIds` to `projects.teamMemberIds`, atomically, in one UPDATE.
 *
 * A writer that reads the array and writes back a whole new one loses every
 * member another writer committed in between (READ COMMITTED lets both read
 * the old array). Here the new array is computed by the database from the
 * row version the UPDATE locks: the project row lock serialises concurrent
 * calls, and a call that waited re-evaluates the expression against the row
 * the previous one committed, so no member is dropped.
 *
 * The resulting array holds the owner first, then the stored members in their
 * stored order, then each id of `userIds` that was not present, in input order,
 * without duplicates. Empty ids are ignored. The row is written only when an
 * id is missing or the owner is absent; otherwise the statement matches no
 * row, which keeps no-op syncs from taking a row lock.
 *
 * Returns true when the row was changed. A project that does not exist
 * returns false, like a team that already has every id.
 *
 * Callable with the root client or a transaction client. Lock order: this
 * statement takes the project row lock; a transaction that also touches the
 * linked room must lock the project row before the room row (see the room
 * delete route).
 */
export async function addProjectTeamMembers(
  db: RawExecutor,
  projectId: string,
  userIds: readonly string[],
): Promise<boolean> {
  const ids = Array.from(new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0)));
  const changed = await db.$executeRaw`
    UPDATE "projects" AS p
    SET "teamMemberIds" = ARRAY(
          SELECT s.id
          FROM (
            SELECT p."ownerId" AS id, 0 AS grp, 0::bigint AS ord
            UNION ALL
            SELECT e.id, 1, e.ord
            FROM unnest(p."teamMemberIds") WITH ORDINALITY AS e(id, ord)
            UNION ALL
            SELECT n.id, 2, n.ord
            FROM unnest(${ids}::text[]) WITH ORDINALITY AS n(id, ord)
          ) AS s
          GROUP BY s.id
          ORDER BY min(s.grp), min(s.ord)
        ),
        "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE p."id" = ${projectId}
      AND (
        NOT (p."teamMemberIds" @> ${ids}::text[])
        OR NOT (p."ownerId" = ANY(p."teamMemberIds"))
      )
  `;
  return changed > 0;
}

/**
 * `addProjectTeamMembers`, then the project row as it stands after the write
 * (null when the project does not exist). For callers that return the project.
 */
export async function addProjectTeamMembersAndLoad(
  db: RawExecutor & ProjectReader,
  projectId: string,
  userIds: readonly string[],
): Promise<Project | null> {
  await addProjectTeamMembers(db, projectId, userIds);
  return db.project.findUnique({ where: { id: projectId } });
}
