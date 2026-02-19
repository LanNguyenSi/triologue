import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

const PAGE_SIZE = 50;

/**
 * GET /api/messages/:roomId
 * Cursor-based pagination for messages.
 *
 * Query params:
 *   limit  — messages per page (default 50, max 100)
 *   before — message id cursor: fetch messages OLDER than this id
 *   after  — message id cursor: fetch messages NEWER than this id (for "load new")
 *
 * Response:
 *   { messages: [...], hasMore: bool, nextCursor: string|null, total: number }
 */
router.get('/:roomId', authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;
    const limit = Math.min(Number(req.query.limit ?? PAGE_SIZE), 100);
    const before = req.query.before as string | undefined; // older messages
    const after  = req.query.after  as string | undefined; // newer messages (unused by frontend atm)

    // Build cursor filter
    let cursorFilter: any = {};
    if (before) {
      // Find the cursor message's createdAt to use as a time-based cursor
      const cursorMsg = await prisma.message.findUnique({ where: { id: before }, select: { createdAt: true } });
      if (cursorMsg) {
        cursorFilter = { createdAt: { lt: cursorMsg.createdAt } };
      }
    } else if (after) {
      const cursorMsg = await prisma.message.findUnique({ where: { id: after }, select: { createdAt: true } });
      if (cursorMsg) {
        cursorFilter = { createdAt: { gt: cursorMsg.createdAt } };
      }
    }

    const messages = await prisma.message.findMany({
      where: {
        roomId,
        isDeleted: false,
        ...cursorFilter,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            userType: true,
            avatar: true,
          },
        },
        reactions: {
          include: {
            user: { select: { username: true, displayName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // fetch one extra to determine hasMore
    });

    const hasMore = messages.length > limit;
    if (hasMore) messages.pop(); // remove the extra item

    // Return in chronological order (oldest first)
    const sorted = messages.reverse();
    const nextCursor = hasMore ? sorted[0]?.id ?? null : null;

    res.json({
      messages: sorted,
      hasMore,
      nextCursor, // pass this as `before` to load older messages
      count: sorted.length,
    });
  } catch (error) {
    console.error('Failed to fetch messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

export { router as messageRoutes };
