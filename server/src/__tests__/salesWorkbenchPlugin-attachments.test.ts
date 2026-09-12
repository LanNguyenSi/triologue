/**
 * Security regression test: control-character sanitization for
 * `file.originalname` on the sales-workbench plugin's project-attachment
 * upload route (POST /project-attachments).
 *
 * multer 2.3.0 decodes WHATWG-escaped sequences (%0A, %0D, %22, ...) in
 * `originalname`, so an uploader can smuggle raw CR/LF/" into a name that
 * previously arrived percent-encoded. `stripControlChars` is applied at the
 * `file.originalname` read site persisted to `projectAttachment.filename`.
 *
 * Mutation-check intent: make stripControlChars a no-op (return its input
 * unchanged) -> the assertion that the persisted filename has no control
 * characters fails.
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

jest.mock('../plugins/security', () => ({
  requirePluginCapabilities: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../plugins/moduleRuntimeService', () => ({
  completeModuleRun: jest.fn(),
  createModuleRun: jest.fn(),
  createOrReuseSyncedTask: jest.fn(),
  ensureModuleInstance: jest.fn(),
  failModuleRun: jest.fn(),
  postModuleRunCard: jest.fn(),
}));

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    project: { findUnique: jest.fn() },
    projectPluginLink: { findUnique: jest.fn(), upsert: jest.fn() },
    roomParticipant: { findUnique: jest.fn() },
    projectAttachment: { create: jest.fn(), findMany: jest.fn() },
  },
}));

import express from 'express';
import request from 'supertest';
import prisma from '../lib/prisma';
import { salesWorkbenchPlugin } from '../plugins/builtin/salesWorkbenchPlugin';

function buildApp() {
  const { basePath, router } = salesWorkbenchPlugin.registerRoutes!(
    {} as Parameters<NonNullable<typeof salesWorkbenchPlugin.registerRoutes>>[0],
  )[0];
  const app = express();
  app.use(express.json());
  app.use(basePath, router);
  return app;
}

const PROJECT_RECORD = {
  id: 'project-1',
  name: 'Project One',
  status: 'active',
  ownerId: 'user-1',
  teamMemberIds: [],
  roomId: 'room-1',
  projectContext: null,
};

const EVIL_NAME = 'evil%0Aname%22.png';
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.project.findUnique as jest.Mock).mockResolvedValue(PROJECT_RECORD);
  (prisma.projectPluginLink.findUnique as jest.Mock).mockResolvedValue({
    id: 'link-1',
  });
  (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
    userId: 'user-1',
  });
  (prisma.projectAttachment.create as jest.Mock).mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'attachment-1', ...data }),
  );
});

describe('POST /project-attachments (sales-workbench) - originalname sanitization', () => {
  it('strips control characters from the persisted filename', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/plugin-modules/sales-workbench/project-attachments')
      .query({ projectId: 'project-1' })
      .attach('file', Buffer.from('PNG content'), {
        filename: EVIL_NAME,
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);

    const createCall = (prisma.projectAttachment.create as jest.Mock).mock
      .calls[0][0];
    const persistedFilename = createCall.data.filename;
    expect(persistedFilename).not.toMatch(CONTROL_CHAR_RE);
    expect(persistedFilename).toContain('"');
  });
});
