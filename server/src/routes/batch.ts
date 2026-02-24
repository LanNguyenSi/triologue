import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';
import { checkMentionLimit } from '../services/mentionLimiter';

const router = Router();

// ─────────────────────────────────────────────────────────────────────
// 1. GET /api/rooms  — enhanced with ?include=lastMessage,unreadCount
//    (This is applied as middleware in the existing rooms route instead)
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// 3. GET /api/me/dashboard
//    Returns everything a client needs on startup in ONE request:
//    - rooms (with lastMessage + unreadCount)
//    - projects (with task counts)
//    - mentionBudget (remaining today)
//    - onlineUsers
// ─────────────────────────────────────────────────────────────────────
router.get('/me/dashboard', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;

    // Parallel fetch everything
    const [participations, projects, mentionCheck, onlineUserIds] = await Promise.all([
      // Rooms with participants + message counts
      prisma.roomParticipant.findMany({
        where: { userId },
        include: {
          room: {
            include: {
              _count: { select: { participants: true, messages: true } },
              messages: {
                where: { isDeleted: false },
                orderBy: { createdAt: 'desc' },
                take: 1,
                include: {
                  sender: { select: { id: true, username: true, displayName: true, userType: true } },
                },
              },
            },
          },
        },
      }),

      // Projects where user is owner or team member
      (prisma as any).project.findMany({
        where: {
          OR: [
            { ownerId: userId },
            { teamMemberIds: { has: userId } },
          ],
        },
        include: {
          _count: { select: { tasks: true } },
        },
      }),

      // Mention budget
      checkMentionLimit(userId).catch(() => ({
        allowed: true, current: 0, limit: 15, needsWarning: false,
      })),

      // Online users from Redis
      (async () => {
        try {
          const redis = req.app.get('redis');
          if (redis) return await redis.sMembers('online_users');
          return [];
        } catch { return []; }
      })(),
    ]);

    // Build rooms response
    const HIDDEN_ROOMS = ['registration'];
    const rooms = participations
      .filter((p: any) => !HIDDEN_ROOMS.includes(p.room.id))
      .map((p: any) => ({
        id: p.room.id,
        name: p.room.name,
        description: p.room.description,
        roomType: p.room.roomType,
        isPrivate: p.room.isPrivate,
        participantCount: p.room._count.participants,
        messageCount: p.room._count.messages,
        role: p.role,
        lastMessage: p.room.messages[0] ? {
          id: p.room.messages[0].id,
          content: p.room.messages[0].content.slice(0, 200),
          sender: p.room.messages[0].sender,
          timestamp: p.room.messages[0].createdAt,
        } : null,
      }));

    res.json({
      rooms,
      projects: projects.map((p: any) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        taskCount: p._count.tasks,
        roomId: p.roomId,
      })),
      mentionBudget: {
        used: mentionCheck.current,
        limit: mentionCheck.limit,
        remaining: mentionCheck.limit === -1 ? -1 : mentionCheck.limit - mentionCheck.current,
      },
      onlineUsers: onlineUserIds,
      activeAgents: await (async () => {
        try {
          const threshold = new Date(Date.now() - 10 * 60 * 1000);
          const recentAgents = await (prisma as any).agentToken.findMany({
            where: { lastUsedAt: { gte: threshold }, status: 'active' },
            select: { userId: true },
          });
          return recentAgents.map((a: any) => a.userId);
        } catch { return []; }
      })(),
    });
  } catch (error) {
    logger.error('Dashboard fetch error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 4. POST /api/batch/messages
//    Send messages to multiple rooms in one request.
//    Body: { messages: [{ roomId, content, messageType? }] }
//    Max 10 messages per batch.
// ─────────────────────────────────────────────────────────────────────
router.post('/messages', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }
    if (messages.length > 10) {
      return res.status(400).json({ error: 'Max 10 messages per batch' });
    }

    // Verify membership in all target rooms
    const roomIds = [...new Set(messages.map((m: any) => m.roomId))];
    const memberships = await prisma.roomParticipant.findMany({
      where: { userId, roomId: { in: roomIds } },
      select: { roomId: true },
    });
    const memberRoomIds = new Set(memberships.map(m => m.roomId));

    const results: any[] = [];
    const io = req.app.get('io');

    for (const msg of messages) {
      if (!memberRoomIds.has(msg.roomId)) {
        results.push({ roomId: msg.roomId, error: 'Not a member' });
        continue;
      }

      const created = await prisma.message.create({
        data: {
          content: msg.content,
          roomId: msg.roomId,
          senderId: userId,
          messageType: msg.messageType || 'TEXT',
        },
        include: {
          sender: { select: { id: true, username: true, displayName: true, userType: true, avatar: true } },
          reactions: true,
          attachments: true,
        },
      });

      // Broadcast via Socket.io
      if (io) {
        io.to(msg.roomId).emit('message:new', created);
      }

      results.push({ roomId: msg.roomId, messageId: created.id, ok: true });
    }

    res.json({ results });
  } catch (error) {
    logger.error('Batch message error:', error);
    res.status(500).json({ error: 'Batch send failed' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 5. GET /api/agents/:mentionKey/context
//    One-call context for an agent: rooms, unread messages, assigned tasks.
//    Auth: requires the agent's own token or admin.
// ─────────────────────────────────────────────────────────────────────
router.get('/agents/:mentionKey/context', authenticate, async (req, res) => {
  try {
    const { mentionKey } = req.params;
    const requesterId = req.user!.id;

    // Find the agent
    const agent = await (prisma as any).agentToken.findFirst({
      where: { mentionKey, isActive: true },
      include: {
        agentUser: {
          select: { id: true, username: true },
        },
      },
    });

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Auth: only the agent itself or an admin can request
    const requester = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { isAdmin: true },
    });
    if (agent.userId !== requesterId && !requester?.isAdmin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const agentUserId = agent.userId;

    // Parallel fetch
    const [roomParticipations, tasks] = await Promise.all([
      prisma.roomParticipant.findMany({
        where: { userId: agentUserId },
        include: {
          room: {
            include: {
              _count: { select: { messages: true } },
              messages: {
                where: { isDeleted: false },
                orderBy: { createdAt: 'desc' },
                take: 20,
                include: {
                  sender: { select: { username: true, userType: true } },
                },
              },
            },
          },
        },
      }),

      // Tasks assigned to this agent
      (prisma as any).task.findMany({
        where: {
          OR: [
            { assigneeId: agentUserId },
            { assigneeIds: { has: agentUserId } },
          ],
          status: { not: 'DONE' },
        },
        include: {
          project: { select: { id: true, name: true, roomId: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
    ]);

    const rooms = roomParticipations.map((p: any) => ({
      id: p.room.id,
      name: p.room.name,
      totalMessages: p.room._count.messages,
      recentMessages: p.room.messages.reverse().map((m: any) => ({
        id: m.id,
        sender: m.sender.username,
        senderType: m.sender.userType,
        content: m.content,
        timestamp: m.createdAt,
      })),
    }));

    res.json({
      agent: { mentionKey: agent.mentionKey, userId: agentUserId },
      rooms,
      tasks: tasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        project: t.project ? { id: t.project.id, name: t.project.name } : null,
      })),
    });
  } catch (error) {
    logger.error('Agent context error:', error);
    res.status(500).json({ error: 'Failed to load agent context' });
  }
});

export { router as batchRoutes };
