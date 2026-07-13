import { Router } from 'express';
import crypto from 'crypto';
import { createClient } from 'redis';
import { Prisma, RoomType } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';
import { createInboxItems } from '../services/inboxService';
import {
  isRoomHiddenInNavigation,
  isRoomWriteBlocked,
} from '../utils/projectRoomPolicy';

// Redis client for presence checks. Connect lazily on first use so that merely
// importing this router (e.g. in tests) does not open a Redis socket or start a
// reconnect loop that lingers as an open handle.
const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    // Bound a connect attempt so a lazy presence-check connect cannot stall a
    // request on a blackholed Redis host; it fast-fails into smIsMember's catch.
    connectTimeout: 2000,
    // node-redis's default reconnectStrategy never gives up (it keeps
    // retrying with backoff forever). That alone doesn't stall
    // ensureRedisConnected() itself here, because this client has no
    // `.on('error', ...)` listener, so the retry loop's internal
    // `emit('error', ...)` call throws on the very first failed attempt
    // (Node EventEmitter's default behavior for an unlistened 'error'
    // event) and that exception is what rejects connect() quickly. But
    // without an explicit give-up, the client's underlying socket is
    // never marked closed, so the *next* command (smIsMember below) does
    // not hit node-redis's fast-fail check and instead queues on the
    // offline command queue waiting for a reconnect that nothing is still
    // driving, and it never settles. Setting reconnectStrategy: false
    // makes the client explicitly give up after that first attempt, which
    // marks the socket closed, so smIsMember rejects immediately instead
    // of queuing forever. ensureRedisConnected()'s catch below resets
    // redisConnect so a later request retries connecting.
    reconnectStrategy: false,
  },
});
// Without a listener here, node-redis (an EventEmitter) throws on any
// post-connect socket error (e.g. Redis restarts or resets an established
// connection), since Node's default behavior for an unlistened 'error' event
// is to throw, which crashes the whole process. This just logs and lets the
// existing ensureRedisConnected()/reconnectStrategy handling above degrade
// gracefully instead.
redis.on('error', err => {
  logger.warn('rooms.ts: redis client error', err);
});
let redisConnect: Promise<unknown> | undefined;
function ensureRedisConnected(): Promise<unknown> {
  if (!redisConnect) {
    redisConnect = redis.connect().catch(err => {
      logger.warn('rooms.ts: redis connect error', err);
      redisConnect = undefined; // allow a later retry
    });
  }
  return redisConnect;
}

const router = Router();

interface RoomWithMessages {
  messages?: Array<{
    id: string;
    content: string;
    createdAt: Date;
    sender?: { id: string; username: string; displayName: string; userType: string } | null;
  }>;
}

interface AgentTokenInfo {
  userId: string;
  createdById: string;
  visibility: string;
  sharedWith: string[];
}

async function syncLinkedProjectTeam(roomId: string, userId: string): Promise<{ projectId: string; teamSynced: boolean } | null> {
  const linkedProject = await prisma.project.findFirst({
    where: { roomId },
    select: { id: true, ownerId: true, teamMemberIds: true },
  });

  if (!linkedProject) return null;

  const nextTeam = Array.from(new Set<string>([
    linkedProject.ownerId,
    ...(linkedProject.teamMemberIds || []),
    userId,
  ]));

  const teamSynced = nextTeam.length !== (linkedProject.teamMemberIds || []).length;
  if (teamSynced) {
    await prisma.project.update({
      where: { id: linkedProject.id },
      data: { teamMemberIds: nextTeam },
    });
  }

  return { projectId: linkedProject.id, teamSynced };
}

