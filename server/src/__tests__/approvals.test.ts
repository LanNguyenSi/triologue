/**
 * Security tests for src/routes/approvals.ts (d065de21)
 *
 * Fixes the broken-access-control gap: previously `authenticate` alone
 * guarded every route, so ANY authenticated caller — including the
 * requesting agent's own token — could decide any approval. This suite
 * covers the new authz model documented at the top of approvals.ts:
 *
 *   - GET /, GET /:id            → requireHuman
 *   - PATCH /:id/decide          → requireHuman AND (isAdmin OR
 *     project owner/team-member when projectId is set; admin-only when
 *     projectId is null)
 *   - Entitlement (403) is checked BEFORE the pending-state (409) check,
 *     so a non-entitled caller can't probe approval state via status code.
 *
 * Mutation-check intent: commenting out the `canDecideApproval` guard (the
 * `if (!allowed) return res.status(403)...` block) should turn every 403
 * assertion below into a 200/409, so those tests fail.
 */

let currentUser: {
  id: string;
  username: string;
  userType: string;
  displayName: string;
  isAdmin: boolean;
};

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
      (req as { user: unknown }).user = currentUser;
      next();
    },
  };
});

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    approvalRequest: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    project: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
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
import { logAuditEvent } from '../services/auditService';
import approvalsRouter from '../routes/approvals';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/approvals', approvalsRouter);
  return app;
}

const ADMIN_HUMAN = {
  id: 'user-admin',
  username: 'admin',
  userType: 'HUMAN',
  displayName: 'Admin',
  isAdmin: true,
};
const OWNER_HUMAN = {
  id: 'user-owner',
  username: 'owner',
  userType: 'HUMAN',
  displayName: 'Owner',
  isAdmin: false,
};
const TEAM_MEMBER_HUMAN = {
  id: 'user-team1',
  username: 'team1',
  userType: 'HUMAN',
  displayName: 'Team Member',
  isAdmin: false,
};
const UNRELATED_HUMAN = {
  id: 'user-other',
  username: 'other',
  userType: 'HUMAN',
  displayName: 'Unrelated',
  isAdmin: false,
};
// The requesting agent's own token — also admin-flagged, to prove requireHuman
// (not the isAdmin check) is what blocks self-approval.
const REQUESTER_AGENT = {
  id: 'agent-1',
  username: 'agent-1',
  userType: 'AI_AGENT',
  displayName: 'Agent',
  isAdmin: true,
};

const PROJECT = { ownerId: 'user-owner', teamMemberIds: ['user-team1'] };

const PENDING_SCOPED = {
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

const APPROVED_SCOPED = { ...PENDING_SCOPED, id: 'approval-2', status: 'approved' };

const PENDING_UNSCOPED = { ...PENDING_SCOPED, id: 'approval-3', projectId: null };

beforeEach(() => {
  currentUser = ADMIN_HUMAN;
  jest.clearAllMocks();
  (prisma.project.findUnique as jest.Mock).mockResolvedValue(PROJECT);
});

function decide(id: string, body: Record<string, unknown> = { status: 'approved' }) {
  return request(buildApp()).patch(`/api/approvals/${id}/decide`).send(body);
}

// ── Entitled humans → 200 ────────────────────────────────────────────────

describe('PATCH /:id/decide — entitled humans', () => {
  it('admin human can decide (200), decision persisted', async () => {
    currentUser = ADMIN_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_SCOPED);
    (prisma.approvalRequest.update as jest.Mock).mockResolvedValue({
      ...PENDING_SCOPED,
      status: 'approved',
      decidedBy: ADMIN_HUMAN.id,
    });

    const res = await decide('approval-1', { status: 'approved', decisionNote: 'ok' });

    expect(res.status).toBe(200);
    expect(res.body.approval.status).toBe('approved');
    expect(prisma.approvalRequest.update).toHaveBeenCalledWith({
      where: { id: 'approval-1' },
      data: {
        status: 'approved',
        decidedBy: ADMIN_HUMAN.id,
        decisionNote: 'ok',
        decidedAt: expect.any(Date),
      },
    });
  });

  it('project owner (non-admin) can decide (200)', async () => {
    currentUser = OWNER_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_SCOPED);
    (prisma.approvalRequest.update as jest.Mock).mockResolvedValue({
      ...PENDING_SCOPED,
      status: 'approved',
      decidedBy: OWNER_HUMAN.id,
    });

    const res = await decide('approval-1');

    expect(res.status).toBe(200);
    expect(prisma.approvalRequest.update).toHaveBeenCalled();
  });

  it('project team member can decide (200)', async () => {
    currentUser = TEAM_MEMBER_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_SCOPED);
    (prisma.approvalRequest.update as jest.Mock).mockResolvedValue({
      ...PENDING_SCOPED,
      status: 'rejected',
      decidedBy: TEAM_MEMBER_HUMAN.id,
    });

    const res = await decide('approval-1', { status: 'rejected' });

    expect(res.status).toBe(200);
    expect(prisma.approvalRequest.update).toHaveBeenCalled();
  });
});

