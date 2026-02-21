/**
 * /api/secrets — User-level secrets (standalone, optionally linked to a project)
 */
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { encryptSecret, decryptSecret } from '../utils/encryption';
import { logger } from '../utils/logger';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/secrets
 * List all secrets for the authenticated user (no values exposed)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const secrets = await (prisma as any).userSecret.findMany({
      where: { userId: (req as any).user.id },
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { id: true, name: true } } },
    });

    const safe = secrets.map((s: any) => ({
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

    res.json(safe);
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