// Get all rooms for authenticated user
// GET /api/rooms?include=lastMessage,unreadCount
// Enhancement #1: optional includes to avoid extra round-trips
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const includes = new Set(((req.query.include as string) || '').split(',').filter(Boolean));
    const wantLastMessage = includes.has('lastMessage');

    const userRooms = await prisma.roomParticipant.findMany({
      where: { userId },
      include: {
        room: {
          include: {
            project: {
              select: { status: true },
            },
            _count: {
              select: { participants: true, messages: true }
            },
            ...(wantLastMessage ? {
              messages: {
                where: { isDeleted: false },
                orderBy: { createdAt: 'desc' as const },
                take: 1,
                include: {
                  sender: { select: { id: true, username: true, displayName: true, userType: true } },
                },
              },
            } : {}),
          }
        }
      }
    });

    // Hide system rooms (registration) from normal room listing
    const HIDDEN_ROOMS = ['registration'];
    const filteredRooms = userRooms.filter((participation) => {
      if (HIDDEN_ROOMS.includes(participation.room.id)) return false;
      return !isRoomHiddenInNavigation(participation.room.project?.status ?? null);
    });

    const roomsData = filteredRooms.map(participation => {
      const linkedProjectStatus = participation.room.project?.status ?? null;
      const base: Record<string, unknown> = {
        id: participation.room.id,
        name: participation.room.name,
        description: participation.room.description,
        roomType: participation.room.roomType,
        isPrivate: participation.room.isPrivate,
        participantCount: participation.room._count.participants,
        messageCount: participation.room._count.messages,
        role: participation.role,
        linkedProjectStatus,
        canSendMessages: !isRoomWriteBlocked(linkedProjectStatus),
      };

      if (wantLastMessage) {
        const msgs = (participation.room as RoomWithMessages).messages;
        base.lastMessage = msgs?.[0] ? {
          id: msgs[0].id,
          content: msgs[0].content.slice(0, 200),
          sender: msgs[0].sender,
          timestamp: msgs[0].createdAt,
        } : null;
      }

      return base;
    });

    res.json(roomsData);
  } catch (error) {
    logger.error('Error loading rooms:', error);
    res.status(500).json({ error: 'Failed to load rooms' });
  }
});

