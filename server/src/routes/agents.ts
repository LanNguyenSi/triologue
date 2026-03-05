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

function parseDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function summarizeMemoryPayload(payload: any): string {
  if (!payload || typeof payload !== 'object') return '';
  const summary = String(payload.summary || '').trim();
  if (summary) return summary.slice(0, 180);
  const note = String(payload.note || '').trim();
  if (note) return note.slice(0, 180);
  const decision = String(payload.decision || '').trim();
  if (decision) return decision.slice(0, 180);
  const text = JSON.stringify(payload);
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function deriveMemoryFreshness(payload: any, expiresAtRaw: unknown, now: Date) {
  const payloadObj = payload && typeof payload === 'object' ? payload : {};
  const expiresAt = parseDateOrNull(expiresAtRaw);
  const payloadValidUntil = parseDateOrNull(payloadObj.validUntil);
  const validUntil = expiresAt || payloadValidUntil;
  const isStale = Boolean(validUntil && validUntil.getTime() <= now.getTime());
  return {
    status: isStale ? 'stale' : validUntil ? 'fresh' : 'unknown',
    warning: isStale ? 'Memory entry is stale and should be reviewed.' : null,
    validUntil: validUntil ? validUntil.toISOString() : null,
    isStale,
  };
}

function parseStringList(input: unknown, maxItems: number): string[] {
  const out: string[] = [];
  const add = (value: unknown) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || out.includes(normalized)) return;
    out.push(normalized.slice(0, 120));
  };
  if (Array.isArray(input)) {
    for (const item of input) add(item);
  } else if (typeof input === 'string') {
    for (const item of input.split(/,|\n/)) add(item);
  }
  return out.slice(0, maxItems);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseMemoryTopK(value: unknown, fallback = 20): number {
  return Math.round(clampNumber(value, fallback, 1, 50));
}

async function loadAgentProjectScope(agentUserId: string) {
  const directProjects = await (prisma as any).project.findMany({
    where: {
      OR: [
        { ownerId: agentUserId },
        { teamMemberIds: { has: agentUserId } },
      ],
    },
    select: { id: true, name: true, roomId: true },
    take: 400,
  });

  const map = new Map<string, { id: string; name: string; roomId: string | null }>();
  for (const project of directProjects) {
    map.set(project.id, {
      id: project.id,
      name: project.name,
      roomId: project.roomId || null,
    });
  }
  return map;
}

function normalizeMemoryIdList(value: unknown): string[] {
  const ids: string[] = [];
  const add = (raw: unknown) => {
    const id = String(raw || '').trim();
    if (!id || ids.includes(id)) return;
    ids.push(id.slice(0, 80));
  };
  if (Array.isArray(value)) {
    for (const item of value) add(item);
  } else if (typeof value === 'string') {
    for (const item of value.split(/,|\n/)) add(item);
  }
  return ids.slice(0, 80);
}

type AgentMemoryQueryInput = {
  projectIds: string[];
  q?: string;
  tags?: string[];
  memoryTypes?: string[];
  includeStale?: boolean;
  topK?: number;
  preferredMemoryIds?: string[];
};

