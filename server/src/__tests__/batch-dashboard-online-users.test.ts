/**
 * Regression tests for agent-tasks be5580dd: GET /api/me/dashboard
 * (routes/batch.ts) reads `req.app.get('redis')` to build its `onlineUsers`
 * field, but nothing ever called `app.set('redis', ...)`, so the lookup
 * always resolved to `undefined` and the field silently returned `[]`
 * regardless of actual presence.
 *
 * Decision (see index-redis-app-wiring.test.ts for the wiring-side pin):
 * index.ts now does `app.set("redis", redis)` with the SAME shared client
 * used by services/socketService.ts. That client's sAdd/sRem calls write
 * user ids into the "online_users" Redis set on socket connect/disconnect;
 * this route's `sMembers('online_users')` reads that same set, and
 * routes/rooms.ts's presence check reads it via `smIsMember`. One shared
 * key, one shared client — read and write sides agree.
 *
 * This suite is route-level and fully mocked (no DB, no real Redis
 * connection): it stands up an isolated Express app with only batchRoutes
 * mounted, `prisma` mocked, `authenticate` mocked, and a fake redis client
 * installed via `app.set('redis', ...)` exactly the way index.ts does it —
 * mirroring the pattern used by files.test.ts / connectorProxyApproval.test.ts.
 * It therefore runs unconditionally, without RUN_DB_TESTS or a live Postgres.
 *
 * Mutation-testability:
 *   - Reverting the `if (redis) return await redis.sMembers(...)` guard's
 *     result, or breaking the app.set('redis', ...) wiring in index.ts (see
 *     the sibling test file), makes onlineUsers always `[]` — the "wired up"
 *     test below would fail (expects the actual mocked members list).
 *   - Removing the `try { ... } catch { return [] }` guard around the Redis
 *     call would turn a rejecting sMembers() into an unhandled rejection /
 *     500 instead of a safe `[]` — the "Redis call fails" test below pins
 *     the graceful-degradation path.
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
    roomParticipant: { findMany: jest.fn() },
    project: { findMany: jest.fn() },
    task: { findMany: jest.fn() },
    message: { findMany: jest.fn() },
    agentToken: { findMany: jest.fn() },
  },
}));

jest.mock('../services/mentionLimiter', () => ({
  getMentionBudget: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import prisma from '../lib/prisma';
import { getMentionBudget } from '../services/mentionLimiter';
import { batchRoutes } from '../routes/batch';

const prismaMock = prisma as unknown as {
  roomParticipant: { findMany: jest.Mock };
  project: { findMany: jest.Mock };
  task: { findMany: jest.Mock };
  message: { findMany: jest.Mock };
  agentToken: { findMany: jest.Mock };
};
const getMentionBudgetMock = getMentionBudget as jest.Mock;

/**
 * Builds an isolated Express app with only batchRoutes mounted. `redisClient`
 * is installed via `app.set('redis', ...)` exactly the way index.ts wires in
 * the shared client — omit it to reproduce the pre-fix "nothing ever called
 * app.set" state.
 */
function buildApp(redisClient?: unknown) {
  const app = express();
  app.use(express.json());
  if (redisClient !== undefined) {
    app.set('redis', redisClient);
  }
  app.use('/api/batch', batchRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = {
    id: 'user-1',
    username: 'user1',
    userType: 'HUMAN',
    displayName: 'User 1',
    isAdmin: false,
  };
  prismaMock.roomParticipant.findMany.mockResolvedValue([]);
  prismaMock.project.findMany.mockResolvedValue([]);
  prismaMock.task.findMany.mockResolvedValue([]);
  prismaMock.message.findMany.mockResolvedValue([]);
  prismaMock.agentToken.findMany.mockResolvedValue([]);
  getMentionBudgetMock.mockResolvedValue({ current: 0, limit: 15, remaining: 15 });
});

describe('GET /api/me/dashboard — onlineUsers via app.get("redis")', () => {
  it('returns the members of the "online_users" Redis set when redis is wired up', async () => {
    const sMembers = jest.fn().mockResolvedValue(['user-1', 'user-2']);
    const app = buildApp({ sMembers });

    const res = await request(app).get('/api/batch/me/dashboard');

    expect(res.status).toBe(200);
    expect(sMembers).toHaveBeenCalledWith('online_users');
    expect(res.body.onlineUsers).toEqual(['user-1', 'user-2']);
  });

  it('returns [] (does not crash) when nothing has app.set("redis", ...) — the original bug', async () => {
    // Reproduces the pre-fix state: req.app.get('redis') resolves to
    // undefined, so the `if (redis)` guard short-circuits.
    const app = buildApp(undefined);

    const res = await request(app).get('/api/batch/me/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.onlineUsers).toEqual([]);
  });

  it('returns [] when the Redis call itself fails, instead of a 500', async () => {
    const sMembers = jest.fn().mockRejectedValue(new Error('connection reset'));
    const app = buildApp({ sMembers });

    const res = await request(app).get('/api/batch/me/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.onlineUsers).toEqual([]);
  });
});