// Enhancement #2: GET /api/rooms/:roomId?include=messages,project
// Fetches room detail + optional messages & linked project in one call.
router.get('/:roomId', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { roomId } = req.params;
    const includes = new Set(((req.query.include as string) || '').split(',').filter(Boolean));
    const wantMessages = includes.has('messages');
    const wantProject = includes.has('project');
    const msgLimit = Math.min(Number(req.query.messageLimit) || 50, 100);

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

    // Parallel: room details + optional messages + linked project metadata/details
    const [room, messages, linkedProject] = await Promise.all([
      prisma.room.findUnique({
        where: { id: roomId },
        include: {
          _count: {
            select: { participants: true, messages: true }
          },
          participants: {
            where: {
              user: { isDeleted: false },
            },
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
      }),

      wantMessages ? prisma.message.findMany({
        where: { roomId, isDeleted: false },
        orderBy: { createdAt: 'desc' },
        take: msgLimit + 1,
        include: {
          sender: { select: { id: true, username: true, displayName: true, userType: true, avatar: true } },
          reactions: { include: { user: { select: { username: true, displayName: true } } } },
          attachments: true,
        },
      }) : null,

      wantProject
        ? prisma.project.findFirst({
            where: { roomId },
            include: {
              _count: { select: { tasks: true } },
              tasks: {
                where: { status: { not: 'done' } },
                orderBy: { updatedAt: 'desc' },
                take: 10,
                select: {
                  id: true,
                  title: true,
                  status: true,
                  priority: true,
                  assignedTo: true,
                },
              },
            },
          })
        : prisma.project.findFirst({
            where: { roomId },
            select: { id: true, status: true },
          }),
    ]);

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Batch-check online status from Redis
    const participantIds = room.participants.map(p => p.user.id);
    if (participantIds.length > 0) {
      await ensureRedisConnected();
    }
    const onlineSet = participantIds.length > 0
      ? new Set(await redis.smIsMember('online_users', participantIds).then(
          results => participantIds.filter((_, i) => results[i])
        ).catch(() => [] as string[]))
      : new Set<string>();

    // Fetch lastUsedAt for webhook agents (for "active" presence)
    const agentUserIds = room.participants
      .filter(p => p.user.userType !== 'HUMAN')
      .map(p => p.user.id);
    const agentActivityMap = new Map<string, Date>();
    if (agentUserIds.length > 0) {
      const agentTokens = await prisma.agentToken.findMany({
        where: { userId: { in: agentUserIds }, lastUsedAt: { not: null } },
        select: { userId: true, lastUsedAt: true },
      });
      for (const at of agentTokens) {
        agentActivityMap.set(at.userId, at.lastUsedAt!);
      }
    }
    const ACTIVE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

    const linkedProjectStatus = linkedProject?.status ?? null;
    const result: Record<string, unknown> = {
      id: room.id,
      name: room.name,
      description: room.description,
      roomType: room.roomType,
      isPrivate: room.isPrivate,
      participantCount: room._count.participants,
      messageCount: room._count.messages,
      linkedProjectStatus,
      canSendMessages: !isRoomWriteBlocked(linkedProjectStatus),
      participants: room.participants
        .filter(p => p.user.username !== 'gateway')
        .map(p => {
          const isOnline = onlineSet.has(p.user.id);
          const lastActivity = agentActivityMap.get(p.user.id);
          const isRecentlyActive = !isOnline && lastActivity
            && (Date.now() - new Date(lastActivity).getTime()) < ACTIVE_THRESHOLD_MS;
          return {
            userId: p.user.id,
            username: p.user.username,
            displayName: p.user.displayName,
            userType: p.user.userType,
            avatar: p.user.avatar,
            role: p.role,
            joinedAt: p.joinedAt,
            isOnline,
            presenceStatus: isOnline ? 'online' : isRecentlyActive ? 'active' : 'offline',
          };
        }),
    };

    if (wantMessages && messages) {
      const hasMore = messages.length > msgLimit;
      if (hasMore) messages.pop();
      const sorted = messages.reverse();
      result.messages = {
        items: sorted,
        hasMore,
        nextCursor: hasMore ? (sorted[0]?.id ?? null) : null,
      };
    }

    if (wantProject && linkedProject) {
      const lp = linkedProject as Prisma.ProjectGetPayload<{
        include: {
          _count: { select: { tasks: true } };
          tasks: {
            select: {
              id: true;
              title: true;
              status: true;
              priority: true;
              assignedTo: true;
            };
          };
        };
      }>;
      result.project = {
        id: lp.id,
        name: lp.name,
        status: lp.status,
        taskCount: lp._count.tasks,
        openTasks: lp.tasks,
      };
    }

    res.json(result);
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
            avatar: true,
            isDeleted: true
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

    // Replace deleted user info with placeholder
    const sanitizedMessages = messages.map((msg) => ({
      ...msg,
      sender: msg.sender?.isDeleted 
        ? { ...msg.sender, displayName: '[Deleted User]', username: '[deleted]' }
        : msg.sender
    }));

    res.json(sanitizedMessages.reverse()); // Return oldest first
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

    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const roomId = `${slug}-${Date.now()}`;
    const shouldCreateProject =
      Boolean(isPrivate) &&
      roomType !== 'SYSTEM' &&
      name.trim().toLowerCase() !== 'registration' &&
      req.body.createProject !== false;

    const { room, project } = await prisma.$transaction(async (tx) => {
      const gatewayUser = await tx.user.findUnique({
        where: { id: 'gateway-system' },
        select: { id: true },
      });

      const participantsToCreate: Array<{ userId: string; role: 'OWNER' | 'MEMBER' }> = [
        { userId, role: 'OWNER' },
      ];

      if (gatewayUser) {
        participantsToCreate.push({ userId: gatewayUser.id, role: 'MEMBER' });
      } else {
        logger.warn('gateway-system user missing; creating room without gateway participant');
      }

      const createdRoom = await tx.room.create({
        data: {
          id: roomId,
          name: name.trim(),
          description: description?.trim() ?? null,
          roomType: roomType as RoomType,
          isPrivate,
          participants: {
            create: participantsToCreate,
          }
        }
      });

      let createdProject: Awaited<ReturnType<typeof prisma.project.create>> | null = null;
      if (shouldCreateProject) {
        createdProject = await tx.project.create({
          data: {
            name: name.trim(),
            description: description?.trim() || null,
            ownerId: userId,
            roomId: createdRoom.id,
            teamMemberIds: [userId],
          },
        });
      }

      return { room: createdRoom, project: createdProject };
    });

    // Notify gateway's live Socket.io connection to join the new room
    try {
      const io = req.app.get('io');
      if (io) {
        for (const [, socket] of io.sockets.sockets) {
          if ((socket as { userId?: string }).userId === 'gateway-system') {
            socket.join(room.id);
            logger.info(`👥 gateway joined room dynamically: ${room.name}`);
          }
        }
      }
    } catch {
      /* no-op: gateway socket join is a best-effort operation; room creation already succeeded */
    }

    logger.info(`Room created: ${room.id} by user ${userId}${project ? ` (project=${project.id})` : ''}`);
    res.status(201).json({
      id: room.id,
      name: room.name,
      description: room.description,
      roomType: room.roomType,
      isPrivate: room.isPrivate,
      participantCount: 1,
      messageCount: 0,
      ...(project ? { projectId: project.id } : {}),
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

    // Agents cannot self-join rooms — must be invited by a system admin
    const joiner = await prisma.user.findUnique({ where: { id: userId }, select: { userType: true } });
    const joinerType = String(joiner?.userType || '');
    if (['AI_AGENT', 'AI_ICE', 'AI_LAVA', 'AI_OTHER'].includes(joinerType)) {
      return res.status(403).json({ error: 'Agents cannot self-join rooms — ask a system admin to invite you' });
    }

    if (room.isPrivate) {
      return res.status(403).json({ error: 'Room is private — invite required' });
    }

    const existing = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId, roomId } }
    });
    if (existing) return res.status(409).json({ error: 'Already a member' });

    await prisma.roomParticipant.create({ data: { userId, roomId, role: 'MEMBER' } });
    const syncResult = await syncLinkedProjectTeam(roomId, userId);

    logger.info(`User ${userId} joined room ${roomId}`);
    res.json({
      ok: true,
      roomId,
      ...(syncResult ? { syncedProjectId: syncResult.projectId, teamSynced: syncResult.teamSynced } : {}),
    });
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

    // Check inviter is OWNER or ADMIN
    const inviterParticipation = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId: inviterId, roomId } }
    });
    if (!inviterParticipation || !['OWNER', 'ADMIN'].includes(inviterParticipation.role)) {
      return res.status(403).json({ error: 'Only room owners/admins can invite users' });
    }

    const invitee = await prisma.user.findUnique({ where: { username } });
    if (!invitee) return res.status(404).json({ error: 'User not found' });

    // Agent invite rules:
    //   - Elevated agents (Ice, Lava): anyone can invite (beta public agents)
    //   - Other agents: only the agent's CREATOR can invite (BYOA = your own agent)
    //   - System admins can always invite any agent
    const inviteeType = String(invitee.userType || '');
    if (['AI_AGENT', 'AI_ICE', 'AI_LAVA', 'AI_OTHER'].includes(inviteeType)) {
      const agentToken = await prisma.agentToken.findFirst({
        where: { userId: invitee.id, isActive: true },
        select: { trustLevel: true, createdById: true },
      });

      const isElevated = agentToken?.trustLevel === 'elevated';
      const isOwner = agentToken?.createdById === inviterId;
      const inviter = await prisma.user.findUnique({ where: { id: inviterId }, select: { isAdmin: true } });
      const isAdmin = inviter?.isAdmin === true;

      if (!isElevated && !isOwner && !isAdmin) {
        return res.status(403).json({ error: 'You can only invite your own agents to rooms' });
      }
    }

    const existing = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId: invitee.id, roomId } }
    });
    if (existing) return res.status(409).json({ error: 'User already in room' });

    await prisma.roomParticipant.create({ data: { userId: invitee.id, roomId, role: 'MEMBER' } });
    const syncResult = await syncLinkedProjectTeam(roomId, invitee.id);
    await createInboxItems({
      recipientIds: [invitee.id],
      actorId: inviterId,
      type: 'room.invited',
      title: 'You were invited to a room',
      message: `Room: ${roomId}`,
      link: `/room/${roomId}`,
      roomId,
      io: req.app.get('io'),
    }).catch((error) => logger.warn(`Failed to create room invite inbox item: ${error}`));

    logger.info(`User ${invitee.username} invited to room ${roomId} by ${inviterId}`);
    res.json({
      ok: true,
      invitedUser: invitee.username,
      roomId,
      ...(syncResult ? { syncedProjectId: syncResult.projectId, teamSynced: syncResult.teamSynced } : {}),
    });
  } catch (error) {
    logger.error('Error inviting user:', error);
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

// Delete a room — only OWNER or admin can delete
router.delete('/:roomId', authenticate, async (req, res) => {
  try {
    const userId  = req.user!.id;
    const { roomId } = req.params;

    // Check room exists
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { participants: { where: { userId } } },
    });

    if (!room) return res.status(404).json({ error: 'Room not found' });

    const participant = room.participants[0];
    const user = await prisma.user.findUnique({ where: { id: userId } });

    // Only OWNER of room or global admin may delete
    const isOwner = participant?.role === 'OWNER';
    const isAdmin = user?.isAdmin ?? false;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Only the room owner can delete this room' });
    }

    // Protect system rooms
    const PROTECTED = ['onboarding'];
    if (PROTECTED.includes(roomId)) {
      return res.status(403).json({ error: 'This room cannot be deleted' });
    }

    // If this room is linked to a project, delete both together.
    const linkedProject = await prisma.project.findFirst({
      where: { roomId },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.room.delete({ where: { id: roomId } });
      if (linkedProject) {
        await tx.project.delete({ where: { id: linkedProject.id } });
      }
    });

    logger.info(`Room deleted: ${roomId} by user ${userId}${linkedProject ? ` (+project ${linkedProject.id})` : ''}`);
    res.json({ ok: true, deletedRoomId: roomId, ...(linkedProject ? { deletedProjectId: linkedProject.id } : {}) });
  } catch (error) {
    logger.error('Error deleting room:', error);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

/**
 * GET /api/rooms/:roomId/invitable?q=searchterm
 * Returns up to 5 users/agents that can be invited to this room.
 * Shows: humans not yet in room + own agents + elevated agents (Ice, Lava).
 * Excludes: gateway, users already in room, other users' standard agents.
 */
router.get('/:roomId/invitable', authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;
    const q = ((req.query.q as string) || '').toLowerCase().trim();
    const userId = req.user!.id;

    // Verify membership + role
    const membership = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId, roomId } },
    });
    if (!membership) return res.status(403).json({ error: 'Not a room member' });

    // Get current room participant IDs
    const currentParticipants = await prisma.roomParticipant.findMany({
      where: { roomId },
      select: { userId: true },
    });
    const inRoom = new Set(currentParticipants.map(p => p.userId));

    // Get all users not in room
    const allUsers = await prisma.user.findMany({
      where: {
        id: { notIn: Array.from(inRoom) },
        username: { not: 'gateway' },
      },
      select: { id: true, username: true, displayName: true, userType: true },
    });

    // Get agent tokens for visibility check
    const agentTokens = await prisma.agentToken.findMany({
      select: { userId: true, createdById: true, visibility: true, sharedWith: true },
    });
    const agentInfo = new Map<string, AgentTokenInfo>(agentTokens.map((a) => [a.userId, a]));

    const HIDDEN = ['gateway-agent-001', 'gateway'];
    const results = allUsers
      .filter(u => {
        if (HIDDEN.includes(u.id) || HIDDEN.includes(u.username)) return false;
        // Humans always visible
        if (u.userType === 'HUMAN') return true;
        // Check agent visibility
        const info = agentInfo.get(u.id);
        if (!info) return false;
        if (info.visibility === 'public') return true;
        if (info.visibility === 'shared' && info.sharedWith.includes(userId)) return true;
        if (info.createdById === userId) return true; // creator always sees own agents
        return false;
      })
      .filter(u => {
        if (!q) return true;
        return u.username.toLowerCase().includes(q) ||
               (u.displayName || '').toLowerCase().includes(q);
      })
      .slice(0, 5)
      .map(u => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        userType: u.userType,
      }));

    res.json(results);
  } catch (error) {
    logger.error('Error fetching invitable users:', error);
    res.status(500).json({ error: 'Failed to fetch invitable users' });
  }
});

