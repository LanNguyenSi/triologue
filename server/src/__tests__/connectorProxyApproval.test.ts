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
 *
 * The second half pins the approval reuse contract: an approved row is reused
 * for 24 h, but only for an input identical to the approved one (canonical
 * hash, matched in the query itself) and never for a row without a hash.
 * It runs against a small in-memory stand-in for `approvalRequest` that
 * evaluates the `where` the proxy sends, so a query that loses the hash
 * condition lets the wrong input through and turns the test red.
 */
import express from 'express';
import request from './helpers/loopbackRequest';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    agentToken: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
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
import { resolveToken } from '../services/tokenManager';
import { logAuditEvent } from '../services/auditService';
import { hashActionInput } from '../connectors/inputHash';
import { connectorRoutes } from '../connectors/proxy';

const prismaMock = prisma as unknown as {
  agentToken: { findUnique: jest.Mock; findFirst: jest.Mock };
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

// ── Approval reuse is bound to the approved input ───────────────────────────

type StoredApproval = {
  id: string;
  requestedBy: string | null;
  connectorId: string;
  actionId: string;
  taskId: string | null;
  status: string;
  createdAt: Date;
  inputHash: string | null | undefined;
};

/** Evaluates the subset of Prisma `where` syntax the proxy uses. */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') {
      return (cond as Record<string, unknown>[]).some((w) => matchesWhere(row, w));
    }
    const value = row[key] === undefined ? null : row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { gte?: Date; in?: unknown[] };
      if (c.gte !== undefined) return value instanceof Date && value >= c.gte;
      if (c.in !== undefined) return c.in.includes(value);
      throw new Error(`matchesWhere: unsupported condition on ${key}`);
    }
    return value === cond;
  });
}

const HOUR = 60 * 60 * 1000;
const DELETE_URL = 'https://graph.test/drives/{{driveId}}/items/{{itemId}}';
const ITEM_A = { driveId: 'drive-1', itemId: 'item-A' };

