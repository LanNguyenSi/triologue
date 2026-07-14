import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';
import { getMentionBudget } from '../services/mentionLimiter';
import { isRoomWriteBlocked } from '../utils/projectRoomPolicy';
import { pluginManager } from '../plugins/manager';
import { parseDateOrNull } from './agentMemoryFormat';

const router = Router();

interface TaskSummaryRow {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  updatedAt: Date;
  assignedTo: string;
  project: { id: string; name: string } | null;
}

interface BatchMsgInput {
  roomId: string;
  content: string;
  messageType?: string;
}

type BatchResult =
  | { roomId: string; error: string }
  | { roomId: string; messageId: string; ok: true };

function memorySummary(payload: Prisma.JsonValue | null | undefined): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Prisma.JsonObject;
  const summary = String(p['summary'] || '').trim();
  if (summary) return summary.slice(0, 180);
  const note = String(p['note'] || '').trim();
  if (note) return note.slice(0, 180);
  const text = JSON.stringify(payload);
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function deriveFreshness(payload: Prisma.JsonValue | null | undefined, expiresAtRaw: unknown, now: Date) {
  const payloadObj: Prisma.JsonObject = payload && typeof payload === 'object' ? payload as Prisma.JsonObject : {};
  const expiresAt = parseDateOrNull(expiresAtRaw);
  const validUntilPayload = parseDateOrNull(payloadObj['validUntil']);
  const validUntil = expiresAt || validUntilPayload;
  const isStale = Boolean(validUntil && validUntil.getTime() <= now.getTime());

  return {
    status: isStale ? 'stale' : validUntil ? 'fresh' : 'unknown',
    warning: isStale ? 'Memory entry is stale and should be reviewed.' : null,
    validUntil: validUntil ? validUntil.toISOString() : null,
  };
}

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
    const projectAccessFilter = {
      OR: [
        { ownerId: userId },
        { teamMemberIds: { has: userId } },
      ],
    };

    // Parallel fetch everything
    const [participations, projects, mentionCheck, onlineUserIds, myTasksRaw, importantTaskCandidates] = await Promise.all([
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
      prisma.project.findMany({
        where: projectAccessFilter,
        include: {
          _count: { select: { tasks: true } },
        },
      }),

      // Mention budget (read-only — never increment on dashboard load)
      getMentionBudget(userId).catch(() => ({
        current: 0, limit: 15, remaining: 15,
      })),

      // Online users from Redis
      (async () => {
        try {
          const redis = req.app.get('redis');
          if (redis) return await redis.sMembers('online_users');
          return [];
        } catch { return []; }
      })(),

      // Tasks assigned to the current user (open only)
      prisma.task.findMany({
        where: {
          assignedTo: userId,
          status: { not: 'done' },
          project: projectAccessFilter,
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          updatedAt: true,
          assignedTo: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 12,
      }),

      // Candidate list for important tasks in accessible projects
      prisma.task.findMany({
        where: {
          status: { not: 'done' },
          project: projectAccessFilter,
          OR: [
            { priority: 'high' },
            { status: 'blocked' },
            { status: 'in_review' },
          ],
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          updatedAt: true,
          assignedTo: true,
          project: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 24,
      }),
    ]);

    // SCOPING DECISION (agent-tasks efb19b78): `online_users` is a single
    // global Redis set covering every connected socket on the whole
    // platform, not scoped to rooms/projects (see the try/catch fetch
    // above, unchanged — Redis being down must still degrade to `[]`, not
    // 500). Returning it verbatim here would leak platform-wide presence
    // (every human/agent account, including ones the caller has never
    // shared a room with) to any authenticated caller. Scope it down using
    // the SAME visibility model routes/rooms.ts already applies to its
    // own per-room presence check: a user counts as "visible" here iff
    // they participate in at least one room the caller also participates
    // in (`RoomParticipant` rows sharing a `roomId`). This is a single
    // extra query keyed off the caller's own room ids (`participations`,
    // already fetched above) — not an N+1 over rooms or users.
    const callerRoomIds = participations.map((p) => p.room.id);
    const visibleParticipants = callerRoomIds.length > 0
      ? await prisma.roomParticipant.findMany({
          where: { roomId: { in: callerRoomIds } },
          select: { userId: true },
        })
      : [];
    const visibleUserIds = new Set(visibleParticipants.map((p) => p.userId));
    const scopedOnlineUserIds = onlineUserIds.filter((id: string) => visibleUserIds.has(id));

    const projectRoomIds = projects
      .map((project) => project.roomId)
      .filter((roomId): roomId is string => Boolean(roomId));

    const latestRoomMessages = projectRoomIds.length > 0
      ? await prisma.message.findMany({
          where: {
            roomId: { in: projectRoomIds },
            isDeleted: false,
          },
          orderBy: { createdAt: 'desc' },
          take: 240,
          select: {
            id: true,
            roomId: true,
            content: true,
            createdAt: true,
            sender: {
              select: {
                id: true,
                username: true,
                displayName: true,
                userType: true,
              },
            },
          },
        })
      : [];

    const priorityRank: Record<string, number> = {
      high: 3,
      medium: 2,
      low: 1,
    };

    const toTaskSummary = (task: TaskSummaryRow) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority || 'medium',
      projectId: task.project?.id || '',
      projectName: task.project?.name || 'Project',
    });

    const myTasks = [...myTasksRaw]
      .sort((a, b) => {
        const scoreA = priorityRank[a.priority || 'medium'] || 0;
        const scoreB = priorityRank[b.priority || 'medium'] || 0;
        if (scoreA !== scoreB) return scoreB - scoreA;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, 6)
      .map(toTaskSummary);

    const importantTaskMap = new Map<string, TaskSummaryRow>();
    for (const task of importantTaskCandidates) {
      if (!importantTaskMap.has(task.id)) {
        importantTaskMap.set(task.id, task);
      }
    }

    const importantTasks = [...importantTaskMap.values()]
      .sort((a, b) => {
        const score = (task: TaskSummaryRow) => {
          let value = 0;
          if (task.assignedTo === userId) value += 4;
          if (task.status === 'blocked') value += 3;
          if (task.priority === 'high') value += 2;
          if (task.status === 'in_review') value += 1;
          return value;
        };
        const scoreDiff = score(b) - score(a);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, 6)
      .map(toTaskSummary);

    const projectByRoomId = new Map<string, { id: string; name: string; roomId: string | null }>();
    for (const project of projects) {
      if (project.roomId) projectByRoomId.set(project.roomId, project);
    }

    const latestMessagePerRoom = new Map<string, (typeof latestRoomMessages)[number]>();
    for (const message of latestRoomMessages) {
      if (!latestMessagePerRoom.has(message.roomId)) {
        latestMessagePerRoom.set(message.roomId, message);
      }
    }

    const latestHandovers = [...latestMessagePerRoom.values()]
      .map((message) => {
        const project = projectByRoomId.get(message.roomId);
        if (!project) return null;
        return {
          projectId: project.id,
          projectName: project.name,
          roomId: message.roomId,
          messageId: message.id,
          contentPreview: (message.content || '').slice(0, 160),
          timestamp: message.createdAt,
          sender: message.sender,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 6);

    // Build rooms response
    const HIDDEN_ROOMS = ['registration'];
    const rooms = participations
      .filter((p) => !HIDDEN_ROOMS.includes(p.room.id))
      .map((p) => ({
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
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        taskCount: p._count.tasks,
        roomId: p.roomId,
      })),
      mentionBudget: {
        used: mentionCheck.current,
        limit: mentionCheck.limit,
        remaining: mentionCheck.remaining,
      },
      myTasks,
      importantTasks,
      latestHandovers,
      onlineUsers: scopedOnlineUserIds,
      activeAgents: await (async () => {
        try {
          const threshold = new Date(Date.now() - 30 * 60 * 1000);
          const recentAgents = await prisma.agentToken.findMany({
            where: { lastUsedAt: { gte: threshold }, status: 'active' },
            select: { userId: true },
          });
          return recentAgents.map((a) => a.userId);
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
    const { messages } = req.body as { messages: BatchMsgInput[] };

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }
    if (messages.length > 10) {
      return res.status(400).json({ error: 'Max 10 messages per batch' });
    }

    // Verify membership in all target rooms
    const roomIds = [...new Set(messages.map((m) => m.roomId))];
    const memberships = await prisma.roomParticipant.findMany({
      where: { userId, roomId: { in: roomIds } },
      select: { roomId: true },
    });
    const memberRoomIds = new Set(memberships.map(m => m.roomId));
    const linkedProjects = await prisma.project.findMany({
      where: { roomId: { in: roomIds } },
      select: { roomId: true, status: true },
    });
    const projectStatusByRoomId = new Map<string, string>();
    for (const project of linkedProjects) {
      if (project.roomId) {
        projectStatusByRoomId.set(project.roomId, project.status);
      }
    }

    const results: BatchResult[] = [];
    const io = req.app.get('io');

    for (const msg of messages) {
      if (!memberRoomIds.has(msg.roomId)) {
        results.push({ roomId: msg.roomId, error: 'Not a member' });
        continue;
      }
      const linkedProjectStatus = projectStatusByRoomId.get(msg.roomId) ?? null;
      if (isRoomWriteBlocked(linkedProjectStatus)) {
        results.push({
          roomId: msg.roomId,
          error: 'Messages are disabled because the linked project is closed.',
        });
        continue;
      }

      const created = await prisma.message.create({
        data: {
          content: msg.content,
          roomId: msg.roomId,
          senderId: userId,
          messageType: (msg.messageType || 'TEXT') as 'TEXT' | 'CODE' | 'IMAGE' | 'FILE' | 'SYSTEM' | 'AI_RESPONSE' | 'RESEARCH_NOTE',
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
      await pluginManager.emit("message.created", {
        messageId: created.id,
        roomId: msg.roomId,
        senderId: userId,
        source: "batch",
        messageType: created.messageType,
      });

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
    const agent = await prisma.agentToken.findFirst({
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
      prisma.task.findMany({
        where: {
          assignedTo: agentUserId,
          status: { not: 'done' },
        },
        include: {
          project: { select: { id: true, name: true, roomId: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
    ]);

    const roomIds = roomParticipations.map((entry) => entry.room.id);
    const linkedProjects = roomIds.length
      ? await prisma.project.findMany({
          where: { roomId: { in: roomIds } },
          select: { id: true, name: true, roomId: true },
          take: 200,
        })
      : [];
    const linkedProjectByRoom = new Map<string, { id: string; name: string }>();
    for (const project of linkedProjects) {
      if (project.roomId) {
        linkedProjectByRoom.set(project.roomId, { id: project.id, name: project.name });
      }
    }

    const projectIdSet = new Set<string>();
    for (const task of tasks) {
      if (task.project?.id) projectIdSet.add(task.project.id);
    }
    for (const project of linkedProjects) {
      if (project.id) projectIdSet.add(project.id);
    }
    const projectIds = Array.from(projectIdSet);
    const now = new Date();
    const memoryRows = await prisma.agentMemoryEntry.findMany({
      where: {
        AND: [
          projectIds.length > 0
            ? {
                OR: [
                  { scope: 'GLOBAL' },
                  { scope: 'PROJECT', projectId: { in: projectIds } },
                ],
              }
            : { scope: 'GLOBAL' },
          { archivedAt: null },
        ],
      },
      orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
      take: 90,
      select: {
        id: true,
        scope: true,
        projectId: true,
        memoryType: true,
        title: true,
        tags: true,
        isPinned: true,
        payload: true,
        confidence: true,
        pluginId: true,
        moduleKey: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const rankedMemoryRows = memoryRows
      .map((entry) => {
        const freshness = deriveFreshness(entry.payload, entry.expiresAt, now);
        const confidence = Number(entry.confidence || 0);
        const updatedAt = new Date(entry.updatedAt).getTime();
        const hoursSinceUpdate = Math.max(0, (Date.now() - updatedAt) / (1000 * 60 * 60));
        const recencyBoost = Math.max(0, 24 - Math.min(24, hoursSinceUpdate)) * 0.4;
        const score =
          (entry.isPinned ? 35 : 0) +
          confidence * 100 +
          (entry.scope === 'PROJECT' ? 12 : 0) +
          recencyBoost +
          (freshness.status === 'stale' ? -40 : 0);

        return {
          entry,
          freshness,
          score,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    const rooms = roomParticipations.map((p) => ({
      id: p.room.id,
      name: p.room.name,
      linkedProject: linkedProjectByRoom.get(p.room.id) || null,
      totalMessages: p.room._count.messages,
      recentMessages: p.room.messages.reverse().map((m) => ({
        id: m.id,
        // sender is nullable (senderId onDelete: SetNull) — a message from a
        // deleted user must not crash this endpoint. Matches the fallback
        // convention already used for this exact shape in agents.ts (recentByRoom).
        sender: m.sender?.username || 'unknown',
        senderType: m.sender?.userType || 'unknown',
        content: m.content,
        timestamp: m.createdAt,
      })),
    }));

    res.json({
      agent: { mentionKey: agent.mentionKey, userId: agentUserId },
      rooms,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        project: t.project ? { id: t.project.id, name: t.project.name } : null,
      })),
      memory: rankedMemoryRows.map(({ entry, freshness }) => ({
        id: entry.id,
        scope: entry.scope,
        projectId: entry.projectId || null,
        memoryType: entry.memoryType,
        title: entry.title || '',
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        summary: memorySummary(entry.payload),
        confidence: Number(entry.confidence || 0),
        pluginId: entry.pluginId,
        moduleKey: entry.moduleKey || null,
        freshnessStatus: freshness.status,
        freshnessWarning: freshness.warning,
        validUntil: freshness.validUntil,
        updatedAt: entry.updatedAt,
      })),
    });
  } catch (error) {
    logger.error('Agent context error:', error);
    res.status(500).json({ error: 'Failed to load agent context' });
  }
});

export { router as batchRoutes };
