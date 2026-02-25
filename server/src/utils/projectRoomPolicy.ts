import { PrismaClient } from "@prisma/client";

export const NAV_HIDDEN_PROJECT_STATUSES = new Set(["archived", "closed"]);
export const WRITE_BLOCKED_PROJECT_STATUS = "closed";

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
  const project = await (prisma as any).project.findFirst({
    where: { roomId },
    select: { status: true },
  });

  return project?.status ?? null;
}
