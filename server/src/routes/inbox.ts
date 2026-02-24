import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';

const router = Router();

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 100;

router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const rawLimit = Number.parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const before = typeof req.query.before === 'string' && req.query.before.trim() ? req.query.before.trim() : null;

    const beforeFilter: Record<string, unknown> = {};
    if (before) {
      const cursor = await (prisma as any).inboxItem.findUnique({
        where: { id: before },
        select: { createdAt: true, recipientId: true },
      });

      if (cursor && cursor.recipientId === userId) {
        beforeFilter.createdAt = { lt: cursor.createdAt };
      }
    }

    const items = await (prisma as any).inboxItem.findMany({
      where: {
        recipientId: userId,
        archivedAt: null,
        ...beforeFilter,
      },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            displayName: true,
            userType: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const unreadCount = await (prisma as any).inboxItem.count({
      where: {
        recipientId: userId,
        archivedAt: null,
        isRead: false,
      },
    });

    return res.json({
      items,
      unreadCount,
      count: items.length,
      nextCursor: items.length === limit ? items[items.length - 1]?.id || null : null,
    });
  } catch (error) {
    logger.error('Failed to fetch inbox:', error);
    return res.status(500).json({ error: 'Failed to fetch inbox' });
  }
});

router.patch('/read-all', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const result = await (prisma as any).inboxItem.updateMany({
      where: {
        recipientId: userId,
        archivedAt: null,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return res.json({ success: true, updated: result.count || 0 });
  } catch (error) {
    logger.error('Failed to mark inbox as read:', error);
    return res.status(500).json({ error: 'Failed to mark inbox as read' });
  }
});

router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;

    const result = await (prisma as any).inboxItem.updateMany({
      where: {
        id: req.params.id,
        recipientId: userId,
        archivedAt: null,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    if ((result.count || 0) === 0) {
      return res.status(404).json({ error: 'Inbox item not found' });
    }

    return res.json({ success: true, id: req.params.id });
  } catch (error) {
    logger.error('Failed to mark inbox item as read:', error);
    return res.status(500).json({ error: 'Failed to mark inbox item as read' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;

    const result = await (prisma as any).inboxItem.updateMany({
      where: {
        id: req.params.id,
        recipientId: userId,
        archivedAt: null,
      },
      data: {
        archivedAt: new Date(),
      },
    });

    if ((result.count || 0) === 0) {
      return res.status(404).json({ error: 'Inbox item not found' });
    }

    return res.json({ success: true, id: req.params.id });
  } catch (error) {
    logger.error('Failed to archive inbox item:', error);
    return res.status(500).json({ error: 'Failed to archive inbox item' });
  }
});

router.delete('/', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;

    const result = await (prisma as any).inboxItem.updateMany({
      where: {
        recipientId: userId,
        archivedAt: null,
      },
      data: {
        archivedAt: new Date(),
      },
    });

    return res.json({ success: true, archived: result.count || 0 });
  } catch (error) {
    logger.error('Failed to clear inbox:', error);
    return res.status(500).json({ error: 'Failed to clear inbox' });
  }
});

export { router as inboxRoutes };
