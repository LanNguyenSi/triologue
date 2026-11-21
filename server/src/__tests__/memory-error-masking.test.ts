/**
 * Route-level tests for the 500 bodies of the memory routes
 * (routes/memory.ts): every catch answers its fixed fallback text and logs
 * the error server-side; nothing of the foreign error (a Prisma message
 * naming a column, a driver message) reaches the client. The 4xx paths are
 * untouched.
 *
 * Fully mocked (no DB): isolated Express app with only memoryRoutes
 * mounted, prisma mocked, authenticate mocked (pattern of
 * batch-dashboard-online-users.test.ts). Runs without RUN_DB_TESTS.
 *
 * Mutation-check intent:
 *   - Return error.message in a catch -> the body of that route's test
 *     below carries the column name and fails on both the exact-body and
 *     the not-toContain assertions.
 *   - Drop the logger.error call -> the logger assertion of every test
 *     below fails.
 */

const currentUser = {
  id: 'user-1',
  username: 'user1',
  userType: 'HUMAN',
  displayName: 'User 1',
  isAdmin: true,
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
    project: { findMany: jest.fn(), findUnique: jest.fn() },
    agentMemoryEntry: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import request from './helpers/loopbackRequest';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';
import { memoryRoutes } from '../routes/memory';

const prismaMock = prisma as unknown as Record<
  string,
  Record<string, jest.Mock>
>;

// A foreign failure whose message must never reach the client.
const FOREIGN_ERROR = Object.assign(
  new Error('The column `AgentMemoryEntry.secretColumn` does not exist in the current database.'),
  { code: 'P2022' },
);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/memory', memoryRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

/** All six 500 paths with the prisma call each one hits first. */
const cases: Array<{
  label: string;
  request: (app: express.Express) => PromiseLike<unknown>;
  reject: () => void;
  fallback: string;
}> = [
  {
    label: 'GET / list',
    request: (app) => request(app).get('/api/memory/'),
    reject: () => prismaMock.project.findMany.mockRejectedValue(FOREIGN_ERROR),
    fallback: 'Failed to load memory',
  },
  {
    label: 'POST / create',
    request: (app) => request(app).post('/api/memory/').send({ note: 'a note' }),
    reject: () => prismaMock.agentMemoryEntry.create.mockRejectedValue(FOREIGN_ERROR),
    fallback: 'Failed to create memory entry',
  },
  {
    label: 'GET /:id entry',
    request: (app) => request(app).get('/api/memory/entry-1'),
    reject: () => prismaMock.agentMemoryEntry.findUnique.mockRejectedValue(FOREIGN_ERROR),
    fallback: 'Failed to load memory entry',
  },
  {
    label: 'PATCH /:id update',
    request: (app) => request(app).patch('/api/memory/entry-1').send({ note: 'new note' }),
    reject: () => prismaMock.agentMemoryEntry.findUnique.mockRejectedValue(FOREIGN_ERROR),
    fallback: 'Failed to update memory entry',
  },
  {
    label: 'DELETE /:id/permanent',
    request: (app) => request(app).delete('/api/memory/entry-1/permanent'),
    reject: () => prismaMock.agentMemoryEntry.findUnique.mockRejectedValue(FOREIGN_ERROR),
    fallback: 'Failed to delete memory entry',
  },
  {
    label: 'DELETE /:id archive',
    request: (app) => request(app).delete('/api/memory/entry-1'),
    reject: () => prismaMock.agentMemoryEntry.findUnique.mockRejectedValue(FOREIGN_ERROR),
    fallback: 'Failed to archive memory entry',
  },
];

describe.each(cases)('$label: 500 answers the fallback and logs', ({ request: fire, reject, fallback }) => {
  it(`answers "${fallback}" without the foreign message, and logs the error`, async () => {
    reject();

    const res = (await fire(buildApp())) as { status: number; body: Record<string, unknown> };

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: fallback });
    expect(JSON.stringify(res.body)).not.toContain('secretColumn');
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), FOREIGN_ERROR);
  });
});
