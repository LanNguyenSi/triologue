import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get messages for a room
router.get('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const messages = await prisma.message.findMany({
      where: { roomId },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            userType: true,
            avatar: true
          }
        },
        reactions: {
          include: {
            user: {
              select: { username: true, displayName: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset)
    });

    res.json(messages.reverse());
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

export { router as messageRoutes };