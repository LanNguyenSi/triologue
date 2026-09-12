/**
 * Security regression test: control-character sanitization for
 * `file.originalname` on the project/task attachment upload routes.
 *
 * multer 2.3.0 decodes WHATWG-escaped sequences (%0A, %0D, %22, ...) in
 * `originalname`, so an uploader can smuggle raw CR/LF/" into a name that
 * previously arrived percent-encoded. `stripControlChars` (see
 * upload.test.ts for the equivalent /upload coverage) is applied at every
 * `file.originalname` read site in routes/projects.ts. This suite covers
 * the two sites upload.test.ts does not reach:
 *   - POST /:projectId/attachments (project attachment)
 *   - POST /:projectId/tasks/:id/attachments (task attachment)
 * and the persisted `filename`, the inbox notification `message`, and the
 * generated attachment `url` (whose extension is derived via
 * `path.extname(stripControlChars(file.originalname))` in the shared
 * `taskAttachmentStorage` filename callback) for each.
 *
 * Mutation-check intent: make stripControlChars a no-op (return its input
 * unchanged) at either read site -> every assertion below that checks for
 * absence of control characters in a persisted/notified value fails. The
 * evil filename below carries a trailing control character just past the
 * extension (`.png\r`) so an un-stripped `path.extname()` call captures it
 * into the generated on-disk extension and, from there, the attachment url.
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
    project: { findUnique: jest.fn(), update: jest.fn() },
    projectAttachment: { create: jest.fn() },
    taskAttachment: { create: jest.fn() },
    task: { findUnique: jest.fn() },
    roomParticipant: { findUnique: jest.fn() },
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/inboxService', () => ({
  createInboxItems: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/resultRouterService', () => ({
  onTaskStatusChanged: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/taskPushService', () => ({
  emitTaskAssignedIfAgent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../plugins/manager', () => ({
  pluginManager: {
    emit: jest.fn().mockResolvedValue(undefined),
    initialize: jest.fn(),
    isPluginActive: jest.fn().mockReturnValue(false),
  },
}));

import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma';
import { createInboxItems } from '../services/inboxService';
import { projectRoutes } from '../routes/projects';

// The routes write accepted uploads to the real server/uploads directory
// (see UPLOAD_DIR in ../routes/projects.ts). Remove the files the mocked
// create calls reveal were written, after each test.
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

function removeCreatedUploads() {
  const mocks = [
    (prisma.projectAttachment.create as jest.Mock).mock?.calls ?? [],
    (prisma.taskAttachment.create as jest.Mock).mock?.calls ?? [],
  ];
  for (const calls of mocks) {
    for (const [arg] of calls) {
      const url = arg?.data?.url;
      if (typeof url === 'string' && url.startsWith('/uploads/')) {
        fs.rmSync(path.join(UPLOAD_DIR, path.basename(url)), { force: true });
      }
    }
  }
}

afterEach(() => {
  removeCreatedUploads();
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', projectRoutes);
  app.set('io', null);
  return app;
}

const PROJECT_RECORD = {
  id: 'project-1',
  ownerId: 'user-1',
  roomId: null,
  teamMemberIds: [],
};

const EVIL_NAME = 'evil%0Aname%22.png%0D';
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.project.findUnique as jest.Mock).mockResolvedValue(PROJECT_RECORD);
  (prisma.projectAttachment.create as jest.Mock).mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'attachment-1', ...data }),
  );
  (prisma.taskAttachment.create as jest.Mock).mockImplementation(
    ({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'attachment-1', ...data }),
  );
  (prisma.task.findUnique as jest.Mock).mockResolvedValue({
    id: 'task-1',
    projectId: 'project-1',
    assignedTo: 'user-1',
  });
});

describe('POST /api/projects/:projectId/attachments - originalname sanitization', () => {
  it('strips control characters from the persisted filename and the inbox message', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/projects/project-1/attachments')
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
    // path.extname(stripControlChars(...)) site: the generated url's
    // extension must not carry the trailing \r past ".png".
    expect(createCall.data.url).not.toMatch(CONTROL_CHAR_RE);
    expect(createCall.data.url).toMatch(/\.png$/);

    const inboxCall = (createInboxItems as jest.Mock).mock.calls[0][0];
    expect(inboxCall.message).not.toMatch(CONTROL_CHAR_RE);
    expect(inboxCall.message).toContain('"');
  });
});

describe('POST /api/projects/:projectId/tasks/:id/attachments - originalname sanitization', () => {
  it('strips control characters from the persisted filename and the inbox message', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/projects/project-1/tasks/task-1/attachments')
      .attach('file', Buffer.from('PNG content'), {
        filename: EVIL_NAME,
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);

    const createCall = (prisma.taskAttachment.create as jest.Mock).mock
      .calls[0][0];
    const persistedFilename = createCall.data.filename;
    expect(persistedFilename).not.toMatch(CONTROL_CHAR_RE);
    expect(persistedFilename).toContain('"');
    expect(createCall.data.url).not.toMatch(CONTROL_CHAR_RE);
    expect(createCall.data.url).toMatch(/\.png$/);

    const inboxCall = (createInboxItems as jest.Mock).mock.calls[0][0];
    expect(inboxCall.message).not.toMatch(CONTROL_CHAR_RE);
    expect(inboxCall.message).toContain('"');
  });
});