/**
 * GET /api/rooms/:roomId/mentions?q=searchterm
 * Returns up to 5 mentionable users/agents in this room.
 * Only returns: room participants + elevated agents (Ice, Lava).
 * Excludes: other users' agents, gateway user.
 */
router.get('/:roomId/mentions', authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;
    const q = ((req.query.q as string) || '').toLowerCase().trim();
    const userId = req.user!.id;

    // Verify membership
    const membership = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId, roomId } },
    });
    if (!membership) return res.status(403).json({ error: 'Not a room member' });

    // Get room participants
    const participants = await prisma.roomParticipant.findMany({
      where: { roomId },
      include: { user: { select: { id: true, username: true, displayName: true, userType: true } } },
    });

    // Fetch mentionKeys for AI agents (from AgentToken table)
    const agentUserIds = participants
      .filter(p => p.user.userType?.startsWith('AI'))
      .map(p => p.user.id);

    const agentTokens = agentUserIds.length > 0
      ? await prisma.agentToken.findMany({
          where: { userId: { in: agentUserIds }, isActive: true },
          select: { userId: true, mentionKey: true },
        })
      : [];

    const mentionKeyMap = new Map(agentTokens.map(a => [a.userId, a.mentionKey]));

    // Filter: exclude gateway — all room participants are mentionable
    const HIDDEN_USERS = ['gateway-agent-001', 'gateway'];
    const results = participants
      .filter(p => {
        if (HIDDEN_USERS.includes(p.user.id) || HIDDEN_USERS.includes(p.user.username)) return false;
        return true;
      })
      .filter(p => {
        if (!q) return true;
        const mentionKey = mentionKeyMap.get(p.user.id) || '';
        return p.user.username.toLowerCase().includes(q) ||
               (p.user.displayName || '').toLowerCase().includes(q) ||
               mentionKey.toLowerCase().includes(q);
      })
      .slice(0, 5)
      .map(p => ({
        id: p.user.id,
        username: p.user.username,
        displayName: p.user.displayName,
        userType: p.user.userType,
        mentionKey: mentionKeyMap.get(p.user.id) || null,
      }));

    res.json(results);
  } catch (error) {
    logger.error('Error fetching mentions:', error);
    res.status(500).json({ error: 'Failed to fetch mentions' });
  }
});