async function queryAgentMemory(input: AgentMemoryQueryInput) {
  const now = new Date();
  const q = String(input.q || '').trim().toLowerCase().slice(0, 200);
  const tags = Array.isArray(input.tags) ? input.tags.slice(0, 12) : [];
  const memoryTypes = Array.isArray(input.memoryTypes) ? input.memoryTypes.slice(0, 20) : [];
  const includeStale = Boolean(input.includeStale);
  const topK = parseMemoryTopK(input.topK, 20);
  const preferredMemoryIds = new Set(normalizeMemoryIdList(input.preferredMemoryIds));

  const projectIds = Array.from(new Set((input.projectIds || []).filter(Boolean))).slice(0, 200);
  const scopeFilter = projectIds.length > 0
    ? {
        OR: [
          { scope: 'GLOBAL' },
          { scope: 'PROJECT', projectId: { in: projectIds } },
        ],
      }
    : { scope: 'GLOBAL' };

  const whereAnd: any[] = [
    scopeFilter,
    { archivedAt: null },
  ];

  if (!includeStale) {
    whereAnd.push({
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    });
  }

  if (memoryTypes.length > 0) {
    whereAnd.push({ memoryType: { in: memoryTypes } });
  }

  if (tags.length > 0) {
    whereAnd.push({ tags: { hasSome: tags } });
  }

  const rows = await (prisma as any).agentMemoryEntry.findMany({
    where: { AND: whereAnd },
    orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: Math.min(320, Math.max(80, topK * 8)),
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
      updatedAt: true,
      createdAt: true,
    },
  });

  const ranked = rows
    .map((entry: any) => {
      const summary = summarizeMemoryPayload(entry.payload);
      const freshness = deriveMemoryFreshness(entry.payload, entry.expiresAt, now);
      const haystack = [
        String(entry.title || '').toLowerCase(),
        String(entry.memoryType || '').toLowerCase(),
        summary.toLowerCase(),
        ...(Array.isArray(entry.tags) ? entry.tags.map((tag: string) => String(tag).toLowerCase()) : []),
      ].join(' ');
      const hasQ = q ? haystack.includes(q) : false;
      const tagHits = tags.filter((tag) => Array.isArray(entry.tags) && entry.tags.includes(tag)).length;
      const confidence = Number(entry.confidence || 0);
      const updatedAtMs = new Date(entry.updatedAt).getTime();
      const hoursSinceUpdate = Math.max(0, (Date.now() - updatedAtMs) / (1000 * 60 * 60));
      const recencyBoost = Math.max(0, 24 - Math.min(24, hoursSinceUpdate)) * 0.5;
      const score =
        (entry.isPinned ? 35 : 0) +
        confidence * 100 +
        (projectIds.length > 0 && entry.scope === 'PROJECT' ? 10 : 0) +
        (preferredMemoryIds.has(entry.id) ? 28 : 0) +
        (hasQ ? 18 : q ? -8 : 0) +
        tagHits * 8 +
        recencyBoost +
        (freshness.isStale ? -42 : 0);

      const reasons: string[] = [];
      if (entry.isPinned) reasons.push('pinned');
      if (preferredMemoryIds.has(entry.id)) reasons.push('task_linked');
      if (hasQ) reasons.push('query_match');
      if (tagHits > 0) reasons.push(`tag_match:${tagHits}`);
      if (entry.scope === 'PROJECT') reasons.push('project_scope');
      if (freshness.isStale) reasons.push('stale_penalty');

      return {
        id: entry.id,
        scope: entry.scope,
        projectId: entry.projectId || null,
        memoryType: entry.memoryType,
        title: entry.title || '',
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        summary,
        confidence,
        pluginId: entry.pluginId,
        moduleKey: entry.moduleKey || null,
        freshnessStatus: freshness.status,
        freshnessWarning: freshness.warning,
        validUntil: freshness.validUntil,
        updatedAt: entry.updatedAt,
        createdAt: entry.createdAt,
        score: Number(score.toFixed(2)),
        reasons,
      };
    })
    .filter((entry: any) => (q ? entry.reasons.includes('query_match') : true))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, topK);

  return ranked;
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
 * Body: { name, webhookUrl?, roomId?, description?, emoji?, color?, trustLevel?, receiveMode?, delivery? }
 * Returns: { agentId, agentUserId, agentUsername, mentionKey, status, trustLevel, token }
 *          ↑ token is ONLY returned here — store it safely!
 */
