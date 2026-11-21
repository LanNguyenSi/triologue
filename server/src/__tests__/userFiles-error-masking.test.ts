/**
 * Route-level tests for error masking in routes/userFiles.ts.
 *
 * Messages the file produces itself (its helpers throw UserFileSourceError)
 * keep their text and their 400; a foreign error (Prisma, fetch, anything
 * unexpected) answers that handler's German fallback at the same status and
 * is logged, so internals like column names or upstream bodies do not leak.
 * The list handler's 500 answers its fallback only.
 *
 * Fully mocked (no DB, no network): isolated Express app with only
 * userFilesRoutes mounted; prisma, getTokenForUser and listEnabledConnectors
 * mocked (pattern of batch-dashboard-online-users.test.ts).
 *
 * Mutation-check intent:
 *   - Drop the `instanceof UserFileSourceError` branch in a catch -> that
 *     route's self-produced test below gets the fallback instead of its
 *     message.
 *   - Answer error.message again (the pre-fix shape) -> the foreign-error
 *     and list-500 tests below see the column name and fail.
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
    userFileSource: { findFirst: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock('../services/tokenManager', () => ({
  getTokenForUser: jest.fn(),
}));

jest.mock('../connectors/registry', () => ({
  listEnabledConnectors: jest.fn().mockReturnValue([
    { id: 'sharepoint', name: 'SharePoint', provider: 'sharepoint', category: 'storage' },
  ]),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import request from './helpers/loopbackRequest';
import prisma from '../lib/prisma';
import { getTokenForUser } from '../services/tokenManager';
import { logger } from '../utils/logger';
import { userFilesRoutes } from '../routes/userFiles';

const prismaMock = prisma as unknown as {
  userFileSource: { findFirst: jest.Mock; findMany: jest.Mock };
};
const getTokenForUserMock = getTokenForUser as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/user-files', userFilesRoutes);
  return app;
}

const SOURCE_ROW = {
  id: 'src-1',
  userId: 'user-1',
  provider: 'sharepoint',
  label: 'Team',
  siteUrl: 'https://contoso.sharepoint.com/sites/team',
  siteId: 'site-1',
  siteName: 'Team',
  driveId: 'drive-1',
  driveName: 'Documents',
  webUrl: 'https://contoso.sharepoint.com/sites/team',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  getTokenForUserMock.mockResolvedValue(null);
});

describe('self-produced messages stay readable (400)', () => {
  it('GET /sharepoint/files keeps the missing-personal-connection message', async () => {
    prismaMock.userFileSource.findFirst.mockResolvedValue(SOURCE_ROW);

    const res = await request(buildApp()).get('/api/user-files/sharepoint/files?sourceId=src-1');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Keine persönliche SharePoint-Verbindung gefunden. Bitte verbinde zuerst SharePoint.',
    });
  });

  it('GET /sharepoint/files keeps the source-not-found message', async () => {
    prismaMock.userFileSource.findFirst.mockResolvedValue(null);

    const res = await request(buildApp()).get('/api/user-files/sharepoint/files?sourceId=nope');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Dateiquelle nicht gefunden.' });
  });

  it('POST /sources/sharepoint turns an invalid URL into a readable 400', async () => {
    // `new URL()` throws a TypeError here; wrapped, it keeps the old shape.
    const res = await request(buildApp())
      .post('/api/user-files/sources/sharepoint')
      .send({ siteUrl: 'not a url' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'SharePoint siteUrl ist keine gültige URL.' });
  });

  it('POST /sources/sharepoint keeps the https-only message', async () => {
    const res = await request(buildApp())
      .post('/api/user-files/sources/sharepoint')
      .send({ siteUrl: 'http://contoso.sharepoint.com/sites/team' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'SharePoint siteUrl muss mit https:// beginnen.' });
  });

  it('a failed Graph call keeps the self-composed upstream message', async () => {
    prismaMock.userFileSource.findFirst.mockResolvedValue(SOURCE_ROW);
    getTokenForUserMock.mockResolvedValue('token-1');
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('insufficient privileges', { status: 403 }),
    );
    try {
      const res = await request(buildApp()).get('/api/user-files/sharepoint/files?sourceId=src-1');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'SharePoint request failed (403): insufficient privileges',
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('foreign errors are masked (and logged)', () => {
  it('GET /sharepoint/files answers the fallback for a Prisma failure', async () => {
    prismaMock.userFileSource.findFirst.mockRejectedValue(
      new Error('Unknown argument `secretColumn` at `userFileSource.findFirst`.'),
    );

    const res = await request(buildApp()).get('/api/user-files/sharepoint/files?sourceId=src-1');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'SharePoint folder konnte nicht geladen werden' });
    expect(JSON.stringify(res.body)).not.toContain('secretColumn');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('POST /sharepoint/resolve-site answers the fallback when the token lookup rejects', async () => {
    getTokenForUserMock.mockRejectedValue(
      new Error('connection terminated: SELECT secretColumn FROM user_tokens'),
    );

    const res = await request(buildApp())
      .post('/api/user-files/sharepoint/resolve-site')
      .send({ siteUrl: 'https://contoso.sharepoint.com/sites/team' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'SharePoint site konnte nicht aufgelöst werden' });
    expect(JSON.stringify(res.body)).not.toContain('secretColumn');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('GET /sources answers its 500 fallback only', async () => {
    prismaMock.userFileSource.findMany.mockRejectedValue(
      new Error('The column `UserFileSource.secretColumn` does not exist.'),
    );

    const res = await request(buildApp()).get('/api/user-files/sources');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Dateiquellen konnten nicht geladen werden' });
    expect(JSON.stringify(res.body)).not.toContain('secretColumn');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