// ── Non-entitled → 403, no mutation ──────────────────────────────────────

describe('PATCH /:id/decide — non-entitled callers', () => {
  it('unrelated human (not admin/owner/member) → 403, update NOT called', async () => {
    currentUser = UNRELATED_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_SCOPED);

    const res = await decide('approval-1');

    expect(res.status).toBe(403);
    expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, action: 'approval.decide.denied' }),
    );
  });

  it('agent token (admin-flagged) → 403, blocked by requireHuman regardless of isAdmin', async () => {
    currentUser = REQUESTER_AGENT;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_SCOPED);

    const res = await decide('approval-1');

    expect(res.status).toBe(403);
    expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
  });

  it('the requesting agent itself cannot self-approve (403)', async () => {
    // REQUESTER_AGENT.id === PENDING_SCOPED.requestedBy — proves self-approval
    // is blocked purely because the caller is not HUMAN, not by ownership.
    expect(REQUESTER_AGENT.id).toBe(PENDING_SCOPED.requestedBy);
    currentUser = REQUESTER_AGENT;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_SCOPED);

    const res = await decide('approval-1');

    expect(res.status).toBe(403);
    expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
  });
});

// ── projectId === null → admin-only ──────────────────────────────────────

describe('PATCH /:id/decide — unscoped approval (projectId null)', () => {
  it('admin can decide (200)', async () => {
    currentUser = ADMIN_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_UNSCOPED);
    (prisma.approvalRequest.update as jest.Mock).mockResolvedValue({
      ...PENDING_UNSCOPED,
      status: 'approved',
    });

    const res = await decide('approval-3');

    expect(res.status).toBe(200);
  });

  it('non-admin human (even the would-be project owner) → 403', async () => {
    currentUser = OWNER_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_UNSCOPED);

    const res = await decide('approval-3');

    expect(res.status).toBe(403);
    expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
    // No project to check membership against — must not even query one.
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });
});

// ── Ordering: 403 before 409 ──────────────────────────────────────────────

describe('PATCH /:id/decide — entitlement checked before state (403 not 409)', () => {
  it('a non-entitled caller gets 403 even on an already-decided approval', async () => {
    currentUser = UNRELATED_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(APPROVED_SCOPED);

    const res = await decide('approval-2');

    expect(res.status).toBe(403);
    expect(res.status).not.toBe(409);
  });

  it('an entitled caller still gets 409 on an already-decided approval', async () => {
    currentUser = ADMIN_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(APPROVED_SCOPED);

    const res = await decide('approval-2');

    expect(res.status).toBe(409);
  });
});

// ── Pre-existing behavior retained ────────────────────────────────────────

