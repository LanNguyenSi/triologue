/**
 * Route-level tests for error masking in routes/userFiles.ts.
 *
 * Messages the file produces itself (its helpers throw UserFileSourceError)
 * keep their text and their 400; a foreign error (Prisma, fetch, anything
 * unexpected) answers that handler's German fallback with status 500 and is
 * logged, so internals like column names or upstream bodies do not leak.
 * The table below covers all six handlers that mask errors; the list
 * handler's 500 answers its fallback only.
 *
 * Fully mocked (no DB, no network): isolated Express app with only
 * userFilesRoutes mounted; prisma, getTokenForUser and listEnabledConnectors
 * mocked (pattern of batch-dashboard-online-users.test.ts).
 *
 * Mutation-check intent:
 *   - Drop the `instanceof UserFileSourceError` branch in a catch -> that
 *     route's self-produced row below gets the fallback instead of its
 *     message.
 *   - Answer error.message again (the pre-fix shape) -> the foreign-error
 *     rows and the list-500 test see the column name and fail.
 *   - Drop a handler's logger.error -> that row's logger assertion fails.
 *   - Turn the driveId-missing throw into a plain Error -> it answers the
 *     fallback instead of its readable 400.
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
    userFileSource: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
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
import { userFilesRoutes, UserFileSourceError } from '../routes/userFiles';

const prismaMock = prisma as unknown as {
  userFileSource: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
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
  getTokenForUserMock.mockReset();
  getTokenForUserMock.mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});


const SECRET_MESSAGE = 'Unknown argument `secretColumn` at `userFileSource.findFirst`.';
const SITE_URL = 'https://contoso.sharepoint.com/sites/team';

type App = ReturnType<typeof buildApp>;
type Call = (app: App) => ReturnType<ReturnType<typeof request>['get']>;

interface Row {
  name: string;
  call: Call;
  /** Arrange a failure that this file produces itself. */
  self: () => void;
  selfStatus: number;
  selfBody: { error: string };
  /** Arrange a failure that is not this file's own (Prisma, fetch, ...). */
  foreign: () => void;
  fallback: string;
}

const NO_CONNECTION = {
  error: 'Keine persönliche SharePoint-Verbindung gefunden. Bitte verbinde zuerst SharePoint.',
};

