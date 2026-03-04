/**
 * /api/secrets — User-level secrets (standalone, optionally linked to a project)
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../lib/prisma';
import { encryptSecret, decryptSecret } from '../utils/encryption';
import { logger } from '../utils/logger';

const router = Router();
const DEFAULT_SECRET_LIMIT = 12;
const MAX_SECRET_LIMIT = 100;

/**
 * GET /api/secrets
 * List all secrets for the authenticated user (no values exposed)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const legacy = (Array.isArray(req.query.legacy) ? req.query.legacy : [req.query.legacy])
      .map((value) => String(value).toLowerCase())
      .some((value) => value === '1' || value === 'true');
    const rawLimit = Number.parseInt(String(req.query.limit ?? DEFAULT_SECRET_LIMIT), 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(rawLimit, MAX_SECRET_LIMIT))
      : DEFAULT_SECRET_LIMIT;
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor.trim()
      ? req.query.cursor.trim()
      : null;
    const scope = typeof req.query.scope === 'string' ? req.query.scope.trim() : 'all';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const scopeFilter =
      scope === 'all'
        ? {}
        : scope === 'unlinked'
          ? { projectId: null }
          : { projectId: scope };

    const baseWhere: any = {
      AND: [
        { userId },
        scopeFilter,
        ...(q
          ? [{
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
                { lastUsedBy: { contains: q, mode: 'insensitive' } },
                { project: { is: { name: { contains: q, mode: 'insensitive' } } } },
              ],
            }]
          : []),
      ],
    };

    let paginatedWhere: any = baseWhere;

    if (cursor) {
      const cursorSecret = await (prisma as any).userSecret.findFirst({
        where: { AND: [baseWhere, { id: cursor }] },
        select: { id: true, updatedAt: true },
      });

      if (!cursorSecret) {
        return res.status(400).json({ error: 'Invalid cursor' });
      }

      paginatedWhere = {
        AND: [
          baseWhere,
          {
            OR: [
              { updatedAt: { lt: cursorSecret.updatedAt } },
              { updatedAt: cursorSecret.updatedAt, id: { lt: cursorSecret.id } },
            ],
          },
        ],
      };
    }

    const secrets = await (prisma as any).userSecret.findMany({
      where: paginatedWhere,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { project: { select: { id: true, name: true } } },
    });

    const hasMore = secrets.length > limit;
    const items = hasMore ? secrets.slice(0, limit) : secrets;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;
    const totalCount = await (prisma as any).userSecret.count({ where: baseWhere });

    const safe = items.map((s: any) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      projectId: s.projectId,
      projectName: s.project?.name || null,
      lastUsedAt: s.lastUsedAt,
      lastUsedBy: s.lastUsedBy,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    if (legacy) {
      return res.json(safe);
    }

    res.json({
      items: safe,
      totalCount,
      pageInfo: {
        limit,
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    logger.error('Error fetching secrets:', error);
    res.status(500).json({ error: 'Failed to fetch secrets' });
  }
});

/**
 * POST /api/secrets
 * Create a new secret
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { name, value, description, projectId } = req.body;

    if (!name?.trim() || !value?.trim()) {
      return res.status(400).json({ error: 'Name and value are required' });
    }

    // Validate project ownership if projectId provided
    if (projectId) {
      const project = await (prisma as any).project.findUnique({ where: { id: projectId } });
      if (!project || project.ownerId !== userId) {
        return res.status(403).json({ error: 'Not your project' });
      }
    }

    const encryptedValue = encryptSecret(value, userId);

    const secret = await (prisma as any).userSecret.create({
      data: {
        userId,
        name: name.trim(),
        encryptedValue,
        description: description?.trim() || null,
        projectId: projectId || null,
      },
    });

    const { encryptedValue: _, ...safe } = secret;
    logger.info(`Secret created: ${secret.id} by user ${userId}`);
    res.json(safe);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Secret with this name already exists' });
    }
    logger.error('Error creating secret:', error);
    res.status(500).json({ error: 'Failed to create secret' });
  }
});

/**
 * GET /api/secrets/:id
 * Get a single secret (owner only, value is never exposed)
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;

    const secret = await (prisma as any).userSecret.findUnique({
      where: { id: req.params.id },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!secret) return res.status(404).json({ error: 'Secret not found' });
    if (secret.userId !== userId) return res.status(403).json({ error: 'Not your secret' });

    return res.json({
      id: secret.id,
      name: secret.name,
      description: secret.description,
      projectId: secret.projectId,
      projectName: secret.project?.name || null,
      lastUsedAt: secret.lastUsedAt,
      lastUsedBy: secret.lastUsedBy,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
    });
  } catch (error) {
    logger.error('Error fetching secret by id:', error);
    return res.status(500).json({ error: 'Failed to fetch secret' });
  }
});

/**
 * PUT /api/secrets/:id
 * Update a secret (owner only)
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { name, value, description, projectId } = req.body;

    const secret = await (prisma as any).userSecret.findUnique({ where: { id: req.params.id } });
    if (!secret) return res.status(404).json({ error: 'Secret not found' });
    if (secret.userId !== userId) return res.status(403).json({ error: 'Not your secret' });

    const data: any = {};
    if (name?.trim()) data.name = name.trim();
    if (value?.trim()) data.encryptedValue = encryptSecret(value, userId);
    if (description !== undefined) data.description = description?.trim() || null;
    if (projectId !== undefined) {
      if (projectId) {
        const project = await (prisma as any).project.findUnique({ where: { id: projectId } });
        if (!project || project.ownerId !== userId) {
          return res.status(403).json({ error: 'Not your project' });
        }
      }
      data.projectId = projectId || null;
    }

    const updated = await (prisma as any).userSecret.update({
      where: { id: req.params.id },
      data,
    });

    const { encryptedValue: _, ...safe } = updated;
    res.json(safe);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Secret with this name already exists' });
    }
    logger.error('Error updating secret:', error);
    res.status(500).json({ error: 'Failed to update secret' });
  }
});

/**
 * DELETE /api/secrets/:id
 * Delete a secret (owner only)
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;

    const secret = await (prisma as any).userSecret.findUnique({ where: { id: req.params.id } });
    if (!secret) return res.status(404).json({ error: 'Secret not found' });
    if (secret.userId !== userId) return res.status(403).json({ error: 'Not your secret' });

    await (prisma as any).userSecret.delete({ where: { id: req.params.id } });
    logger.info(`Secret deleted: ${req.params.id} by user ${userId}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting secret:', error);
    res.status(500).json({ error: 'Failed to delete secret' });
  }
});

export default router;
