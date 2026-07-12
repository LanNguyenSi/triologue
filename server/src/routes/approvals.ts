/**
 * /api/approvals — Human approval management for agent connector actions
 *
 * Authorization model (d065de21 — closes a broken-access-control gap where
 * `authenticate` alone let ANY authenticated caller, including the requesting
 * agent's own token, decide any approval):
 *
 *   - GET  /            list approvals    → requireHuman AND project
 *     scoping (946fa940): admins see everything; every other human only
 *     sees approvals belonging to projects they own or are a team member
 *     of. Unscoped approvals (projectId === null) are admin-only, matching
 *     the decide entitlement. Without this, any authenticated human could
 *     read every project's approvals including actionInput. The only known
 *     consumer is the browser client (ApprovalsPage, usePendingApprovals
 *     badge poll); no server-side agent/connector/MCP flow reads this list
 *     (verified: `approvalRequest.findMany` has no callers outside this
 *     file). Approval rows are only ever written by
 *     connectors/proxy.ts's `POST /:connectorId/actions/:actionId` handler,
 *     which never reads them back.
 *   - GET  /:id         get one approval  → requireHuman AND the same
 *     entitlement as decide (canDecideApproval); no agent-facing
 *     poll-for-status flow exists anywhere in the codebase today, so this
 *     is human-only rather than requester-scoped. 404 stays first — ids
 *     are unguessable cuids, so this ordering leaks nothing meaningful.
 *   - PATCH /:id/decide → requireHuman AND entitlement: req.user.isAdmin,
 *     OR (when the approval's projectId is set) the user is that project's
 *     ownerId or listed in its teamMemberIds. Approvals with
 *     projectId === null are admin-only (no project to derive membership
 *     from). requireHuman alone already rejects every agent token
 *     (userType !== 'HUMAN'), including the requesting agent trying to
 *     approve its own request.
 *
 * Ordering on decide: the 403 entitlement check runs BEFORE the 409
 * pending-state check, so a non-entitled caller cannot use the response
 * code to probe whether a given approval id is still pending. The 404
 * (approval not found) check stays first — ids are unguessable cuids, so
 * this ordering leaks nothing meaningful.
 */
import { Router } from 'express';
import { authenticate, requireHuman } from '../middleware/auth';
import prisma from '../lib/prisma';
import { logAuditEvent } from '../services/auditService';
import { logger } from '../utils/logger';

const router = Router();

interface DecideUser {
  id: string;
  isAdmin?: boolean;
}

interface DecidableApproval {
  projectId: string | null;
}

/**
 * Can this human user decide (approve/reject) this approval request?
 * Loads the project only when the approval is scoped to one and the user
 * isn't already an admin.
 */
export async function canDecideApproval(
  user: DecideUser,
  approval: DecidableApproval,
): Promise<boolean> {
  if (user.isAdmin) return true;
  if (!approval.projectId) return false; // unscoped approvals are admin-only

  const project = await prisma.project.findUnique({
    where: { id: approval.projectId },
    select: { ownerId: true, teamMemberIds: true },
  });
  if (!project) return false;

  return project.ownerId === user.id || project.teamMemberIds.includes(user.id);
}

/**
 * GET /api/approvals
 * List approval requests (filter by status, taskId, etc.)
 */
router.get('/', authenticate, requireHuman, async (req, res) => {
  try {
    const user = req.user!;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : undefined;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (taskId) where.taskId = taskId;

    // Project scoping (946fa940): non-admin humans only see approvals of
    // projects they own or belong to; unscoped approvals (projectId null)
    // stay admin-only, matching the decide entitlement.
    if (!user.isAdmin) {
      const projects = await prisma.project.findMany({
        where: { OR: [{ ownerId: user.id }, { teamMemberIds: { has: user.id } }] },
        select: { id: true },
      });
      where.projectId = { in: projects.map((p) => p.id) };
    }

    const approvals = await prisma.approvalRequest.findMany({
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
router.get('/:id', authenticate, requireHuman, async (req, res) => {
  try {
    const approval = await prisma.approvalRequest.findUnique({
      where: { id: req.params.id },
    });
    if (!approval) return res.status(404).json({ error: 'Approval not found' });
    // Same entitlement as decide (946fa940): a human who could not decide
    // this approval must not read it (it carries actionInput).
    const allowed = await canDecideApproval(req.user!, approval);
    if (!allowed) {
      return res.status(403).json({ error: 'Not authorized to view this approval' });
    }
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
router.patch('/:id/decide', authenticate, requireHuman, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { status, decisionNote } = req.body as { status: string; decisionNote?: string };

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be "approved" or "rejected"' });
    }

    const existing = await prisma.approvalRequest.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) return res.status(404).json({ error: 'Approval not found' });

    // Entitlement check BEFORE the pending-state check (see file-level
    // comment): a non-entitled caller must not learn an approval's state.
    const allowed = await canDecideApproval(req.user!, existing);
    if (!allowed) {
      logAuditEvent({
        agentId: userId,
        action: `approval.decide.denied`,
        resourceType: 'approval',
        resourceId: req.params.id,
        projectId: existing.projectId ?? undefined,
        details: {
          connectorId: existing.connectorId,
          actionId: existing.actionId,
          attemptedStatus: status,
        },
        success: false,
        durationMs: 0,
      });
      return res.status(403).json({ error: 'Not authorized to decide this approval' });
    }

    if (existing.status !== 'pending') {
      return res.status(409).json({ error: `Approval already ${existing.status}` });
    }

    const updated = await prisma.approvalRequest.update({
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
