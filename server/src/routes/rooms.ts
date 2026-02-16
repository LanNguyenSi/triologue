import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

// Get all rooms for authenticated user
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;

    const userRooms = await prisma.roomParticipant.findMany({
      where: { userId },
      include: {
        room: {
          include: {
            _count: {
              select: { participants: true, messages: true }
            }
          }
        }
      }
    });

    const roomsData = userRooms.map(participation => ({
      id: participation.room.id,
      name: participation.room.name,
      description: participation.room.description,
      roomType: participation.room.roomType,
      participantCount: participation.room._count.participants,
      messageCount: participation.room._count.messages,
      role: participation.role
    }));

    res.json(roomsData);
  } catch (error) {
    logger.error('Error loading rooms:', error);
    res.status(500).json({ error: 'Failed to load rooms' });
  }
});

// Get specific room by ID
router.get('/:roomId', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { roomId } = req.params;

    // Verify user is participant in this room
    const participation = await prisma.roomParticipant.findUnique({
      where: {
        userId_roomId: {
          userId,
          roomId
        }
      }
    });

    if (!participation) {
      return res.status(403).json({ error: 'Access denied to this room' });
    }

    // Get room details
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        _count: {
          select: { participants: true, messages: true }
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                userType: true,
                avatar: true
              }
            }
          }
        }
      }
    });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json({
      id: room.id,
      name: room.name,
      description: room.description,
      roomType: room.roomType,
      participantCount: room._count.participants,
      messageCount: room._count.messages,
      participants: room.participants.map(p => ({
        userId: p.user.id,
        username: p.user.username,
        displayName: p.user.displayName,
        userType: p.user.userType,
        avatar: p.user.avatar,
        role: p.role,
        joinedAt: p.joinedAt
      }))
    });
  } catch (error) {
    logger.error('Error loading room:', error);
    res.status(500).json({ error: 'Failed to load room' });
  }
});

// Get messages for a room
router.get('/:roomId/messages', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { roomId } = req.params;
    const limit = Number(req.query.limit) || 50;
    const before = req.query.before as string | undefined;

    // Verify user is participant in this room
    const participation = await prisma.roomParticipant.findUnique({
      where: {
        userId_roomId: {
          userId,
          roomId
        }
      }
    });

    if (!participation) {
      return res.status(403).json({ error: 'Access denied to this room' });
    }

    // Get messages
    const messages = await prisma.message.findMany({
      where: {
        roomId,
        ...(before && { id: { lt: before } })
      },
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
              select: {
                id: true,
                username: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    res.json(messages.reverse()); // Return oldest first
  } catch (error) {
    logger.error('Error loading messages:', error);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

export const roomRoutes = router;