/**
 * GET /api/rooms/:roomId/export?format=json|md
 * Export full chat log. Restricted to OWNER, ADMIN or system admin.
 */
router.get('/:roomId/export', authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;
    const format = (req.query.format as string) || 'md';
    const userId = req.user!.id;

    // Check membership + role
    const membership = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId, roomId } },
    });
    const isAdmin = req.user?.isAdmin;
    const allowed = ['OWNER', 'ADMIN'];
    if (!membership || (!allowed.includes(membership.role) && !isAdmin)) {
      return res.status(403).json({ error: 'Only room admins can export chat logs' });
    }

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const messages = await prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
      include: { sender: { select: { username: true, displayName: true } } },
    });

    if (format === 'json') {
      const data = messages.map(m => ({
        id: m.id,
        sender: m.sender ? (m.sender.displayName || m.sender.username) : '[Deleted User]',
        content: m.content,
        timestamp: m.createdAt.toISOString(),
      }));
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${room.name}-export.json"`);
      return res.json({ room: room.name, exportedAt: new Date().toISOString(), messageCount: data.length, messages: data });
    }

    // Markdown format
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    
    let md = `# ${room.name} — Chat Export\n\nExported: ${new Date().toISOString()}\nMessages: ${messages.length}\n\n---\n\n`;
    let lastDate = '';
    for (const m of messages) {
      const d = new Date(m.createdAt);
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      if (dateStr !== lastDate) {
        md += `\n## ${dateStr}\n\n`;
        lastDate = dateStr;
      }
      const name = m.sender ? (m.sender.displayName || m.sender.username) : '[Deleted User]';
      md += `**${name}** (${fmtDate(d)}):\n${m.content}\n\n`;
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${room.name}-export.md"`);
    return res.send(md);
  } catch (error) {
    logger.error('Error exporting room:', error);
    res.status(500).json({ error: 'Failed to export chat log' });
  }
});

