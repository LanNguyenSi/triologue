/**
 * Route-level tests for the message-content bound of POST /api/batch/messages
 * (routes/batch.ts). The bound is the message create schema
 * (utils/validation.ts), checked per message before any query: a non-string
 * content or one past 10,000 characters gets a per-message result error with
 * the schema's own message, and the other messages of the batch are still
 * processed.
 *
 * Fully mocked (no DB): isolated Express app with only batchRoutes mounted,
 * prisma mocked, authenticate mocked (pattern of
 * batch-dashboard-online-users.test.ts). Runs without RUN_DB_TESTS.
 *
 * Mutation-check intent:
 *   - Neutralise the contentErrors check in routes/batch.ts -> the refused
 *     content would reach the membership/insert path: the "refused before the
 *     membership query" test would get 'Not a member' (or a create call)
 *     instead of the schema message, and the mixed-batch test would call
 *     message.create for the too-long message.
 */

const currentUser = {
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
    roomParticipant: { findMany: jest.fn(), findUnique: jest.fn() },
    project: { findMany: jest.fn() },
    message: { create: jest.fn() },
    task: { findMany: jest.fn() },
    agentToken: { findMany: jest.fn() },
  },
}));

jest.mock('../plugins/manager', () => ({
  pluginManager: { emit: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../services/mentionLimiter', () => ({
  getMentionBudget: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import request from './helpers/loopbackRequest';
import prisma from '../lib/prisma';
import { batchRoutes } from '../routes/batch';

const prismaMock = prisma as unknown as {
  roomParticipant: { findMany: jest.Mock };
  project: { findMany: jest.Mock };
  message: { create: jest.Mock };
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/batch', batchRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.project.findMany.mockResolvedValue([]);
  prismaMock.message.create.mockImplementation(
    async ({ data }: { data: { roomId: string; content: string } }) => ({
      id: `msg-${data.roomId}`,
      content: data.content,
      roomId: data.roomId,
      senderId: currentUser.id,
      messageType: 'TEXT',
      sender: currentUser,
      reactions: [],
      attachments: [],
    }),
  );
});

describe('POST /api/batch/messages: per-message content bound', () => {
  it('refuses a too-long message among valid ones; the others are still sent', async () => {
    prismaMock.roomParticipant.findMany.mockResolvedValue([{ roomId: 'room-1' }]);
    const tooLong = 'x'.repeat(10001);

    const res = await request(buildApp()).post('/api/batch/messages').send({
      messages: [
        { roomId: 'room-1', content: 'first ok' },
        { roomId: 'room-1', content: tooLong },
        { roomId: 'room-1', content: 'also ok' },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { roomId: 'room-1', messageId: 'msg-room-1', ok: true },
      { roomId: 'room-1', error: 'Message cannot exceed 10,000 characters' },
      { roomId: 'room-1', messageId: 'msg-room-1', ok: true },
    ]);
    expect(prismaMock.message.create).toHaveBeenCalledTimes(2);
    const createdContents = prismaMock.message.create.mock.calls.map(
      (call: [{ data: { content: string } }]) => call[0].data.content,
    );
    expect(createdContents).toEqual(['first ok', 'also ok']);
  });

  it('refuses with the schema message before the membership query runs on it', async () => {
    // Membership is empty: a refused content that skipped the bound would
    // answer 'Not a member' (or nothing) here instead of the schema message.
    prismaMock.roomParticipant.findMany.mockResolvedValue([]);

    const res = await request(buildApp()).post('/api/batch/messages').send({
      messages: [{ roomId: 'room-1', content: 'x'.repeat(10001) }],
    });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { roomId: 'room-1', error: 'Message cannot exceed 10,000 characters' },
    ]);
    expect(prismaMock.roomParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ roomId: { in: ['room-1'] } }),
      }),
    );
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it.each([
    ['a number', 42, /must be a string/],
    ['null', null, /must be a string/],
    ['an empty string', '', /^Message cannot be empty$/],
    ['a whitespace-only string', '   ', /^Message cannot be empty$/],
  ])('refuses %s with the schema message and writes nothing', async (_label, content, messagePattern) => {
    prismaMock.roomParticipant.findMany.mockResolvedValue([{ roomId: 'room-1' }]);

    const res = await request(buildApp()).post('/api/batch/messages').send({
      messages: [{ roomId: 'room-1', content }],
    });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].roomId).toBe('room-1');
    expect(res.body.results[0].error).toEqual(expect.stringMatching(messagePattern));
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it('accepts content at the bound (10000 characters)', async () => {
    prismaMock.roomParticipant.findMany.mockResolvedValue([{ roomId: 'room-1' }]);

    const res = await request(buildApp()).post('/api/batch/messages').send({
      messages: [{ roomId: 'room-1', content: 'x'.repeat(10000) }],
    });

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { roomId: 'room-1', messageId: 'msg-room-1', ok: true },
    ]);
    expect(prismaMock.message.create).toHaveBeenCalledTimes(1);
  });
});