const rows: Row[] = [
  {
    name: 'POST /sources/sharepoint',
    call: (app) =>
      request(app).post('/api/user-files/sources/sharepoint').send({ siteUrl: SITE_URL }),
    // No token: the helper's own message.
    self: () => getTokenForUserMock.mockResolvedValue(null),
    selfStatus: 400,
    selfBody: NO_CONNECTION,
    // The Graph call itself rejects (network failure with an internal text).
    foreign: () => {
      getTokenForUserMock.mockResolvedValue('token-1');
      jest.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('getaddrinfo failed for secretColumn.internal'),
      );
    },
    fallback: 'SharePoint Quelle konnte nicht gespeichert werden',
  },
  {
    name: 'DELETE /sources/:sourceId',
    call: (app) => request(app).delete('/api/user-files/sources/src-1') as never,
    // Nothing in this handler throws its own error today; the branch still
    // guards the helper class, so throw it from the lookup.
    self: () =>
      prismaMock.userFileSource.findFirst.mockRejectedValue(
        new UserFileSourceError(400, 'Dateiquelle nicht gefunden.'),
      ),
    selfStatus: 400,
    selfBody: { error: 'Dateiquelle nicht gefunden.' },
    foreign: () => {
      prismaMock.userFileSource.findFirst.mockResolvedValue({ id: 'src-1' });
      prismaMock.userFileSource.delete.mockRejectedValue(new Error(SECRET_MESSAGE));
    },
    fallback: 'Dateiquelle konnte nicht gelöscht werden',
  },
  {
    name: 'POST /sharepoint/resolve-site',
    call: (app) =>
      request(app).post('/api/user-files/sharepoint/resolve-site').send({ siteUrl: SITE_URL }),
    self: () => getTokenForUserMock.mockResolvedValue(null),
    selfStatus: 400,
    selfBody: NO_CONNECTION,
    foreign: () =>
      getTokenForUserMock.mockRejectedValue(
        new Error('connection terminated: SELECT secretColumn FROM user_tokens'),
      ),
    fallback: 'SharePoint site konnte nicht aufgelöst werden',
  },
  {
    name: 'GET /sharepoint/files',
    call: (app) => request(app).get('/api/user-files/sharepoint/files?sourceId=src-1'),
    self: () => prismaMock.userFileSource.findFirst.mockResolvedValue(null),
    selfStatus: 400,
    selfBody: { error: 'Dateiquelle nicht gefunden.' },
    foreign: () => prismaMock.userFileSource.findFirst.mockRejectedValue(new Error(SECRET_MESSAGE)),
    fallback: 'SharePoint folder konnte nicht geladen werden',
  },
  {
    name: 'GET /sharepoint/download',
    call: (app) =>
      request(app).get('/api/user-files/sharepoint/download?sourceId=src-1&filePath=/a.txt'),
    self: () => prismaMock.userFileSource.findFirst.mockResolvedValue(null),
    selfStatus: 400,
    selfBody: { error: 'Dateiquelle nicht gefunden.' },
    foreign: () => {
      prismaMock.userFileSource.findFirst.mockResolvedValue(SOURCE_ROW);
      getTokenForUserMock.mockResolvedValue('token-1');
      jest.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('socket hang up at secretColumn.internal'),
      );
    },
    fallback: 'SharePoint Datei konnte nicht geladen werden',
  },
  {
    name: 'POST /sharepoint/upload',
    call: (app) =>
      request(app)
        .post('/api/user-files/sharepoint/upload')
        .field('sourceId', 'src-1')
        .attach('file', Buffer.from('hello'), 'a.txt'),
    self: () => prismaMock.userFileSource.findFirst.mockResolvedValue(null),
    selfStatus: 400,
    selfBody: { error: 'Dateiquelle nicht gefunden.' },
    foreign: () => prismaMock.userFileSource.findFirst.mockRejectedValue(new Error(SECRET_MESSAGE)),
    fallback: 'SharePoint upload fehlgeschlagen',
  },
];

describe.each(rows)('$name', (row) => {
  it('keeps a self-produced message and its 400', async () => {
    row.self();

    const res = await row.call(buildApp());

    expect(res.status).toBe(row.selfStatus);
    expect(res.body).toEqual(row.selfBody);
    // A caller-facing failure is not an internal error: nothing to log.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('masks a foreign error: 500, fallback text, logged', async () => {
    row.foreign();

    const res = await row.call(buildApp());

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: row.fallback });
    expect(JSON.stringify(res.body)).not.toContain('secretColumn');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('source without a drive id', () => {
  it.each([
    ['GET /sharepoint/files', (app: App) => request(app).get('/api/user-files/sharepoint/files?sourceId=src-1')],
    [
      'GET /sharepoint/download',
      (app: App) =>
        request(app).get('/api/user-files/sharepoint/download?sourceId=src-1&filePath=/a.txt'),
    ],
  ])('%s answers the readable 400', async (_name, call) => {
    prismaMock.userFileSource.findFirst.mockResolvedValue({ ...SOURCE_ROW, driveId: null });

    const res = await call(buildApp());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Dateiquelle ist unvollständig konfiguriert.' });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('other self-produced messages (400)', () => {
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
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('insufficient privileges', { status: 403 }),
    );

    const res = await request(buildApp()).get('/api/user-files/sharepoint/files?sourceId=src-1');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'SharePoint request failed (403): insufficient privileges',
    });
  });
});

describe('GET /sources', () => {
  it('answers its 500 fallback only', async () => {
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