router.post('/', authenticate, async (req, res) => {
  const { name, webhookUrl, roomId, description, emoji, color, trustLevel, receiveMode, delivery } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  // Unique username for the agent's User record
  const suffix     = crypto.randomBytes(4).toString('hex');
  const username   = `agent_${toMentionKey(name)}_${suffix}`;
  const mentionKey = toMentionKey(name);
  const token      = 'byoa_' + crypto.randomBytes(32).toString('hex');

  try {
    // ── Check mentionKey uniqueness ──────────────────────────────────────
    const existingAgent = await prisma.agentToken.findUnique({
      where: { mentionKey },
      select: { name: true },
    });
    if (existingAgent) {
      return res.status(409).json({
        error: `Mention key @${mentionKey} is already taken by agent "${existingAgent.name}". Choose a different name.`,
      });
    }
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
          webhookUrl: webhookUrl || null,
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
      where: {
        agentUser: {
          isDeleted: false, // Filter out soft-deleted agents
        },
      },
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
      (prisma as any).user.update({
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

/**
 * GET /api/agents/me/context
 * Self-context endpoint for BYOA agents. Returns scoped projects, assigned tasks,
 * room context and ranked memory entries.
 */
router.get('/me/context', async (req, res) => {
  const rawToken = readByoaBearerToken(req);
  if (!rawToken) {
    return res.status(401).json({ error: 'Agent bearer token required (prefix: byoa_)' });
  }

  const projectId = String(req.query.projectId || '').trim();
  const taskId = String(req.query.taskId || '').trim();
  const includeMessages = String(req.query.includeMessages || '').toLowerCase() === 'true';
  const memoryTopK = parseMemoryTopK(req.query.memoryTopK, 20);

  try {
    const authResult = await resolveActiveAgentToken(rawToken);
    if (authResult.error) {
      return res.status(authResult.error.status).json({ error: authResult.error.message });
    }
    const agentToken = authResult.agentToken!;

    const projectScope = await loadAgentProjectScope(agentToken.userId);
    if (projectId && !projectScope.has(projectId)) {
      return res.status(403).json({ error: 'Agent has no access to this project scope' });
    }

    let taskFocus: any = null;
    if (taskId) {
      taskFocus = await (prisma as any).task.findFirst({
        where: { id: taskId, assignedTo: agentToken.userId },
        include: {
          project: { select: { id: true, name: true, roomId: true } },
        },
      });
      if (!taskFocus) {
        return res.status(404).json({ error: 'Task not found or not assigned to this agent' });
      }
      if (!projectScope.has(taskFocus.projectId)) {
        return res.status(403).json({ error: 'Agent has no access to task project scope' });
      }
      if (projectId && projectId !== taskFocus.projectId) {
        return res.status(400).json({ error: 'taskId does not belong to the requested projectId' });
      }
    }

    const scopedProjectIds = projectId
      ? [projectId]
      : taskFocus?.projectId
        ? [taskFocus.projectId]
        : Array.from(projectScope.keys());

    const tasks = await (prisma as any).task.findMany({
      where: {
        assignedTo: agentToken.userId,
        status: { not: 'done' },
        ...(scopedProjectIds.length > 0 ? { projectId: { in: scopedProjectIds } } : {}),
      },
      include: {
        project: { select: { id: true, name: true, roomId: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 40,
    });

    const preferredMemoryIds = taskFocus
      ? normalizeMemoryIdList(taskFocus.usedMemoryIds)
      : normalizeMemoryIdList(
          tasks.flatMap((task: any) => (Array.isArray(task.usedMemoryIds) ? task.usedMemoryIds : [])),
        );

    const memory = await queryAgentMemory({
      projectIds: scopedProjectIds,
      topK: memoryTopK,
      includeStale: false,
      preferredMemoryIds,
    });

    const roomParticipations = await prisma.roomParticipant.findMany({
      where: { userId: agentToken.userId },
      include: {
        room: {
          select: { id: true, name: true },
        },
      },
      take: 200,
    });

    const roomIds = roomParticipations.map((entry: any) => entry.room.id);
    const recentByRoom = new Map<string, any[]>();
    if (includeMessages && roomIds.length > 0) {
      const recentSets = await Promise.all(
        roomIds.slice(0, 30).map((id) =>
          prisma.message.findMany({
            where: { roomId: id, isDeleted: false },
            orderBy: { createdAt: 'desc' },
            take: 8,
            include: {
              sender: { select: { username: true, userType: true } },
            },
          }),
        ),
      );
      roomIds.slice(0, 30).forEach((id, index) => {
        const messages = recentSets[index] || [];
        recentByRoom.set(
          id,
          messages.reverse().map((msg: any) => ({
            id: msg.id,
            sender: msg.sender?.username || 'unknown',
            senderType: msg.sender?.userType || 'unknown',
            content: msg.content,
            timestamp: msg.createdAt,
          })),
        );
      });
    }

    const scopedProjects = scopedProjectIds
      .map((id) => projectScope.get(id))
      .filter(Boolean) as Array<{ id: string; name: string; roomId: string | null }>;
    const projectByRoom = new Map<string, { id: string; name: string }>();
    for (const p of scopedProjects) {
      if (p.roomId) projectByRoom.set(p.roomId, { id: p.id, name: p.name });
    }

    return res.json({
      agent: {
        id: agentToken.id,
        userId: agentToken.userId,
        mentionKey: agentToken.mentionKey,
        name: agentToken.name,
      },
      projects: scopedProjects,
      taskFocus: taskFocus
        ? {
            id: taskFocus.id,
            title: taskFocus.title,
            projectId: taskFocus.projectId,
            usedMemoryIds: normalizeMemoryIdList(taskFocus.usedMemoryIds),
          }
        : null,
      tasks: tasks.map((task: any) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority || 'medium',
        project: task.project ? { id: task.project.id, name: task.project.name } : null,
        usedMemoryIds: normalizeMemoryIdList(task.usedMemoryIds),
        updatedAt: task.updatedAt,
      })),
      memory: memory.map((item: any) => {
        const { score, reasons, ...rest } = item;
        return rest;
      }),
      roomContext: {
        count: roomParticipations.length,
        rooms: roomParticipations.map((entry: any) => ({
          id: entry.room.id,
          name: entry.room.name,
          linkedProject: projectByRoom.get(entry.room.id) || null,
          recentMessages: recentByRoom.get(entry.room.id) || [],
        })),
      },
    });
  } catch (err) {
    console.error('[agents] me/context error:', err);
    return res.status(500).json({ error: 'Failed to load agent self-context' });
  }
});

/**
 * POST /api/agents/me/memory/query
 * Query agent-accessible memory entries with task/project scoped ranking.
 */
router.post('/me/memory/query', async (req, res) => {
  const rawToken = readByoaBearerToken(req);
  if (!rawToken) {
    return res.status(401).json({ error: 'Agent bearer token required (prefix: byoa_)' });
  }

  const projectId = String(req.body?.projectId || '').trim();
  const taskId = String(req.body?.taskId || '').trim();
  const q = String(req.body?.q || '').trim().slice(0, 200);
  const tags = parseStringList(req.body?.tags, 12);
  const memoryTypes = parseStringList(req.body?.memoryTypes, 20);
  const includeStale = Boolean(req.body?.includeStale);
  const topK = parseMemoryTopK(req.body?.topK, 20);

  try {
    const authResult = await resolveActiveAgentToken(rawToken);
    if (authResult.error) {
      return res.status(authResult.error.status).json({ error: authResult.error.message });
    }
    const agentToken = authResult.agentToken!;

    const projectScope = await loadAgentProjectScope(agentToken.userId);
    if (projectId && !projectScope.has(projectId)) {
      return res.status(403).json({ error: 'Agent has no access to this project scope' });
    }

    let taskFocus: any = null;
    if (taskId) {
      taskFocus = await (prisma as any).task.findFirst({
        where: { id: taskId, assignedTo: agentToken.userId },
        select: { id: true, projectId: true, usedMemoryIds: true },
      });
      if (!taskFocus) {
        return res.status(404).json({ error: 'Task not found or not assigned to this agent' });
      }
      if (!projectScope.has(taskFocus.projectId)) {
        return res.status(403).json({ error: 'Agent has no access to task project scope' });
      }
      if (projectId && projectId !== taskFocus.projectId) {
        return res.status(400).json({ error: 'taskId does not belong to the requested projectId' });
      }
    }

    const scopedProjectIds = projectId
      ? [projectId]
      : taskFocus?.projectId
        ? [taskFocus.projectId]
        : Array.from(projectScope.keys());

    const items = await queryAgentMemory({
      projectIds: scopedProjectIds,
      q,
      tags,
      memoryTypes,
      includeStale,
      topK,
      preferredMemoryIds: taskFocus ? taskFocus.usedMemoryIds : [],
    });

    return res.json({
      count: items.length,
      items,
      scope: {
        projectIds: scopedProjectIds,
        taskId: taskFocus?.id || null,
      },
    });
  } catch (err) {
    console.error('[agents] me/memory/query error:', err);
    return res.status(500).json({ error: 'Failed to query agent memory' });
  }
});

/**
 * POST /api/agents/me/memory/resolve
 * Resolve a set of memory IDs in the caller's authorized scope.
 */
router.post('/me/memory/resolve', async (req, res) => {
  const rawToken = readByoaBearerToken(req);
  if (!rawToken) {
    return res.status(401).json({ error: 'Agent bearer token required (prefix: byoa_)' });
  }

  const ids = normalizeMemoryIdList(req.body?.ids);
  const projectId = String(req.body?.projectId || '').trim();
  if (ids.length === 0) {
    return res.status(400).json({ error: 'ids must contain at least one memory ID' });
  }

  try {
    const authResult = await resolveActiveAgentToken(rawToken);
    if (authResult.error) {
      return res.status(authResult.error.status).json({ error: authResult.error.message });
    }
    const agentToken = authResult.agentToken!;

    const projectScope = await loadAgentProjectScope(agentToken.userId);
    if (projectId && !projectScope.has(projectId)) {
      return res.status(403).json({ error: 'Agent has no access to this project scope' });
    }

    const scopedProjectIds = projectId ? [projectId] : Array.from(projectScope.keys());
    const scopeFilter = scopedProjectIds.length > 0
      ? {
          OR: [
            { scope: 'GLOBAL' },
            { scope: 'PROJECT', projectId: { in: scopedProjectIds } },
          ],
        }
      : { scope: 'GLOBAL' };

    const now = new Date();
    const rows = await (prisma as any).agentMemoryEntry.findMany({
      where: {
        AND: [
          { id: { in: ids } },
          { archivedAt: null },
          scopeFilter,
        ],
      },
      select: {
        id: true,
        scope: true,
        projectId: true,
        memoryType: true,
        title: true,
        tags: true,
        payload: true,
        confidence: true,
        pluginId: true,
        moduleKey: true,
        expiresAt: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    const byId = new Map<string, any>(rows.map((row: any) => [row.id, row]));
    const items = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((entry: any) => {
        const freshness = deriveMemoryFreshness(entry.payload, entry.expiresAt, now);
        return {
          id: entry.id,
          scope: entry.scope,
          projectId: entry.projectId || null,
          memoryType: entry.memoryType,
          title: entry.title || '',
          tags: Array.isArray(entry.tags) ? entry.tags : [],
          summary: summarizeMemoryPayload(entry.payload),
          confidence: Number(entry.confidence || 0),
          pluginId: entry.pluginId,
          moduleKey: entry.moduleKey || null,
          freshnessStatus: freshness.status,
          freshnessWarning: freshness.warning,
          validUntil: freshness.validUntil,
          updatedAt: entry.updatedAt,
          createdAt: entry.createdAt,
        };
      });

    const foundIds = new Set(items.map((item) => item.id));
    const missingIds = ids.filter((id) => !foundIds.has(id));

    return res.json({
      count: items.length,
      items,
      missingIds,
    });
  } catch (err) {
    console.error('[agents] me/memory/resolve error:', err);
    return res.status(500).json({ error: 'Failed to resolve memory IDs' });
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
