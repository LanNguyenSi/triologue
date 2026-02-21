/**
 * BYOA (Bring Your Own Agent) Routes
 * Ice 🧊 — 2026-02-19
 *
 * Any authenticated user can bring their own agent.
 * Agents start as "pending" and require admin approval before they can post.
 *
 * Flow:
 *   1. User creates an agent (POST /api/agents) → status: "pending"
 *   2. Admin reviews + approves (PATCH /api/agents/:id/activate) → status: "active"
 *   3. Agent's webhook receives messages when @mentioned in a room
 *   4. Agent replies via POST /api/agents/message with its bearer token
 *
 * Security:
 *   - Token returned only once on creation — store it safely
 *   - Agents cannot post while status is "pending" or "rejected"
 *   - Agents can only post to rooms they've been added to
 *   - Agents cannot trigger other agents (canTriggerAI=false → no loops)
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import crypto from 'crypto';

const router = Router();
const prisma = new PrismaClient();

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Check caller is an admin (reads isAdmin from DB — same as admin.ts) */
const requireAdmin = async (req: any, res: any, next: any) => {
  const user = await prisma.user.findUnique({ where: { id: req.user?.id } });
  if (!user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
};

/** Derive @mention key from agent name, e.g. "Research Bot" → "researchbot" */
function toMentionKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

// ─── Admin: CRUD ────────────────────────────────────────────────────────────

/**
 * GET /api/agents/info
 * Public endpoint: returns active agents with their emoji, color, mentionKey.
 * Used by the client to render agent avatars/badges dynamically.
 * No auth required — only exposes public metadata.
 */
router.get('/info', async (_req, res) => {
  try {
    const agents = await (prisma as any).agentToken.findMany({
      where: { isActive: true, status: 'active' },
      select: {
        mentionKey: true,
        emoji: true,
        color: true,
        trustLevel: true,
        agentUser: {
          select: { id: true, username: true, displayName: true, userType: true },
        },
      },
    });

    // Map to a simple lookup by userId
    const agentMap: Record<string, any> = {};
    for (const a of agents) {
      agentMap[a.agentUser.id] = {
        username: a.agentUser.username,
        displayName: a.agentUser.displayName,
        mentionKey: a.mentionKey,
        emoji: a.emoji || '🤖',
        color: a.color || '#888888',
        trustLevel: a.trustLevel,
      };
    }

    res.json(agentMap);
  } catch (err) {
    console.error('[agents] info error:', err);
    res.status(500).json({ error: 'Failed to load agent info' });
  }
});

/**
 * POST /api/agents
 * Create a new BYOA agent. Any authenticated user can create one.
 * Starts with status="pending" — admin must activate before agent can post.
 * Body: { name, webhookUrl, roomId?, description? }
 * Returns: { agentId, agentUserId, agentUsername, mentionKey, token }
 *          ↑ token is ONLY returned here — store it safely!
 */
router.post('/', authenticate, async (req, res) => {
  const { name, webhookUrl, roomId, description } = req.body;

  if (!name || !webhookUrl) {
    return res.status(400).json({ error: 'name and webhookUrl are required' });
  }

  // Unique username for the agent's User record
  const suffix     = crypto.randomBytes(4).toString('hex');
  const username   = `agent_${toMentionKey(name)}_${suffix}`;
  const mentionKey = toMentionKey(name);
  const token      = 'byoa_' + crypto.randomBytes(32).toString('hex');

  try {
    // Atomic: create User + AgentToken + optional room join
    const result = await prisma.$transaction(async (tx) => {
      const agentUser = await tx.user.create({
        data: {
          username,
          displayName: name,
          userType:    'AI_AGENT',
          isActive:    false, // Inactive until admin approves (status: pending → active)
          canTriggerAI: false, // Agents must not trigger other agents — prevents loops (trustLevel: standard)
        },
      });

      const agentToken = await tx.agentToken.create({
        data: {
          token,
          name,
          description,
          webhookUrl,
          mentionKey,
          status:      'pending',
          userId:      agentUser.id,
          createdById: req.user!.id,
        },
      });

      // Always add agent to the hidden registration room (staging area)
      await tx.roomParticipant.upsert({
        where:  { userId_roomId: { userId: agentUser.id, roomId: 'registration' } },
        create: { userId: agentUser.id, roomId: 'registration', role: 'MEMBER' },
        update: {},
      });

      // Optionally also add agent to an additional room
      if (roomId && roomId !== 'registration') {
        const room = await tx.room.findUnique({ where: { id: roomId } });
        if (room) {
          await tx.roomParticipant.upsert({
            where:  { userId_roomId: { userId: agentUser.id, roomId } },
            create: { userId: agentUser.id, roomId, role: 'MEMBER' },
            update: {},
          });
        }
      }

      return { agentUser, agentToken };
    });

    res.status(201).json({
      agentId:       result.agentToken.id,
      agentUserId:   result.agentUser.id,
      agentUsername: result.agentUser.username,
      mentionKey,
      status:        'pending',
      token, // ⚠️  One-time — cannot be retrieved again
      message: `Agent created (pending admin approval). Mention with @${mentionKey} once active.`,
    });
  } catch (err: any) {
    console.error('[agents] create error:', err);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

/**
 * GET /api/agents/mine
 * List agents created by the current user (any authenticated user).
 * Tokens are never returned.
 */
router.get('/mine', authenticate, async (req, res) => {
  try {
    const agents = await (prisma as any).agentToken.findMany({
      where: { createdById: req.user!.id },
      include: {
        agentUser: {
          select: {
            id: true, username: true, displayName: true, isActive: true, lastSeen: true,
            participations: { include: { room: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(agents.map((a: any) => ({ ...a, token: '[redacted]' })));
  } catch (err) {
    console.error('[agents] mine error:', err);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

/**
 * GET /api/agents
 * List ALL BYOA agents with their room memberships (admin only).
 * Tokens are never returned.
 */
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const agents = await (prisma as any).agentToken.findMany({
      include: {
        agentUser: {
          select: {
            id: true,
            username: true,
            displayName: true,
            isActive: true,
            lastSeen: true,
            participations: {
              include: { room: { select: { id: true, name: true } } },
            },
          },
        },
        createdBy: { select: { username: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Strip token from response
    res.json(agents.map((a: any) => ({ ...a, token: '[redacted]' })));
  } catch (err) {
    console.error('[agents] list error:', err);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

/**
 * PUT /api/agents/:id/rooms
 * Add or remove an agent from a room (admin only).
 * Body: { roomId, action: 'add' | 'remove' }
 */
router.put('/:id/rooms', authenticate, requireAdmin, async (req, res) => {
  const { roomId, action } = req.body;

  if (!roomId || !['add', 'remove'].includes(action)) {
    return res.status(400).json({ error: "roomId and action ('add' | 'remove') required" });
  }

  try {
    const agent = await (prisma as any).agentToken.findUnique({ where: { id: req.params.id } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    if (action === 'add') {
      await prisma.roomParticipant.upsert({
        where:  { userId_roomId: { userId: agent.userId, roomId } },
        create: { userId: agent.userId, roomId, role: 'MEMBER' },
        update: {},
      });
    } else {
      await prisma.roomParticipant.deleteMany({
        where: { userId: agent.userId, roomId },
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[agents] room update error:', err);
    res.status(500).json({ error: 'Failed to update agent rooms' });
  }
});

/**
 * PATCH /api/agents/:id
 * Update agent metadata (admin only).
 * Body: { webhookUrl?, isActive?, description? }
 */
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const { webhookUrl, isActive, description } = req.body;

  try {
    const updated = await (prisma as any).agentToken.update({
      where: { id: req.params.id },
      data: {
        ...(webhookUrl  !== undefined && { webhookUrl }),
        ...(isActive    !== undefined && { isActive }),
        ...(description !== undefined && { description }),
      },
    });
    res.json({ success: true, agentId: updated.id, isActive: updated.isActive });
  } catch (err) {
    console.error('[agents] patch error:', err);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

/**
 * PATCH /api/agents/:id/visibility
 * Update agent visibility (creator only).
 * Body: { visibility: 'private' | 'public' | 'shared', sharedWith?: string[] }
 */
router.patch('/:id/visibility', authenticate, async (req, res) => {
  const { visibility, sharedWith } = req.body;
  const userId = req.user!.id;

  if (!['private', 'public', 'shared'].includes(visibility)) {
    return res.status(400).json({ error: 'visibility must be private, public, or shared' });
  }

  try {
    const agent = await prisma.agentToken.findUnique({ where: { id: req.params.id } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // Only creator or system admin can change visibility
    if (agent.createdById !== userId && !(req.user as any)?.isAdmin) {
      return res.status(403).json({ error: 'Only the agent creator can change visibility' });
    }

    const updated = await prisma.agentToken.update({
      where: { id: req.params.id },
      data: {
        visibility,
        sharedWith: visibility === 'shared' ? (sharedWith || []) : [],
      },
    });

    res.json({ success: true, visibility: updated.visibility, sharedWith: updated.sharedWith });
  } catch (err) {
    console.error('[agents] visibility error:', err);
    res.status(500).json({ error: 'Failed to update visibility' });
  }
});

/**
 * PATCH /api/agents/:id/activate
 * Approve or reject a pending agent (admin only).
 * Body: { action: 'activate' | 'reject' }
 */
router.patch('/:id/activate', authenticate, requireAdmin, async (req, res) => {
  const { action } = req.body;
  if (!['activate', 'reject'].includes(action)) {
    return res.status(400).json({ error: "action must be 'activate' or 'reject'" });
  }

  try {
    const agent = await (prisma as any).agentToken.findUnique({ where: { id: req.params.id } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const isActivating = action === 'activate';
    await prisma.$transaction([
      (prisma as any).agentToken.update({
        where: { id: req.params.id },
        data: { status: isActivating ? 'active' : 'rejected', isActive: isActivating },
      }),
      // Sync the agent's User record — active ↔ inactive mirrors the token status
      prisma.user.update({
        where: { id: agent.userId },
        data:  { isActive: isActivating },
      }),
    ]);

    res.json({ success: true, agentId: req.params.id, status: isActivating ? 'active' : 'rejected' });
  } catch (err) {
    console.error('[agents] activate error:', err);
    res.status(500).json({ error: 'Failed to update agent status' });
  }
});

/**
 * DELETE /api/agents/:id
 * Permanently delete an agent and its User record (admin only).
 */
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const agent = await (prisma as any).agentToken.findUnique({ where: { id: req.params.id } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // Cascade: deleting User cascades to AgentToken (onDelete: Cascade in schema)
    await prisma.user.delete({ where: { id: agent.userId } });
    res.json({ success: true });
  } catch (err) {
    console.error('[agents] delete error:', err);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

// ─── Agent: Send Message ─────────────────────────────────────────────────────

/**
 * POST /api/agents/message
 * External agent posts a message to a room.
 *
 * Authentication: Bearer <agentToken>  (NOT a JWT — it's the raw BYOA token)
 * Body: { roomId, content }
 *
 * Errors:
 *   401 — missing/invalid/inactive token
 *   403 — agent not a participant in roomId
 *   400 — missing roomId or content
 */
router.post('/message', async (req, res) => {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer byoa_')) {
    return res.status(401).json({ error: 'Agent bearer token required (prefix: byoa_)' });
  }

  const rawToken = authHeader.slice('Bearer '.length);

  try {
    // Validate token
    const agentToken = await (prisma as any).agentToken.findUnique({
      where:   { token: rawToken },
      include: { agentUser: { select: { id: true, username: true, displayName: true, userType: true, isActive: true } } },
      // status is a top-level field on agentToken — already returned by findUnique
    });

    if (!agentToken || !agentToken.agentUser.isActive) {
      return res.status(401).json({ error: 'Invalid agent token' });
    }
    if (agentToken.status === 'pending') {
      return res.status(403).json({ error: 'Agent is pending admin approval' });
    }
    if (agentToken.status === 'rejected' || !agentToken.isActive) {
      return res.status(403).json({ error: 'Agent has been deactivated or rejected' });
    }

    const { roomId, content } = req.body;
    if (!roomId || typeof content !== 'string' || content.trim() === '') {
      return res.status(400).json({ error: 'roomId and non-empty content are required' });
    }

    // Verify agent is a participant in this room
    const participation = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId: agentToken.userId, roomId } },
    });
    if (!participation) {
      return res.status(403).json({ error: 'Agent is not a participant in this room' });
    }

    // Create the message
    const message = await prisma.message.create({
      data: {
        content:     content.trim(),
        senderId:    agentToken.userId,
        roomId,
        messageType: 'AI_RESPONSE',
      },
      include: {
        sender: {
          select: { id: true, username: true, displayName: true, userType: true, avatar: true },
        },
        reactions: {
          include: { user: { select: { username: true, displayName: true } } },
        },
      },
    });

    // Update agent's lastUsedAt + room activity
    await Promise.all([
      (prisma as any).agentToken.update({
        where: { id: agentToken.id },
        data:  { lastUsedAt: new Date() },
      }),
      prisma.room.update({
        where: { id: roomId },
        data:  { lastActivity: new Date(), messageCount: { increment: 1 } },
      }),
    ]);

    // Broadcast to room via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(roomId).emit('message:new', message);
    }

    res.status(201).json({ success: true, messageId: message.id });
  } catch (err: any) {
    console.error('[agents] message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export { router as agentRoutes };
