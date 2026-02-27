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
import { authenticate } from '../middleware/auth';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { createMentionInboxItems } from '../services/inboxService';
import {
  parseIncludeBase64Flag,
  readAttachmentContent,
} from '../services/attachmentProcessing';
import {
  getLinkedProjectStatus,
  isRoomWriteBlocked,
} from '../utils/projectRoomPolicy';
import { pluginManager } from '../plugins/manager';

const router = Router();

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

async function syncLinkedProjectTeam(roomId: string, userId: string) {
  const linkedProject = await (prisma as any).project.findFirst({
    where: { roomId },
    select: { id: true, ownerId: true, teamMemberIds: true },
  });
  if (!linkedProject) return;

  const nextTeam = Array.from(new Set<string>([
    linkedProject.ownerId,
    ...(linkedProject.teamMemberIds || []),
    userId,
  ]));

  await (prisma as any).project.update({
    where: { id: linkedProject.id },
    data: { teamMemberIds: nextTeam },
  });
}

function readByoaBearerToken(req: any): string | null {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer byoa_')) return null;
  return authHeader.slice('Bearer '.length);
}

async function resolveActiveAgentToken(rawToken: string): Promise<{
  agentToken?: any;
  error?: { status: number; message: string };
}> {
  const agentToken = await (prisma as any).agentToken.findUnique({
    where: { token: rawToken },
    include: {
      agentUser: { select: { id: true, isActive: true } },
    },
  });

  if (!agentToken || !agentToken.agentUser?.isActive) {
    return { error: { status: 401, message: 'Invalid agent token' } };
  }
  if (agentToken.status === 'pending') {
    return { error: { status: 403, message: 'Agent is pending admin approval' } };
  }
  if (agentToken.status === 'rejected' || !agentToken.isActive) {
    return { error: { status: 403, message: 'Agent has been deactivated or rejected' } };
  }

  return { agentToken };
}

async function resolveProjectForAgent(projectId: string, agentUserId: string): Promise<{
  project?: any;
  error?: { status: number; message: string };
}> {
  const project = await (prisma as any).project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      ownerId: true,
      teamMemberIds: true,
      roomId: true,
    },
  });

  if (!project) {
    return { error: { status: 404, message: 'Project not found' } };
  }

  let canAccess =
    project.ownerId === agentUserId ||
    (project.teamMemberIds || []).includes(agentUserId);

  if (!canAccess && project.roomId) {
    const roomMembership = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId: agentUserId, roomId: project.roomId } },
      select: { userId: true },
    });
    canAccess = Boolean(roomMembership);
  }

  if (!canAccess) {
    return { error: { status: 403, message: 'Agent has no access to this project attachments scope' } };
  }

  return { project };
}

