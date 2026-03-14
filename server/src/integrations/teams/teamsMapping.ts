import prisma from '../../lib/prisma';
import { logger } from '../../utils/logger';

export interface TeamsChannelMapping {
  teamsChannelId: string;
  trilogueRoomId: string;
  teamsTenantId: string;
}

export interface TeamsUserMapping {
  teamsUserId: string;
  trilogueUserId: string;
}

const channelMappings = new Map<string, TeamsChannelMapping>();
const userMappings = new Map<string, string>();

export function registerChannelMapping(teamsChannelId: string, trilogueRoomId: string, teamsTenantId: string): void {
  channelMappings.set(teamsChannelId, { teamsChannelId, trilogueRoomId, teamsTenantId });
  logger.info(`[teams] Mapped channel ${teamsChannelId} -> room ${trilogueRoomId}`);
}

export function getTrilogueRoomId(teamsChannelId: string): string | null {
  return channelMappings.get(teamsChannelId)?.trilogueRoomId || null;
}

export function getTeamsChannelId(trilogueRoomId: string): string | null {
  for (const mapping of channelMappings.values()) {
    if (mapping.trilogueRoomId === trilogueRoomId) return mapping.teamsChannelId;
  }
  return null;
}

export async function resolveTrilogueUser(teamsUserId: string, teamsDisplayName: string): Promise<string> {
  const cached = userMappings.get(teamsUserId);
  if (cached) return cached;

  const existing = await prisma.user.findFirst({
    where: { username: `teams_${teamsUserId.slice(0, 12)}` },
    select: { id: true },
  });

  if (existing) {
    userMappings.set(teamsUserId, existing.id);
    return existing.id;
  }

  const guest = await prisma.user.create({
    data: {
      username: `teams_${teamsUserId.slice(0, 12)}`,
      displayName: teamsDisplayName || 'Teams User',
      userType: 'HUMAN',
      isActive: true,
      canTriggerAI: true,
    },
  });

  userMappings.set(teamsUserId, guest.id);
  logger.info(`[teams] Created guest user for Teams user ${teamsDisplayName}: ${guest.id}`);
  return guest.id;
}
