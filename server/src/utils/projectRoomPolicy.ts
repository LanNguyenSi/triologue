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

// Rooms excluded from the dashboard onlineUsers *presence* scoping
// (routes/batch.ts's callerRoomIds), which is a strict superset of
// HIDDEN_ROOM_IDS: every hidden room is also presence-excluded (same
// "near-universal membership would leak scoping back toward everyone"
// reasoning above), but not every presence-excluded room is hidden.
//
// "onboarding" (server/prisma/seed.ts) is the case that isn't hidden: it is
// created without `isPrivate`, so `Room.isPrivate` defaults to `false` and
// it is PUBLIC — every newly registered human auto-joins it via auth.ts's
// "auto-join all public rooms on registration" step, making shared
// membership in it just as universal (among humans) as "registration" is
// among agents. Unlike "registration" it is a legitimate, user-facing
// catch-all room that must stay VISIBLE in room listings (routes/batch.ts,
// routes/rooms.ts) — a public welcome room isn't a hidden system room. But
// it is a public catch-all, not a shared *working* context, so co-membership
// in it alone must not count as "this user shares a room with me" for
// presence purposes either. Hence a separate constant rather than adding
// "onboarding" to HIDDEN_ROOM_IDS: that would incorrectly hide it from
// listings too.
export const PRESENCE_EXCLUDED_ROOM_IDS = [...HIDDEN_ROOM_IDS, 'onboarding'];

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
