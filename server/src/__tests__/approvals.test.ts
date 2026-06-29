/**
 * Security tests for src/routes/approvals.ts — HIGH gap coverage
 *
 * Gap documented: there is NO admin/owner authorization guard on
 * PATCH /:id/decide (line 60). Any authenticated user can decide any
 * approval request. This is a KNOWN OPEN TASK (d065de21) and must NOT
 * be guarded here. This test suite documents current behavior.
 *
 * Guards tested:
 *   1. CURRENT BEHAVIOR (d065de21): any authenticated user can decide any
 *      approval regardless of ownership — assert 200/success.
 *   2. State-transition guard (line 73): only pending approvals can be decided.
 *      A non-pending approval returns 409.
 *   3. Invalid status value → 400.
 *   4. Missing approval → 404.
 *
 * Mutation-check intent:
 *   - Break the `existing.status !== 'pending'` → 409 guard → the non-pending
 *     state test fails with something other than 409.
 */

let currentUser = {
  id: 'user-1',
  username: 'user1',
  userType: 'HUMAN',
  displayName: 'User 1',
  isAdmin: false,
};

jest.mock('../middleware/auth', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user: unknown }).user = currentUser;
    next();
  },
}));

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    approvalRequest: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../services/auditService', () => ({
  logAuditEvent: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import prisma from '../lib/prisma';
import approvalsRouter from '../routes/approvals';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/approvals', approvalsRouter);
  return app;
}

const PENDING_APPROVAL = {
  id: 'approval-1',
  status: 'pending',
  projectId: 'proj-1',
  connectorId: 'jira',
  actionId: 'create_ticket',
  riskLevel: 'medium',
  requestedBy: 'agent-1',
  decidedBy: null,
  decisionNote: null,
  decidedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const APPROVED_APPROVAL = { ...PENDING_APPROVAL, id: 'approval-2', status: 'approved' };

beforeEach(() => {
  currentUser = {
    id: 'user-1',
    username: 'user1',
    userType: 'HUMAN',
    displayName: 'User 1',
    isAdmin: false,
  };
  jest.clearAllMocks();
});

// ── 1. CURRENT BEHAVIOR — any user can decide (d065de21 open task) ──────────

describe('PATCH /api/approvals/:id/decide — CURRENT BEHAVIOR: no ownership guard (d065de21)', () => {
  // IMPORTANT: this test documents that the route currently has NO admin/owner
  // authorization check. Any authenticated user can approve or reject any
  // approval request. Do NOT add a guard here; it is tracked as task d065de21.
  // When d065de21 is implemented, this test will need to be updated.

  it('allows any authenticated user to approve an approval request (current behavior)', async () => {
    // user-1 is NOT the requestor (agent-1 created it), but no guard blocks them.
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_APPROVAL);
    const updatedApproval = {
      ...PENDING_APPROVAL,
      status: 'approved',
      decidedBy: 'user-1',
      decidedAt: new Date(),
    };
    (prisma.approvalRequest.update as jest.Mock).mockResolvedValue(updatedApproval);
    const app = buildApp();

    const res = await request(app)
      .patch('/api/approvals/approval-1/decide')
      .send({ status: 'approved' });

    // Current behavior: 200 (no ownership check).
    expect(res.status).toBe(200);
    expect(res.body.approval.status).toBe('approved');
  });

  it('allows any authenticated user to reject an approval request (current behavior)', async () => {
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_APPROVAL);
    (prisma.approvalRequest.update as jest.Mock).mockResolvedValue({
      ...PENDING_APPROVAL,
      status: 'rejected',
      decidedBy: 'user-1',
    });
    const app = buildApp();

    const res = await request(app)
      .patch('/api/approvals/approval-1/decide')
      .send({ status: 'rejected', decisionNote: 'not safe' });

    expect(res.status).toBe(200);
    expect(res.body.approval.status).toBe('rejected');
  });
});

// ── 2. State-transition guard: only pending can be decided ───────────────────

describe('PATCH /api/approvals/:id/decide — state-transition guard', () => {
  it('returns 409 when the approval is already approved (non-pending state)', async () => {
    // Mutation target: remove the `existing.status !== 'pending'` guard →
    // the already-approved approval would be decided again, returning 200.
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(APPROVED_APPROVAL);
    const app = buildApp();

    const res = await request(app)
      .patch('/api/approvals/approval-2/decide')
      .send({ status: 'rejected' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already approved/i);
    // Update must NOT have been called when state check blocks it.
    expect(prisma.approvalRequest.update as jest.Mock).not.toHaveBeenCalled();
  });

  it('returns 409 when the approval is already rejected (non-pending state)', async () => {
    const rejectedApproval = { ...PENDING_APPROVAL, id: 'approval-3', status: 'rejected' };
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(rejectedApproval);
    const app = buildApp();

    const res = await request(app)
      .patch('/api/approvals/approval-3/decide')
      .send({ status: 'approved' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already rejected/i);
  });
});

// ── 3. Invalid status value ───────────────────────────────────────────────

describe('PATCH /api/approvals/:id/decide — invalid status', () => {
  it('returns 400 for an invalid status value', async () => {
    const app = buildApp();

    const res = await request(app)
      .patch('/api/approvals/approval-1/decide')
      .send({ status: 'maybe' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approved.*rejected/i);
  });
});

// ── 4. Missing approval ───────────────────────────────────────────────────

describe('PATCH /api/approvals/:id/decide — not found', () => {
  it('returns 404 when the approval does not exist', async () => {
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app)
      .patch('/api/approvals/nonexistent/decide')
      .send({ status: 'approved' });

    expect(res.status).toBe(404);
  });
});
