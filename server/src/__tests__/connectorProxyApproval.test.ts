/**
 * Regression tests for the approval rows created by the connector proxy
 * (src/connectors/proxy.ts), guarding the contract that approvals.ts relies on.
 *
 * approvals.ts derives WHO may decide an approval from its `projectId`
 * (project owner / team member, else admin-only). The proxy used to create
 * approvals without a projectId, which silently degraded every real approval
 * to admin-only and locked out the project members the request is routed to.
 * These tests pin the creation contract:
 *
 *   - taskId given   → projectId resolved from the task and persisted
 *   - no taskId      → projectId omitted (unscoped, admin-only by design)
 *
 * Mutation-check intent: dropping `projectId` from the `approvalRequest.create`
 * data in proxy.ts turns the first test's assertion red.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    agentToken: { findUnique: jest.fn() },
    connectorPermission: { findUnique: jest.fn() },
    approvalRequest: { findFirst: jest.fn(), create: jest.fn() },
    task: { findUnique: jest.fn() },
    message: { create: jest.fn() },
    room: { update: jest.fn() },
    roomParticipant: { findMany: jest.fn() },
  },
}));

jest.mock('../connectors/registry', () => ({
  getEnabledConnector: jest.fn(),
}));

jest.mock('../services/tokenManager', () => ({ resolveToken: jest.fn() }));
jest.mock('../services/auditService', () => ({ logAuditEvent: jest.fn() }));
jest.mock('../services/inboxService', () => ({ createInboxItems: jest.fn() }));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import prisma from '../lib/prisma';
import { getEnabledConnector } from '../connectors/registry';
import { connectorRoutes } from '../connectors/proxy';

const prismaMock = prisma as unknown as {
  agentToken: { findUnique: jest.Mock };
  connectorPermission: { findUnique: jest.Mock };
  approvalRequest: { findFirst: jest.Mock; create: jest.Mock };
  task: { findUnique: jest.Mock };
  message: { create: jest.Mock };
  room: { update: jest.Mock };
  roomParticipant: { findMany: jest.Mock };
};
const getEnabledConnectorMock = getEnabledConnector as jest.Mock;

const app = express();
app.use(express.json());
app.use('/api/connectors', connectorRoutes);

const AGENT_USER_ID = 'agent-user-1';
const TOKEN = 'byoa_test-token';

beforeEach(() => {
  jest.clearAllMocks();

  prismaMock.agentToken.findUnique.mockResolvedValue({
    userId: AGENT_USER_ID,
    isActive: true,
    status: 'active',
  });
  getEnabledConnectorMock.mockReturnValue({
    id: 'github',
    actions: [{ id: 'create-pr', requiresApproval: true, riskLevel: 'high' }],
  });
  prismaMock.connectorPermission.findUnique.mockResolvedValue({
    connectorId: 'github',
    userId: AGENT_USER_ID,
    allowedActions: [],
  });
  // No prior approved request → a new pending approval is created.
  prismaMock.approvalRequest.findFirst.mockResolvedValue(null);
  prismaMock.approvalRequest.create.mockResolvedValue({
    id: 'approval-1',
    reason: 'needs review',
  });
  // Notification path: no room → the notify block short-circuits harmlessly.
  prismaMock.roomParticipant.findMany.mockResolvedValue([]);
});

const post = (body: Record<string, unknown>) =>
  request(app)
    .post('/api/connectors/github/actions/create-pr')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send(body);

describe('connector proxy: approval creation carries the owning projectId', () => {
  it('persists the projectId resolved from the task, so project members can decide', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      projectId: 'proj-42',
      project: { roomId: null },
    });

    const res = await post({ taskId: 'task-1', approvalReason: 'needs review' });

    expect(res.status).toBe(202);
    expect(prismaMock.approvalRequest.create).toHaveBeenCalledTimes(1);
    const createArg = prismaMock.approvalRequest.create.mock.calls[0][0];
    expect(createArg.data.projectId).toBe('proj-42');
    expect(createArg.data.taskId).toBe('task-1');
    expect(createArg.data.status).toBe('pending');
  });

  it('leaves projectId unset when the action carries no task (unscoped → admin-only)', async () => {
    const res = await post({ approvalReason: 'no task context' });

    expect(res.status).toBe(202);
    expect(prismaMock.task.findUnique).not.toHaveBeenCalled();
    const createArg = prismaMock.approvalRequest.create.mock.calls[0][0];
    expect(createArg.data.projectId).toBeUndefined();
  });

  it('still creates the approval when the task lookup finds nothing', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);

    const res = await post({ taskId: 'ghost-task' });

    expect(res.status).toBe(202);
    const createArg = prismaMock.approvalRequest.create.mock.calls[0][0];
    expect(createArg.data.projectId).toBeUndefined();
  });

  it('queries the task exactly once, reusing it for projectId and the room notification', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      projectId: 'proj-42',
      project: { roomId: null },
    });

    await post({ taskId: 'task-1' });

    expect(prismaMock.task.findUnique).toHaveBeenCalledTimes(1);
  });
});