describe('PATCH /:id/decide — pre-existing validation', () => {
  it('returns 400 for an invalid status value', async () => {
    currentUser = ADMIN_HUMAN;
    const res = await decide('approval-1', { status: 'maybe' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approved.*rejected/i);
  });

  it('returns 404 when the approval does not exist', async () => {
    currentUser = ADMIN_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await decide('nonexistent');

    expect(res.status).toBe(404);
  });
});

// ── GET / and GET /:id → requireHuman ──────────────────────────────────────

describe('GET /api/approvals and GET /api/approvals/:id — requireHuman', () => {
  it('GET / allows a human (200)', async () => {
    currentUser = ADMIN_HUMAN;
    (prisma.approvalRequest.findMany as jest.Mock).mockResolvedValue([PENDING_SCOPED]);

    const res = await request(buildApp()).get('/api/approvals');

    expect(res.status).toBe(200);
    expect(res.body.approvals).toHaveLength(1);
  });

  it('GET / rejects an agent token (403)', async () => {
    currentUser = REQUESTER_AGENT;

    const res = await request(buildApp()).get('/api/approvals');

    expect(res.status).toBe(403);
    expect(prisma.approvalRequest.findMany).not.toHaveBeenCalled();
  });

  it('GET /:id allows a human (200)', async () => {
    currentUser = ADMIN_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_SCOPED);

    const res = await request(buildApp()).get('/api/approvals/approval-1');

    expect(res.status).toBe(200);
  });

  it('GET /:id rejects an agent token (403)', async () => {
    currentUser = REQUESTER_AGENT;

    const res = await request(buildApp()).get('/api/approvals/approval-1');

    expect(res.status).toBe(403);
    expect(prisma.approvalRequest.findUnique).not.toHaveBeenCalled();
  });
});

// ── Project scoping on the read surface (946fa940) ──────────────────────
//
// Mutation-check intent: removing the `if (!user.isAdmin)` projectId
// constraint in GET / must fail the list tests below; removing the
// canDecideApproval guard in GET /:id must turn the 403 tests into 200s.

describe('GET /api/approvals — project scoping (946fa940)', () => {
  it('admin sees everything: no project lookup, no projectId constraint', async () => {
    currentUser = ADMIN_HUMAN;
    (prisma.approvalRequest.findMany as jest.Mock).mockResolvedValue([PENDING_SCOPED]);

    const res = await request(buildApp()).get('/api/approvals');

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).not.toHaveBeenCalled();
    const where = (prisma.approvalRequest.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.projectId).toBeUndefined();
  });

  it("non-admin list is constrained to the caller's projects", async () => {
    currentUser = OWNER_HUMAN;
    (prisma.project.findMany as jest.Mock).mockResolvedValue([{ id: 'proj-1' }]);
    (prisma.approvalRequest.findMany as jest.Mock).mockResolvedValue([PENDING_SCOPED]);

    const res = await request(buildApp()).get('/api/approvals');

    expect(res.status).toBe(200);
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { OR: [{ ownerId: 'user-owner' }, { teamMemberIds: { has: 'user-owner' } }] },
      select: { id: true },
    });
    const where = (prisma.approvalRequest.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.projectId).toEqual({ in: ['proj-1'] });
  });

  it('a human with no projects gets an empty-set constraint (sees nothing, incl. unscoped approvals)', async () => {
    currentUser = UNRELATED_HUMAN;
    (prisma.project.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.approvalRequest.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(buildApp()).get('/api/approvals');

    expect(res.status).toBe(200);
    const where = (prisma.approvalRequest.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.projectId).toEqual({ in: [] });
    expect(res.body.approvals).toEqual([]);
  });
});

describe('GET /api/approvals/:id — decide-entitlement on read (946fa940)', () => {
  it('project owner (non-admin) can read a scoped approval (200)', async () => {
    currentUser = OWNER_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_SCOPED);

    const res = await request(buildApp()).get('/api/approvals/approval-1');

    expect(res.status).toBe(200);
    expect(res.body.approval.id).toBe('approval-1');
  });

  it('unrelated human → 403, approval body not returned', async () => {
    currentUser = UNRELATED_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_SCOPED);

    const res = await request(buildApp()).get('/api/approvals/approval-1');

    expect(res.status).toBe(403);
    expect(res.body.approval).toBeUndefined();
  });

  it('unscoped approval (projectId null) is admin-only on read: non-admin → 403', async () => {
    currentUser = OWNER_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(PENDING_UNSCOPED);

    const res = await request(buildApp()).get('/api/approvals/approval-3');

    expect(res.status).toBe(403);
  });

  it('missing approval stays 404 (ids are unguessable cuids; ordering leaks nothing)', async () => {
    currentUser = UNRELATED_HUMAN;
    (prisma.approvalRequest.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await request(buildApp()).get('/api/approvals/missing');

    expect(res.status).toBe(404);
  });
});
