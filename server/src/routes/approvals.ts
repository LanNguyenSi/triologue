/**
 * /api/approvals — Human approval management for agent connector actions
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import prisma from '../lib/prisma';
import { logAuditEvent } from '../services/auditService';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/approvals
 * List approval requests (filter by status, taskId, etc.)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : undefined;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (taskId) where.taskId = taskId;

    const approvals = await (prisma as any).approvalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return res.json({ approvals });
  } catch (err) {
    logger.error('[approvals] list error:', err);
    return res.status(500).json({ error: 'Failed to list approvals' });
  }
});

/**
 * GET /api/approvals/:id
 * Get a single approval request
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const approval = await (prisma as any).approvalRequest.findUnique({
      where: { id: req.params.id },
    });
    if (!approval) return res.status(404).json({ error: 'Approval not found' });
    return res.json({ approval });
  } catch (err) {
    logger.error('[approvals] get error:', err);
    return res.status(500).json({ error: 'Failed to get approval' });
  }
});

/**
 * PATCH /api/approvals/:id/decide
 * Approve or reject an approval request
 * Body: { status: "approved" | "rejected", decisionNote?: string }
 */
router.patch('/:id/decide', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { status, decisionNote } = req.body as { status: string; decisionNote?: string };

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be "approved" or "rejected"' });
    }

    const existing = await (prisma as any).approvalRequest.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) return res.status(404).json({ error: 'Approval not found' });
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: `Approval already ${existing.status}` });
    }

    const updated = await (prisma as any).approvalRequest.update({
      where: { id: req.params.id },
      data: {
        status,
        decidedBy: userId,
        decisionNote: decisionNote ?? null,
        decidedAt: new Date(),
      },
    });

    logAuditEvent({
      agentId: userId,
      action: `approval.${status}`,
      resourceType: 'approval',
      resourceId: req.params.id,
      projectId: existing.projectId ?? undefined,
      details: {
        connectorId: existing.connectorId,
        actionId: existing.actionId,
        riskLevel: existing.riskLevel,
        decisionNote: decisionNote ?? null,
      },
      success: true,
      durationMs: 0,
    });

    return res.json({ approval: updated });
  } catch (err) {
    logger.error('[approvals] decide error:', err);
    return res.status(500).json({ error: 'Failed to decide approval' });
  }
});

export default router;
