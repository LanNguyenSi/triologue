import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Get users in a room (authenticated + must be room member)
router.get('/room/:roomId', authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;

    // Verify the requesting user is a member of this room
    const membership = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId: req.user!.id, roomId } },
    });
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this room' });
    }

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

    const users = participants.map((p: any) => p.user);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get all users (admin only — regular users should use /room/:roomId)
router.get('/', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isAdmin: true } });
    if (!user?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

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