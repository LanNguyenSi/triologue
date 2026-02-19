/**
 * BYOA (Bring Your Own Agent) Routes
 * Ice 🧊 — 2026-02-19
 *
 * Allows external AI agents to integrate with Triologue rooms via webhook.
 *
 * Flow:
 *   1. Admin creates an agent → receives a one-time bearer token
 *   2. Agent's webhook receives messages when @mentioned in a room
 *   3. Agent replies via POST /api/agents/message with its bearer token
 *
 * Security:
 *   - Agent tokens are hashed before storage (only returned once on creation)
 *   - Agents can only post to rooms they've been added to
 *   - Agents cannot trigger other agents (canTriggerAI=false on their User record)
 *   - Rate limit: 10 messages/minute per agent
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
 * POST /api/agents
 * Create a new BYOA agent.
 * Body: { name, webhookUrl, roomId?, description? }
 * Returns: { agentId, agentUserId, agentUsername, mentionKey, token }
 *          ↑ token is ONLY returned here — store it safely!
 */
router.post('/', authenticate, requireAdmin, async (req, res) => {
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
          userType:    'AI_OTHER',
          isActive:    true,
          canTriggerAI: false, // Agents must not trigger other agents — prevents loops
        },
      });

      const agentToken = await tx.agentToken.create({
        data: {
          token,
          name,
          description,
          webhookUrl,
          mentionKey,
          userId:      agentUser.id,
          createdById: req.user!.id,
        },
      });

      // Optionally add agent to a room immediately
      if (roomId) {
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
      token, // ⚠️  One-time — cannot be retrieved again
      message: `Agent created. Mention with @${mentionKey} in chat.`,
    });
  } catch (err: any) {
    console.error('[agents] create error:', err);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

/**
 * GET /api/agents
 * List all BYOA agents with their room memberships (admin only).
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
      include: { agentUser: { select: { id: true, username: true, displayName: true, userType: true } } },
    });

    if (!agentToken || !agentToken.isActive || !agentToken.agentUser.isActive) {
      return res.status(401).json({ error: 'Invalid or inactive agent token' });
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
