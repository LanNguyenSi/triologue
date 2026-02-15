import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get users in a room
router.get('/room/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;

    const participants = await prisma.roomParticipant.findMany({
      where: { roomId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            userType: true,
            avatar: true,
            isActive: true,
            lastSeen: true
          }
        }
      }
    });

    const users = participants.map(p => p.user);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get all users
router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        userType: true,
        avatar: true,
        isActive: true,
        lastSeen: true
      }
    });

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

export { router as userRoutes };