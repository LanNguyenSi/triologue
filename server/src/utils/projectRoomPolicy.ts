import { PrismaClient } from "@prisma/client";

export const NAV_HIDDEN_PROJECT_STATUSES = new Set(["archived", "closed"]);
export const WRITE_BLOCKED_PROJECT_STATUS = "closed";

// System rooms provisioned outside the normal room UI — e.g. "registration",
// the staging room every agent account is unconditionally upserted into
// (routes/agents.ts) and that humans may also auto-join via auth.ts's
// "auto-join all public rooms on registration" step if it is a public room.
// Membership in one of these is not a meaningful signal of "this user shares
// a room with me": it must stay excluded from user-facing room listings
// (routes/batch.ts, routes/rooms.ts) AND from any "users visible to me"
// computation derived from shared-room membership (routes/batch.ts's
// dashboard onlineUsers scoping) — near-universal membership in a hidden
// system room would otherwise leak scoping back toward "everyone".
export const HIDDEN_ROOM_IDS = ['registration'];

export function isRoomHiddenInNavigation(projectStatus?: string | null): boolean {
  if (!projectStatus) return false;
  return NAV_HIDDEN_PROJECT_STATUSES.has(projectStatus);
}

export function isRoomWriteBlocked(projectStatus?: string | null): boolean {
  if (!projectStatus) return false;
  return projectStatus === WRITE_BLOCKED_PROJECT_STATUS;
}

export async function getLinkedProjectStatus(
  prisma: PrismaClient,
  roomId: string,
): Promise<string | null> {
  const project = await prisma.project.findFirst({
    where: { roomId },
    select: { status: true },
  });

  return project?.status ?? null;
}