describe('connector proxy: an approval only authorises the input that was approved', () => {
  let store: StoredApproval[];
  let fetchMock: jest.SpyInstance;

  const postDelete = (body: Record<string, unknown>) =>
    request(app)
      .post('/api/connectors/sharepoint/actions/delete')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(body);

  /** A decided row, as approvals.ts leaves it after a human approved the request. */
  const seedApproved = (over: Partial<StoredApproval> = {}): StoredApproval => {
    const row: StoredApproval = {
      id: `seed-${store.length + 1}`,
      requestedBy: AGENT_USER_ID,
      connectorId: 'sharepoint',
      actionId: 'delete',
      taskId: null,
      status: 'approved',
      createdAt: new Date(),
      inputHash: hashActionInput(ITEM_A),
      ...over,
    };
    store.push(row);
    return row;
  };

  beforeEach(() => {
    store = [];
    getEnabledConnectorMock.mockReturnValue({
      id: 'sharepoint',
      auth: { provider: 'microsoft', scope: 'files' },
      actions: [
        {
          id: 'delete',
          requiresApproval: true,
          riskLevel: 'high',
          method: 'DELETE',
          urlTemplate: DELETE_URL,
        },
      ],
    });
    (resolveToken as jest.Mock).mockResolvedValue('oauth-token');
    prismaMock.approvalRequest.findFirst.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) =>
        store.find((r) => matchesWhere(r, where)) ?? null,
    );
    prismaMock.approvalRequest.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        const row: StoredApproval = {
          id: `created-${store.length + 1}`,
          requestedBy: data.requestedBy as string,
          connectorId: data.connectorId as string,
          actionId: data.actionId as string,
          taskId: (data.taskId as string | undefined) ?? null,
          status: data.status as string,
          createdAt: new Date(),
          inputHash: data.inputHash as string | undefined,
        };
        store.push(row);
        return { ...row, reason: data.reason };
      },
    );
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ deleted: true }),
      text: async () => '',
    } as unknown as Response);
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  const expectRunsAction = (res: { status: number; body: unknown }) => {
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  };

  const expectNeedsNewApproval = (res: { status: number; body: { requiresApproval?: boolean; approvalId?: string } }) => {
    expect(res.status).toBe(202);
    expect(res.body.requiresApproval).toBe(true);
    expect(res.body.approvalId).toEqual(expect.any(String));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.approvalRequest.create).toHaveBeenCalledTimes(1);
  };

  it('stores the input hash on the new approval request', async () => {
    const res = await postDelete({ ...ITEM_A, approvalReason: 'cleanup' });

    expectNeedsNewApproval(res);
    const data = prismaMock.approvalRequest.create.mock.calls[0][0].data;
    expect(data.inputHash).toBe(hashActionInput(ITEM_A));
    // The full body stays on the row for the approver to read.
    expect(data.actionInput).toEqual({ ...ITEM_A, approvalReason: 'cleanup' });
  });

  it('asks for the hash in the lookup itself, not by filtering the result', async () => {
    await postDelete(ITEM_A);

    const where = prismaMock.approvalRequest.findFirst.mock.calls[0][0].where;
    expect(where.inputHash).toBe(hashActionInput(ITEM_A));
  });

  it('reuses an approval for an identical input and runs the action with it', async () => {
    seedApproved();

    const res = await postDelete(ITEM_A);

    expectRunsAction(res);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.test/drives/drive-1/items/item-A');
    expect(JSON.parse(options.body)).toEqual(ITEM_A);
  });

  it('logs the reuse as approval.reused and no longer as approval.consumed', async () => {
    const row = seedApproved();

    await postDelete(ITEM_A);

    const actions = (logAuditEvent as jest.Mock).mock.calls.map((c) => c[0].action);
    expect(actions).toContain('approval.reused');
    expect(actions).not.toContain('approval.consumed');
    const reused = (logAuditEvent as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((e) => e.action === 'approval.reused');
    expect(reused.details).toEqual({ approvalId: row.id, actionId: 'delete' });
  });

  it('reuses an approval when only the key order differs', async () => {
    seedApproved({ inputHash: hashActionInput({ driveId: 'drive-1', itemId: 'item-A' }) });

    const res = await postDelete({ itemId: 'item-A', driveId: 'drive-1' });

    expectRunsAction(res);
  });

  it('reuses an approval when only the free-text approvalReason differs', async () => {
    seedApproved();

    const res = await postDelete({ ...ITEM_A, approvalReason: 'a different explanation' });

    expectRunsAction(res);
  });

  it('does not reuse an approval for the same action on another item', async () => {
    seedApproved();

    const res = await postDelete({ driveId: 'drive-1', itemId: 'item-B' });

    expectNeedsNewApproval(res);
    expect(prismaMock.approvalRequest.create.mock.calls[0][0].data.inputHash).toBe(
      hashActionInput({ driveId: 'drive-1', itemId: 'item-B' }),
    );
  });

  it('does not reuse an approval for another drive', async () => {
    seedApproved();

    const res = await postDelete({ driveId: 'drive-2', itemId: 'item-A' });

    expectNeedsNewApproval(res);
  });

  it('does not reuse an approval when the input carries an extra key', async () => {
    seedApproved();

    const res = await postDelete({ ...ITEM_A, recursive: true });

    expectNeedsNewApproval(res);
  });

  it('does not reuse an approval when a key is missing', async () => {
    seedApproved();

    const res = await postDelete({ driveId: 'drive-1' });

    expectNeedsNewApproval(res);
  });

  it('does not reuse an approval when the same value is nested one level deeper', async () => {
    seedApproved({ inputHash: hashActionInput({ target: ITEM_A }) });

    const res = await postDelete(ITEM_A);

    expectNeedsNewApproval(res);
  });

  it('does not reuse an approval when only the order of an array differs', async () => {
    seedApproved({ inputHash: hashActionInput({ ids: ['a', 'b'] }) });

    const res = await postDelete({ ids: ['b', 'a'] });

    expectNeedsNewApproval(res);
  });

  it('does not reuse an approval when a number is sent as a string', async () => {
    seedApproved({ inputHash: hashActionInput({ ...ITEM_A, version: 1 }) });

    const res = await postDelete({ ...ITEM_A, version: '1' });

    expectNeedsNewApproval(res);
  });

  it('does not let a row without a hash authorise any input (null)', async () => {
    seedApproved({ inputHash: null });

    const res = await postDelete(ITEM_A);

    expectNeedsNewApproval(res);
  });

  it('does not let a row without a hash authorise any input (absent column value)', async () => {
    seedApproved({ inputHash: undefined });

    const res = await postDelete(ITEM_A);

    expectNeedsNewApproval(res);
  });

  it('does not let a row without a hash authorise an empty input either', async () => {
    seedApproved({ inputHash: null });

    const res = await postDelete({});

    expectNeedsNewApproval(res);
  });

  it('still honours the 24 h window: an approval older than a day does not match', async () => {
    seedApproved({ createdAt: new Date(Date.now() - 25 * HOUR) });

    const res = await postDelete(ITEM_A);

    expectNeedsNewApproval(res);
  });

  it('still honours the 24 h window: an approval from 23 h ago matches', async () => {
    seedApproved({ createdAt: new Date(Date.now() - 23 * HOUR) });

    const res = await postDelete(ITEM_A);

    expectRunsAction(res);
  });

  it('does not reuse a pending or rejected approval for the identical input', async () => {
    seedApproved({ status: 'pending' });
    seedApproved({ status: 'rejected' });

    const res = await postDelete(ITEM_A);

    expectNeedsNewApproval(res);
  });

  it('keeps the task binding: an approval of another task is not reused', async () => {
    seedApproved({ taskId: 'task-other' });
    prismaMock.task.findUnique.mockResolvedValue(authorizedTask());

    const res = await postDelete({ ...ITEM_A, taskId: 'task-1' });

    expectNeedsNewApproval(res);
  });

  it('end to end: an approved request is reused for its own input and for nothing else', async () => {
    const first = await postDelete(ITEM_A);
    expectNeedsNewApproval(first);
    // A human approves the row the proxy just created.
    store[0].status = 'approved';
    prismaMock.approvalRequest.create.mockClear();
    fetchMock.mockClear();

    const again = await postDelete({ itemId: 'item-A', driveId: 'drive-1' });
    expectRunsAction(again);
    fetchMock.mockClear();

    const other = await postDelete({ driveId: 'drive-9', itemId: 'item-Z' });
    expectNeedsNewApproval(other);
  });
});
