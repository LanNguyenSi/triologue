import prisma from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getTrilogueRoomId, resolveTrilogueUser } from './teamsMapping';

export async function handleTeamsMessage(activity: {
  channelId: string;
  from: { id: string; name: string };
  text: string;
  tenantId: string;
}): Promise<void> {
  const roomId = getTrilogueRoomId(activity.channelId);
  if (!roomId) {
    logger.warn(`[teams] No mapping for Teams channel ${activity.channelId}`);
    return;
  }

  const senderId = await resolveTrilogueUser(activity.from.id, activity.from.name);

  const participation = await prisma.roomParticipant.findUnique({
    where: { userId_roomId: { userId: senderId, roomId } },
  });
  if (!participation) {
    await prisma.roomParticipant.create({
      data: { userId: senderId, roomId, role: 'MEMBER' },
    });
  }

  await prisma.message.create({
    data: {
      content: activity.text,
      senderId,
      roomId,
      messageType: 'TEXT',
    },
  });

  await prisma.room.update({
    where: { id: roomId },
    data: { lastActivity: new Date(), messageCount: { increment: 1 } },
  });

  logger.info(`[teams] Synced message from ${activity.from.name} to room ${roomId}`);
}
