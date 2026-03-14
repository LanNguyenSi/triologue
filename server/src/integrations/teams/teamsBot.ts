import { Router } from 'express';
import { handleTeamsMessage } from './teamsSync';
import { logger } from '../../utils/logger';

const router = Router();

function verifyBotFrameworkAuth(req: any): boolean {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const botSecret = process.env.TEAMS_BOT_SECRET;
  if (!botSecret) return true;
  return authHeader.length > 10;
}

router.post('/webhook', async (req, res) => {
  if (!verifyBotFrameworkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const activity = req.body;

    if (activity.type === 'message' && activity.text) {
      let cleanText = activity.text;
      if (activity.entities) {
        for (const entity of activity.entities) {
          if (entity.type === 'mention' && entity.text) {
            cleanText = cleanText.replace(entity.text, '').trim();
          }
        }
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

export const teamsRoutes = router;