/**
 * POST /api/rooms/webhooks/github
 * GitHub webhook endpoint (unauthenticated, signature-verified)
 */
router.post('/webhooks/github', async (req, res) => {
  try {
    const signatureHeader = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const event = req.headers['x-github-event'] as string;
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;

    if (!webhookSecret) {
      logger.error('GitHub webhook secret is not configured');
      return res.status(503).json({ error: 'Webhook not configured' });
    }

    if (!signature || !event || !rawBody) {
      return res.status(400).json({ error: 'Missing webhook headers or payload' });
    }

    const expectedSignature = `sha256=${crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex')}`;

    const expected = Buffer.from(expectedSignature);
    const received = Buffer.from(signature);
    const isValid =
      expected.length === received.length &&
      crypto.timingSafeEqual(expected, received);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    logger.info(`GitHub webhook received: ${event}`);

    res.json({ received: true });
  } catch (error) {
    logger.error('GitHub webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// GET /api/rooms/:roomId/context
// Returns comprehensive room context: room, project, tasks, attachments, participants
// Security: BYOA token or JWT, must be room participant
router.get('/:roomId/context', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { roomId } = req.params;

    // 1. Check if user is room participant (security check)
    const participant = await prisma.roomParticipant.findUnique({
      where: {
        userId_roomId: {
          userId,
          roomId
        }
      }
    });

    if (!participant) {
      return res.status(403).json({ error: 'Not a room participant' });
    }

    // 2. Get room
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        name: true,
        description: true,
        roomType: true
      }
    });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // 3. Get linked project with memories (if exists)
    const project = await prisma.project.findFirst({
      where: { roomId },
      select: {
        id: true,
        name: true,
        status: true,
        workflowConfig: true,
        agentMemoryEntries: {
          select: {
            id: true,
            scope: true,
            memoryType: true,
            title: true,
            tags: true,
            isPinned: true,
            confidence: true,
            createdAt: true,
            updatedAt: true,
            payload: true
          },
          where: {
            archivedAt: null
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    // 4. Get tasks with attachments (if project exists)
    const tasks = project
      ? await prisma.task.findMany({
          where: { projectId: project.id },
          select: {
            id: true,
            title: true,
            status: true,
            assignedTo: true,
            priority: true,
            dueDate: true,
            attachments: {
              select: {
                id: true,
                filename: true,
                url: true,
                mimeType: true,
                size: true,
                type: true
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        })
      : [];

    // 5. Get project attachments (if project exists)
    const attachments = project
      ? await prisma.projectAttachment.findMany({
          where: { projectId: project.id },
          select: {
            id: true,
            filename: true,
            url: true,
            mimeType: true,
            type: true
          },
          orderBy: { createdAt: 'desc' }
        })
      : [];

    // 6. Extract memories from project (if exists)
    const memories = project?.agentMemoryEntries || [];

    // 7. Get participants
    const participants = await prisma.roomParticipant.findMany({
      where: { roomId },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            userType: true
          }
        }
      }
    });

    const participantsFormatted = participants.map((p) => ({
      userId: p.userId,
      displayName: p.user.displayName,
      userType: p.user.userType,
      role: p.role
    }));

    // 8. Get pinned messages
    const pinnedMessages = await prisma.message.findMany({
      where: {
        roomId,
        isDeleted: false,
        isPinned: true,
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        pinnedAt: true,
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            userType: true,
          },
        },
        pinnedBy: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
      orderBy: { pinnedAt: 'desc' },
    });

    // 9. Clean project object (remove agentMemoryEntries from response)
    const projectClean = project ? {
      id: project.id,
      name: project.name,
      status: project.status,
      workflowConfig: project.workflowConfig
    } : null;

    // 10. Return comprehensive context
    res.json({
      room,
      project: projectClean,
      tasks,
      attachments,
      memories,
      pinnedMessages,
      participants: participantsFormatted
    });

  } catch (error) {
    logger.error('Room context error:', error);
    res.status(500).json({ error: 'Failed to fetch room context' });
  }
});

export const roomRoutes = router;

// Exported for the Redis-down regression test only (see
// __tests__/rooms-redis-offline.test.ts). Not used by any other consumer.
export { redis as _redisForTesting, ensureRedisConnected as _ensureRedisConnectedForTesting };
