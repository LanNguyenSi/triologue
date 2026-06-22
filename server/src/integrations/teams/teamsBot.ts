import { Router } from 'express';
import crypto from 'crypto';
import { handleTeamsMessage } from './teamsSync';
import {
  listChannelMappings,
  registerChannelMapping,
  removeChannelMapping,
} from './teamsMapping';
import { logger } from '../../utils/logger';
import { authenticate, requireAdmin } from '../../middleware/auth';
import prisma from '../../lib/prisma';

const router = Router();

function verifyBotFrameworkAuth(req: any): boolean {
  const botSecret = process.env.TEAMS_BOT_SECRET;
  if (!botSecret) {
    // Fail closed: an unconfigured secret must never authenticate a request.
    return false;
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;

  const presented = Buffer.from(authHeader.slice('Bearer '.length));
  const expected = Buffer.from(botSecret);
  return (
    presented.length === expected.length &&
    crypto.timingSafeEqual(presented, expected)
  );
}

router.post('/webhook', async (req, res) => {
  if (!process.env.TEAMS_BOT_SECRET) {
    logger.error('TEAMS_BOT_SECRET is not configured');
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  if (!verifyBotFrameworkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const activity = req.body;

    if (activity.type === 'message' && activity.text) {
      const mentionEntities = Array.isArray(activity.entities)
        ? activity.entities.filter((entity: any) => entity.type === 'mention' && entity.text)
        : [];
      if (mentionEntities.length === 0) {
        return res.status(200).json({});
      }

      let cleanText = activity.text;
      for (const entity of mentionEntities) {
        cleanText = cleanText.replace(entity.text, '').trim();
      }

      if (!cleanText) {
        return res.status(200).json({});
      }

      await handleTeamsMessage({
        channelId: activity.channelData?.channel?.id || activity.conversation?.id || '',
        from: {
          id: activity.from?.id || '',
          name: activity.from?.name || 'Unknown',
        },
        text: cleanText,
        tenantId: activity.channelData?.tenant?.id || '',
      });
    }

    return res.status(200).json({});
  } catch (err) {
    logger.error('[teams] Webhook error:', err);
    return res.status(200).json({});
  }
});

router.get('/mappings', authenticate, requireAdmin, async (_req, res) => {
  return res.json({ items: listChannelMappings() });
});

router.post('/mappings', authenticate, requireAdmin, async (req, res) => {
  const teamsChannelId = String(req.body?.teamsChannelId || '').trim();
  const trilogueRoomId = String(req.body?.trilogueRoomId || '').trim();
  const teamsTenantId = String(req.body?.teamsTenantId || '').trim();

  if (!teamsChannelId || !trilogueRoomId || !teamsTenantId) {
    return res.status(400).json({
      error: 'teamsChannelId, trilogueRoomId and teamsTenantId are required',
    });
  }

  const room = await prisma.room.findUnique({
    where: { id: trilogueRoomId },
    select: { id: true },
  });
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  registerChannelMapping(teamsChannelId, trilogueRoomId, teamsTenantId);
  return res.status(201).json({
    success: true,
    mapping: { teamsChannelId, trilogueRoomId, teamsTenantId },
  });
});

router.delete('/mappings/:teamsChannelId', authenticate, requireAdmin, async (req, res) => {
  const teamsChannelId = String(req.params.teamsChannelId || '').trim();
  if (!teamsChannelId) {
    return res.status(400).json({ error: 'teamsChannelId is required' });
  }

  const removed = removeChannelMapping(teamsChannelId);
  if (!removed) {
    return res.status(404).json({ error: 'Mapping not found' });
  }

  return res.json({ success: true });
});

export const teamsRoutes = router;