function mapAttachmentForApi(attachment: any) {
  const fileApiUrl = attachment.url?.startsWith('/uploads/')
    ? `/api/files/${encodeURIComponent(attachment.url.replace('/uploads/', ''))}`
    : attachment.url;
  return {
    id: attachment.id,
    projectId: attachment.projectId ?? null,
    taskId: attachment.taskId ?? null,
    messageId: attachment.messageId ?? null,
    filename: attachment.filename,
    url: attachment.url,
    mimeType: attachment.mimeType ?? null,
    size: attachment.size ?? null,
    type: attachment.type ?? null,
    uploadedBy: attachment.uploadedBy ?? null,
    sourcePluginId: attachment.sourcePluginId ?? null,
    createdAt: attachment.createdAt ?? null,
    fileApiUrl,
  };
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
 * GET /api/agents/gateway-config
 * Returns the full agent configuration needed by the Agent Gateway.
 * Auth: Gateway token (Bearer byoa_gateway_xxx) — not a JWT.
 * This replaces the static agents.json file.
 */
router.get('/gateway-config', async (req, res) => {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer byoa_')) {
    return res.status(401).json({ error: 'Gateway bearer token required' });
  }

  const rawToken = authHeader.slice('Bearer '.length);

  try {
    // Verify this is the gateway's own token
    const gatewayAgent = await (prisma as any).agentToken.findUnique({
      where: { token: rawToken },
      include: { agentUser: { select: { username: true } } },
    });
    // Only the gateway user or an admin can access this
    if (!gatewayAgent || (gatewayAgent.agentUser.username !== 'gateway' && gatewayAgent.agentUser.username !== 'gateway-agent-001')) {
      // Fallback: check if it's any active admin
      return res.status(403).json({ error: 'Gateway token required' });
    }

    const agents = await (prisma as any).agentToken.findMany({
      where: { isActive: true, status: 'active' },
      include: {
        agentUser: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });

    const config = agents.map((a: any) => ({
      token: a.token,
      name: a.name,
      username: a.agentUser.username,
      userId: a.agentUser.id,
      mentionKey: a.mentionKey,
      webhookUrl: a.webhookUrl || null,
      webhookSecret: a.webhookSecret || null,
      delivery: a.delivery || 'webhook',
      trustLevel: a.trustLevel || 'standard',
      emoji: a.emoji || '🤖',
      color: a.color || null,
      connectionType: 'both',
      receiveMode: a.receiveMode || 'mentions',
    }));

    res.json({ agents: config, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[agents] gateway-config error:', err);
    res.status(500).json({ error: 'Failed to load gateway config' });
  }
});

/**
 * POST /api/agents
 * Create a new BYOA agent. Any authenticated user can create one.
 * 
 * Tiered activation:
 *   - Trusted users (canTriggerAI=true) → agent auto-activated (standard trust, mentions-only)
 *   - Other users → status="pending", admin must activate
 *   - Elevated trust always requires admin (even for trusted users)
 * 
 * Body: { name, webhookUrl, roomId?, description?, emoji?, color?, trustLevel?, receiveMode?, delivery? }
 * Returns: { agentId, agentUserId, agentUsername, mentionKey, status, trustLevel, token }
 *          ↑ token is ONLY returned here — store it safely!
 */
router.post('/', authenticate, async (req, res) => {
  const { name, webhookUrl, roomId, description, emoji, color, trustLevel, receiveMode, delivery } = req.body;

  if (!name || !webhookUrl) {
    return res.status(400).json({ error: 'name and webhookUrl are required' });
  }

  // Unique username for the agent's User record
  const suffix     = crypto.randomBytes(4).toString('hex');
  const username   = `agent_${toMentionKey(name)}_${suffix}`;
  const mentionKey = toMentionKey(name);
  const token      = 'byoa_' + crypto.randomBytes(32).toString('hex');

  try {
    // ── Trusted-User auto-activation ──────────────────────────────────────
    // Users with canTriggerAI=true get their agents activated immediately
    // with standard trust + mentions-only. Elevated trust still needs admin.
    const isTrustedCreator = req.user!.canTriggerAI === true;
    const autoActivate     = isTrustedCreator;
    const effectiveStatus  = autoActivate ? 'active' : 'pending';
    // Trusted users can request elevated, but it's capped to standard (admin must upgrade)
    const effectiveTrust   = autoActivate
      ? 'standard'  // always standard for auto-activation — elevated needs admin
      : (['standard', 'elevated'].includes(trustLevel) ? trustLevel : 'standard');

    // Atomic: create User + AgentToken + optional room join
    const result = await prisma.$transaction(async (tx) => {
      const agentUser = await (tx as any).user.create({
        data: {
          username,
          displayName: name,
          userType:    'AI_AGENT',
          isActive:    autoActivate, // Trusted users → active immediately
          canTriggerAI: false, // Agents must not trigger other agents — prevents loops
        },
      });

      const agentToken = await (tx as any).agentToken.create({
        data: {
          token,
          name,
          description,
          webhookUrl,
          mentionKey,
          status:      effectiveStatus,
          isActive:    autoActivate,
          userId:      agentUser.id,
          createdById: req.user!.id,
          emoji:       emoji || '🤖',
          color:       color || null,
          trustLevel:  effectiveTrust,
          receiveMode: ['mentions', 'all'].includes(receiveMode) ? receiveMode : 'mentions',
          delivery:    ['webhook', 'openclaw-inject'].includes(delivery) ? delivery : 'webhook',
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
      status:        effectiveStatus,
      trustLevel:    effectiveTrust,
      token, // ⚠️  One-time — cannot be retrieved again
      message: autoActivate
        ? `Agent created and activated (standard trust, mentions-only). Mention with @${mentionKey}.`
        : `Agent created (pending admin approval). Mention with @${mentionKey} once active.`,
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
      await syncLinkedProjectTeam(roomId, agent.userId);
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
    const agent = await (prisma as any).agentToken.findUnique({ where: { id: req.params.id } });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // Only creator or system admin can change visibility
    if (agent.createdById !== userId && !(req.user as any)?.isAdmin) {
      return res.status(403).json({ error: 'Only the agent creator can change visibility' });
    }

    const updated = await (prisma as any).agentToken.update({
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

    // Soft delete: mark user as deleted, deactivate agent token
    // Messages remain with senderId=null (foreign key set to null on delete)
    await Promise.all([
      prisma.user.update({
        where: { id: agent.userId },
        data: { isDeleted: true, isActive: false },
      }),
      (prisma as any).agentToken.update({
        where: { id: agent.id },
        data: { isActive: false, status: 'revoked' },
      }),
    ]);

    res.json({ success: true, message: 'Agent soft-deleted (messages preserved)' });
  } catch (err) {
    console.error('[agents] delete error:', err);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

/**
 * GET /api/agents/projects/:projectId/attachments
 * Programmatic project attachment listing for BYOA agents.
 *
 * Authentication: Bearer byoa_<token>
 */
router.get('/projects/:projectId/attachments', async (req, res) => {
  const rawToken = readByoaBearerToken(req);
  if (!rawToken) {
    return res.status(401).json({ error: 'Agent bearer token required (prefix: byoa_)' });
  }

  const projectId = String(req.params.projectId || '').trim();
  if (!projectId) {
    return res.status(400).json({ error: 'projectId is required' });
  }

  try {
    const authResult = await resolveActiveAgentToken(rawToken);
    if (authResult.error) {
      return res.status(authResult.error.status).json({ error: authResult.error.message });
    }
    const agentToken = authResult.agentToken!;

    const projectAccess = await resolveProjectForAgent(projectId, agentToken.userId);
    if (projectAccess.error) {
      return res.status(projectAccess.error.status).json({ error: projectAccess.error.message });
    }

    const attachments = await (prisma as any).projectAttachment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const items = attachments.map(mapAttachmentForApi);

    return res.json({
      projectId,
      count: items.length,
      attachments: items,
    });
  } catch (err) {
    console.error('[agents] project attachments error:', err);
    return res.status(500).json({ error: 'Failed to load project attachments' });
  }
});

/**
 * GET /api/agents/projects/:projectId/attachments/:attachmentId/content
 * Read project attachment content for agents (text extraction + optional base64).
 */
router.get('/projects/:projectId/attachments/:attachmentId/content', async (req, res) => {
  const rawToken = readByoaBearerToken(req);
  if (!rawToken) {
    return res.status(401).json({ error: 'Agent bearer token required (prefix: byoa_)' });
  }

  const projectId = String(req.params.projectId || '').trim();
  const attachmentId = String(req.params.attachmentId || '').trim();
  if (!projectId || !attachmentId) {
    return res.status(400).json({ error: 'projectId and attachmentId are required' });
  }

  try {
    const authResult = await resolveActiveAgentToken(rawToken);
    if (authResult.error) {
      return res.status(authResult.error.status).json({ error: authResult.error.message });
    }
    const agentToken = authResult.agentToken!;

    const projectAccess = await resolveProjectForAgent(projectId, agentToken.userId);
    if (projectAccess.error) {
      return res.status(projectAccess.error.status).json({ error: projectAccess.error.message });
    }

    const attachment = await (prisma as any).projectAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment || attachment.projectId !== projectId) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const includeBase64 = parseIncludeBase64Flag(req.query.includeBase64);
    const contentResult = await readAttachmentContent(attachment.url, attachment.mimeType, {
      includeBase64,
      textByteLimit: req.query.textByteLimit,
      base64ByteLimit: req.query.base64ByteLimit,
    });

    return res.json({
      projectId,
      attachment: {
        ...mapAttachmentForApi(attachment),
        scope: 'project',
      },
      processing: {
        status: contentResult.status,
        parser: contentResult.parser,
        note: contentResult.note,
        supportedMimeTypes: contentResult.supportedMimeTypes,
      },
      content: {
        text: contentResult.text,
        excerpt: contentResult.excerpt,
        truncated: contentResult.truncated,
        bytesRead: contentResult.bytesRead,
        fileSize: contentResult.fileSize,
        base64: contentResult.base64,
        base64Included: contentResult.base64Included,
        base64Truncated: contentResult.base64Truncated,
      },
    });
  } catch (err) {
    console.error('[agents] project attachment content error:', err);
    return res.status(500).json({ error: 'Failed to read attachment content' });
  }
});

/**
 * GET /api/agents/projects/:projectId/tasks/:taskId/attachments/:attachmentId/content
 * Read task attachment content for agents.
 */
router.get('/projects/:projectId/tasks/:taskId/attachments/:attachmentId/content', async (req, res) => {
  const rawToken = readByoaBearerToken(req);
  if (!rawToken) {
    return res.status(401).json({ error: 'Agent bearer token required (prefix: byoa_)' });
  }

  const projectId = String(req.params.projectId || '').trim();
  const taskId = String(req.params.taskId || '').trim();
  const attachmentId = String(req.params.attachmentId || '').trim();
  if (!projectId || !taskId || !attachmentId) {
    return res.status(400).json({ error: 'projectId, taskId and attachmentId are required' });
  }

  try {
    const authResult = await resolveActiveAgentToken(rawToken);
    if (authResult.error) {
      return res.status(authResult.error.status).json({ error: authResult.error.message });
    }
    const agentToken = authResult.agentToken!;

    const projectAccess = await resolveProjectForAgent(projectId, agentToken.userId);
    if (projectAccess.error) {
      return res.status(projectAccess.error.status).json({ error: projectAccess.error.message });
    }

    const attachment = await (prisma as any).taskAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        task: {
          select: { id: true, projectId: true },
        },
      },
    });
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    if (attachment.taskId !== taskId || attachment.task?.projectId !== projectId) {
      return res.status(404).json({ error: 'Attachment not found in this task/project scope' });
    }

    const includeBase64 = parseIncludeBase64Flag(req.query.includeBase64);
    const contentResult = await readAttachmentContent(attachment.url, attachment.mimeType, {
      includeBase64,
      textByteLimit: req.query.textByteLimit,
      base64ByteLimit: req.query.base64ByteLimit,
    });

    return res.json({
      projectId,
      taskId,
      attachment: {
        ...mapAttachmentForApi(attachment),
        scope: 'task',
      },
      processing: {
        status: contentResult.status,
        parser: contentResult.parser,
        note: contentResult.note,
        supportedMimeTypes: contentResult.supportedMimeTypes,
      },
      content: {
        text: contentResult.text,
        excerpt: contentResult.excerpt,
        truncated: contentResult.truncated,
        bytesRead: contentResult.bytesRead,
        fileSize: contentResult.fileSize,
        base64: contentResult.base64,
        base64Included: contentResult.base64Included,
        base64Truncated: contentResult.base64Truncated,
      },
    });
  } catch (err) {
    console.error('[agents] task attachment content error:', err);
    return res.status(500).json({ error: 'Failed to read attachment content' });
  }
});

/**
 * GET /api/agents/rooms/:roomId/messages/:messageId/attachments/:attachmentId/content
 * Read chat attachment content for agents.
 */
router.get('/rooms/:roomId/messages/:messageId/attachments/:attachmentId/content', async (req, res) => {
  const rawToken = readByoaBearerToken(req);
  if (!rawToken) {
    return res.status(401).json({ error: 'Agent bearer token required (prefix: byoa_)' });
  }

  const roomId = String(req.params.roomId || '').trim();
  const messageId = String(req.params.messageId || '').trim();
  const attachmentId = String(req.params.attachmentId || '').trim();
  if (!roomId || !messageId || !attachmentId) {
    return res.status(400).json({ error: 'roomId, messageId and attachmentId are required' });
  }

  try {
    const authResult = await resolveActiveAgentToken(rawToken);
    if (authResult.error) {
      return res.status(authResult.error.status).json({ error: authResult.error.message });
    }
    const agentToken = authResult.agentToken!;

    const roomMembership = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId: agentToken.userId, roomId } },
      select: { userId: true },
    });
    if (!roomMembership) {
      return res.status(403).json({ error: 'Agent has no access to this room' });
    }

    const attachment = await prisma.messageAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        message: {
          select: { id: true, roomId: true },
        },
      },
    });
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    if (attachment.messageId !== messageId || attachment.message?.roomId !== roomId) {
      return res.status(404).json({ error: 'Attachment not found in this message/room scope' });
    }

    const includeBase64 = parseIncludeBase64Flag(req.query.includeBase64);
    const contentResult = await readAttachmentContent(attachment.url, attachment.mimeType, {
      includeBase64,
      textByteLimit: req.query.textByteLimit,
      base64ByteLimit: req.query.base64ByteLimit,
    });

    return res.json({
      roomId,
      messageId,
      attachment: {
        ...mapAttachmentForApi(attachment),
        scope: 'message',
      },
      processing: {
        status: contentResult.status,
        parser: contentResult.parser,
        note: contentResult.note,
        supportedMimeTypes: contentResult.supportedMimeTypes,
      },
      content: {
        text: contentResult.text,
        excerpt: contentResult.excerpt,
        truncated: contentResult.truncated,
        bytesRead: contentResult.bytesRead,
        fileSize: contentResult.fileSize,
        base64: contentResult.base64,
        base64Included: contentResult.base64Included,
        base64Truncated: contentResult.base64Truncated,
      },
    });
  } catch (err) {
    console.error('[agents] message attachment content error:', err);
    return res.status(500).json({ error: 'Failed to read attachment content' });
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

    const linkedProjectStatus = await getLinkedProjectStatus(prisma, roomId);
    if (isRoomWriteBlocked(linkedProjectStatus)) {
      return res.status(403).json({
        error: 'Messages are disabled because the linked project is closed.',
      });
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
    await pluginManager.emit("message.created", {
      messageId: message.id,
      roomId,
      senderId: agentToken.userId,
      source: "agent",
      messageType: message.messageType,
    });

    // Create inbox items for @mentions
    await createMentionInboxItems({
      roomId,
      actorId: agentToken.userId,
      content: content.trim(),
      messageId: message.id,
      io,
    }).catch((err) => console.warn('[agents] mention inbox error:', err.message));

    res.status(201).json({ success: true, messageId: message.id });
  } catch (err: any) {
    console.error('[agents] message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export { router as agentRoutes };
