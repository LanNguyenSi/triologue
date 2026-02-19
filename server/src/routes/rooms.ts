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

// Create a new room
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { name, description, roomType = 'TRIOLOGUE', isPrivate = false } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Room name is required' });
    }

    const roomId = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();

    const room = await prisma.room.create({
      data: {
        id: roomId,
        name: name.trim(),
        description: description?.trim() ?? null,
        roomType: roomType as any,
        isPrivate,
        participants: {
          create: { userId, role: 'OWNER' }
        }
      }
    });

    logger.info(`Room created: ${room.id} by user ${userId}`);
    res.status(201).json({
      id: room.id,
      name: room.name,
      description: room.description,
      roomType: room.roomType,
      isPrivate: room.isPrivate,
      participantCount: 1,
      messageCount: 0,
    });
  } catch (error) {
    logger.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Join a room
router.post('/:roomId/join', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { roomId } = req.params;

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    if (room.isPrivate) {
      return res.status(403).json({ error: 'Room is private — invite required' });
    }

    const existing = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId, roomId } }
    });
    if (existing) return res.status(409).json({ error: 'Already a member' });

    await prisma.roomParticipant.create({ data: { userId, roomId, role: 'MEMBER' } });

    logger.info(`User ${userId} joined room ${roomId}`);
    res.json({ ok: true, roomId });
  } catch (error) {
    logger.error('Error joining room:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// Invite user to room (by username)
router.post('/:roomId/invite', authenticate, async (req, res) => {
  try {
    const inviterId = req.user!.id;
    const { roomId } = req.params;
    const { username } = req.body;

    // Check inviter is ADMIN or MODERATOR
    const inviterParticipation = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId: inviterId, roomId } }
    });
    if (!inviterParticipation || !['OWNER', 'ADMIN', 'MODERATOR'].includes(inviterParticipation.role)) {
      return res.status(403).json({ error: 'Only room owners/admins can invite users' });
    }

    const invitee = await prisma.user.findUnique({ where: { username } });
    if (!invitee) return res.status(404).json({ error: 'User not found' });

    const existing = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId: invitee.id, roomId } }
    });
    if (existing) return res.status(409).json({ error: 'User already in room' });

    await prisma.roomParticipant.create({ data: { userId: invitee.id, roomId, role: 'MEMBER' } });

    logger.info(`User ${invitee.username} invited to room ${roomId} by ${inviterId}`);
    res.json({ ok: true, invitedUser: invitee.username, roomId });
  } catch (error) {
    logger.error('Error inviting user:', error);
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

export const roomRoutes = router;
