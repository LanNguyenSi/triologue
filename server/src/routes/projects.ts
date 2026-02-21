import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';
import { encryptSecret, decryptSecret } from '../utils/encryption';

const router = Router();
const prisma = new PrismaClient();

/**
 * POST /api/projects
 * Create new project
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

    const project = await (prisma as any).project.create({
      data: {
        name: name.trim(),
        description,
        ownerId: req.user!.id,
        teamMemberIds: [req.user!.id],
      },
    });

    logger.info(`Project created: ${project.id} by ${req.user!.id}`);
    res.json(project);
  } catch (error) {
    logger.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

/**
 * GET /api/projects/:id
 * Get project with tasks
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
      include: { tasks: { orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] } },
    });

    if (!project) return res.status(404).json({ error: 'Not found' });

    const userId = req.user!.id;
    if (project.ownerId !== userId && !project.teamMemberIds.includes(userId)) {
      return res.status(403).json({ error: 'No access' });
    }

    res.json(project);
  } catch (error) {
    logger.error('Error fetching project:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

/**
 * PATCH /api/projects/:id
 * Update project (owner only)
 */
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return res.status(404).json({ error: 'Not found' });
    if (project.ownerId !== req.user!.id) return res.status(403).json({ error: 'Owner only' });

    const updated = await (prisma as any).project.update({
      where: { id: req.params.id },
      data: {
        ...(req.body.name && { name: req.body.name.trim() }),
        ...(req.body.description !== undefined && { description: req.body.description }),
        ...(req.body.status && { status: req.body.status }),
      },
    });

    logger.info(`Project updated: ${req.params.id}`);
    res.json(updated);
  } catch (error) {
    logger.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

/**
 * POST /api/projects/:id/team
 * Add team member (owner only)
 */
router.post('/:id/team', authenticate, async (req, res) => {
  try {
    const { userId } = req.body;
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return res.status(404).json({ error: 'Not found' });
    if (project.ownerId !== req.user!.id) return res.status(403).json({ error: 'Owner only' });

    const updated = await (prisma as any).project.update({
      where: { id: req.params.id },
      data: {
        teamMemberIds: {
          push: userId,
        },
      },
    });

    logger.info(`User ${userId} added to project ${req.params.id}`);
    res.json(updated);
  } catch (error) {
    logger.error('Error adding team member:', error);
    res.status(500).json({ error: 'Failed to add team member' });
  }
});

/**
 * POST /api/projects/:id/tasks
 * Create task
 */
router.post('/:id/tasks', authenticate, async (req, res) => {
  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return res.status(404).json({ error: 'Not found' });

    const userId = req.user!.id;
    if (project.ownerId !== userId && !project.teamMemberIds.includes(userId)) {
      return res.status(403).json({ error: 'No access' });
    }

    const task = await (prisma as any).task.create({
      data: {
        projectId: req.params.id,
        title: req.body.title,
        ...(req.body.description && { description: req.body.description }),
        ...(req.body.status && { status: req.body.status }),
        ...(req.body.assignedTo && { assignedTo: req.body.assignedTo }),
        ...(req.body.priority && { priority: req.body.priority }),
        ...(req.body.dueDate && { dueDate: new Date(req.body.dueDate) }),
      },
    });

    logger.info(`Task created: ${task.id} in project ${req.params.id}`);
    res.json(task);
  } catch (error) {
    logger.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

/**
 * PATCH /api/tasks/:id
 * Update task
 */
router.patch('/tasks/:id', authenticate, async (req, res) => {
  try {
    const task = await (prisma as any).task.findUnique({
      where: { id: req.params.id },
      include: { project: true },
    });

    if (!task) return res.status(404).json({ error: 'Not found' });

    const userId = req.user!.id;
    const project = task.project;
    if (project.ownerId !== userId && !project.teamMemberIds.includes(userId)) {
      return res.status(403).json({ error: 'No access' });
    }

    const updated = await (prisma as any).task.update({
      where: { id: req.params.id },
      data: {
        ...(req.body.title && { title: req.body.title }),
        ...(req.body.status && { status: req.body.status }),
        ...(req.body.assignedTo !== undefined && { assignedTo: req.body.assignedTo }),
        ...(req.body.priority && { priority: req.body.priority }),
      },
    });

    logger.info(`Task updated: ${req.params.id}`);
    res.json(updated);
  } catch (error) {
    logger.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

/**
 * POST /api/projects/:id/secrets
 * Create secret (owner only)
 */
router.post('/:id/secrets', authenticate, async (req, res) => {
  try {
    const { name, value, permissions } = req.body;
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return res.status(404).json({ error: 'Not found' });
    if (project.ownerId !== req.user!.id) return res.status(403).json({ error: 'Owner only' });

    const encryptedValue = encryptSecret(value, req.params.id);

    const secret = await (prisma as any).projectSecret.create({
      data: {
        projectId: req.params.id,
        name,
        encryptedValue,
        createdBy: req.user!.id,
        permissions: permissions || {},
      },
    });

    const { encryptedValue: _, ...safeSecret } = secret;
    logger.info(`Secret created: ${secret.id} in project ${req.params.id}`);
    res.json(safeSecret);
  } catch (error) {
    logger.error('Error creating secret:', error);
    res.status(500).json({ error: 'Failed to create secret' });
  }
});

/**
 * GET /api/projects/:id/secrets
 * List secrets (no values)
 */
router.get('/:id/secrets', authenticate, async (req, res) => {
  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return res.status(404).json({ error: 'Not found' });

    const userId = req.user!.id;
    if (project.ownerId !== userId && !project.teamMemberIds.includes(userId)) {
      return res.status(403).json({ error: 'No access' });
    }

    const secrets = await (prisma as any).projectSecret.findMany({
      where: { projectId: req.params.id },
    });

    const safeSecrets = secrets.map((s: any) => ({
      id: s.id,
      name: s.name,
      createdBy: s.createdBy,
      lastUsedAt: s.lastUsedAt,
      lastUsedBy: s.lastUsedBy,
      permissions: s.permissions,
    }));

    res.json(safeSecrets);
  } catch (error) {
    logger.error('Error fetching secrets:', error);
    res.status(500).json({ error: 'Failed to fetch secrets' });
  }
});

export const projectRoutes = router;
