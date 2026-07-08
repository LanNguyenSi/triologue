/**
 * Regression tests for the approval rows created by the connector proxy
 * (src/connectors/proxy.ts), guarding the contract that approvals.ts relies on.
 *
 * approvals.ts derives WHO may decide an approval from its `projectId`
 * (project owner / team member, else admin-only). Two bugs live here:
 *
 *   1. The proxy used to create approvals without a projectId, silently
 *      degrading every real approval to admin-only and locking out the project
 *      members the request is routed to.
 *   2. `taskId` is caller-supplied and ApprovalRequest.taskId has no foreign
 *      key, so an unauthorized id could steer both the derived projectId (who
 *      may decide) and the room notification into a foreign project. The task
 *      is therefore resolved AND authorized before anything derives trust
 *      from it.
 *
 * Pinned contract:
 *   - authorized taskId → projectId resolved from the task and persisted,
 *     notification posted into that project's room
 *   - unauthorized taskId → 403, no approval row
 *   - unknown taskId → 404, no approval row
 *   - no taskId → projectId omitted (unscoped, admin-only by design)
 *
 * Mutation-check intent: dropping `projectId` from the create, dropping the
 * `project.roomId` select, or removing the access check each turn a test red.
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
    roomParticipant: { findMany: jest.fn(), findUnique: jest.fn() },
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
import { createInboxItems } from '../services/inboxService';
import { connectorRoutes } from '../connectors/proxy';

const prismaMock = prisma as unknown as {
  agentToken: { findUnique: jest.Mock };
  connectorPermission: { findUnique: jest.Mock };
  approvalRequest: { findFirst: jest.Mock; create: jest.Mock };
  task: { findUnique: jest.Mock };
  message: { create: jest.Mock };
  room: { update: jest.Mock };
  roomParticipant: { findMany: jest.Mock; findUnique: jest.Mock };
};
const getEnabledConnectorMock = getEnabledConnector as jest.Mock;
const createInboxItemsMock = createInboxItems as jest.Mock;

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
  prismaMock.roomParticipant.findMany.mockResolvedValue([]);
  prismaMock.roomParticipant.findUnique.mockResolvedValue(null);
  prismaMock.message.create.mockResolvedValue({ id: 'msg-1' });
  prismaMock.room.update.mockResolvedValue({});
});

/** An authorized task: the requesting agent is its assignee. */
const authorizedTask = (over: Record<string, unknown> = {}) => ({
  id: 'task-1',
  createdBy: 'human-1',
  assignedTo: AGENT_USER_ID,
  projectId: 'proj-42',
  project: { roomId: null },
  ...over,
});

const post = (body: Record<string, unknown>) =>
  request(app)
    .post('/api/connectors/github/actions/create-pr')
    .set('Authorization', `Bearer ${TOKEN}`)
    .send(body);

describe('connector proxy: approval creation carries the owning projectId', () => {
  it('persists the projectId resolved from the task, so project members can decide', async () => {
    prismaMock.task.findUnique.mockResolvedValue(authorizedTask());

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

  it('rejects an unknown taskId with 404 and creates no approval', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);

    const res = await post({ taskId: 'ghost-task' });

    expect(res.status).toBe(404);
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it('rejects a foreign taskId with 403, so an approval cannot be routed into another project', async () => {
    // Task of a project the agent is neither assigned to nor a room member of.
    prismaMock.task.findUnique.mockResolvedValue(
      authorizedTask({
        assignedTo: 'someone-else',
        projectId: 'victim-project',
        project: { roomId: 'victim-room' },
      }),
    );
    prismaMock.roomParticipant.findUnique.mockResolvedValue(null);

    const res = await post({ taskId: 'foreign-task', approvalReason: 'pwn' });

    expect(res.status).toBe(403);
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it('accepts a task the agent reaches via room membership', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      authorizedTask({ assignedTo: 'someone-else', project: { roomId: 'room-1' } }),
    );
    prismaMock.roomParticipant.findUnique.mockResolvedValue({ userId: AGENT_USER_ID });

    const res = await post({ taskId: 'task-1' });

    expect(res.status).toBe(202);
    expect(prismaMock.approvalRequest.create.mock.calls[0][0].data.projectId).toBe('proj-42');
  });

  it('notifies the project room of the authorized task', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      authorizedTask({ project: { roomId: 'room-1' } }),
    );
    prismaMock.roomParticipant.findMany.mockResolvedValue([{ userId: 'human-1' }]);

    const res = await post({ taskId: 'task-1', approvalReason: 'needs review' });

    expect(res.status).toBe(202);
    expect(prismaMock.message.create).toHaveBeenCalledTimes(1);
    const msgArg = prismaMock.message.create.mock.calls[0][0];
    expect(msgArg.data.roomId).toBe('room-1');
    expect(msgArg.data.messageType).toBe('SYSTEM');
    expect(prismaMock.room.update).toHaveBeenCalledTimes(1);
    expect(createInboxItemsMock).toHaveBeenCalledTimes(1);
    expect(createInboxItemsMock.mock.calls[0][0].recipientIds).toEqual(['human-1']);
  });

  it('queries the task exactly once for authorization, projectId and the notification', async () => {
    prismaMock.task.findUnique.mockResolvedValue(
      authorizedTask({ project: { roomId: 'room-1' } }),
    );

    await post({ taskId: 'task-1' });

    expect(prismaMock.task.findUnique).toHaveBeenCalledTimes(1);
  });
});
