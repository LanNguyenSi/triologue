/**
 * Route test for GET /api/integrations/connectors in src/routes/integrations.ts.
 *
 * Guards tested:
 *   1. A personal row decides status and connectionScope "user".
 *   2. A tenant-wide row (userId null) is never read for a token, so it is not
 *      advertised as a connection: status "disconnected", no scope, no
 *      integrationId, whatever its own status.
 *   3. With no row at all the connector is "disconnected".
 *
 * Mutation-test intent:
 *   - Falling back to the tenant-wide row for status breaks test 2.
 */

const currentUser = { id: 'user-1', username: 'user1', userType: 'HUMAN', displayName: 'User 1', isAdmin: false };

jest.mock('../middleware/auth', () => ({
  authenticate: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user: unknown }).user = currentUser;
    next();
  },
}));

jest.mock('../lib/prisma', () => ({ __esModule: true, default: {} }));

jest.mock('../services/tokenManager', () => ({
  getTokenForUser: jest.fn().mockResolvedValue(null),
  listIntegrations: jest.fn(),
}));

const connector = {
  id: 'sharepoint',
  name: 'SharePoint',
  provider: 'microsoft',
  category: 'files',
  auth: { type: 'oauth2', provider: 'microsoft', scope: 'graph' },
  actions: [],
};

jest.mock('../connectors/registry', () => ({
  listEnabledConnectors: jest.fn(() => [connector]),
  getEnabledConnector: jest.fn(() => connector),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import request from './helpers/loopbackRequest';
import { listIntegrations } from '../services/tokenManager';
import integrationsRouter from '../routes/integrations';

const HOUR = 3_600_000;

function row(overrides: Record<string, unknown>) {
  return {
    id: 'row-1',
    provider: 'microsoft',
    scope: 'graph',
    tenantId: 'common',
    userId: null,
    status: 'active',
    expiresAt: new Date(Date.now() + 72 * HOUR).toISOString(),
    createdBy: 'admin',
    ...overrides,
  };
}

async function listing() {
  const app = express();
  app.use('/api/integrations', integrationsRouter);
  const res = await request(app).get('/api/integrations/connectors');
  expect(res.status).toBe(200);
  return res.body.items[0];
}

describe('GET /api/integrations/connectors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports a personal row with scope user', async () => {
    (listIntegrations as jest.Mock).mockResolvedValue([row({ userId: 'user-1' })]);
    const item = await listing();
    expect(item.connectionScope).toBe('user');
    expect(item.status).toBe('connected');
    expect(item.integrationId).toBe('row-1');
    expect(item).not.toHaveProperty('hasGlobalFallback');
  });

  it.each([
    ['active', 72 * HOUR],
    ['active', 2 * HOUR],
    ['active', -HOUR],
    ['error', 72 * HOUR],
    ['revoked', 72 * HOUR],
  ])('does not advertise a tenant-wide %s row expiring in %i ms', async (status, offset) => {
    (listIntegrations as jest.Mock).mockResolvedValue([
      row({ status, expiresAt: new Date(Date.now() + (offset as number)).toISOString() }),
    ]);
    const item = await listing();
    expect(item.connectionScope).toBeNull();
    expect(item.status).toBe('disconnected');
    expect(item.integrationId).toBeUndefined();
    expect(item.hasPersonalConnection).toBe(false);
    expect(item).not.toHaveProperty('hasGlobalFallback');
  });

  it('ignores a tenant-wide row next to a personal one', async () => {
    (listIntegrations as jest.Mock).mockResolvedValue([
      row({ id: 'g', status: 'error' }),
      row({ id: 'u', userId: 'user-1' }),
    ]);
    const item = await listing();
    expect(item.connectionScope).toBe('user');
    expect(item.status).toBe('connected');
    expect(item.integrationId).toBe('u');
  });

  it('reports disconnected when there is no row', async () => {
    (listIntegrations as jest.Mock).mockResolvedValue([]);
    const item = await listing();
    expect(item.connectionScope).toBeNull();
    expect(item.status).toBe('disconnected');
  });
});
