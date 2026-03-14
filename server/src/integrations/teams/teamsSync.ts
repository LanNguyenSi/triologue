import prisma from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { getTrilogueRoomId, getTeamsChannelId, resolveTrilogueUser } from './teamsMapping';
import { getToken } from '../../services/tokenManager';

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

export async function sendToTeams(roomId: string, content: string, senderName: string): Promise<void> {
  const channelId = getTeamsChannelId(roomId);
  if (!channelId) return;

  const token = await getToken('microsoft', 'graph');
  if (!token) {
    logger.warn('[teams] No Microsoft token available for sending to Teams');
    return;
  }

  try {
    const teamId = channelId.split(':')[0];
    const url = `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${encodeURIComponent(channelId)}/messages`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: {
          contentType: 'text',
          content: `[${senderName}] ${content}`,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      logger.error(`[teams] Failed to send to Teams (${res.status}): ${err}`);
    }
  } catch (err) {
    logger.error('[teams] Send to Teams error:', err);
  }
}
