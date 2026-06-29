/**
 * Security tests for src/routes/upload.ts — HIGH gap coverage
 *
 * Guards tested:
 *   1. ALLOWED_MIME_TYPES: disallowed types (e.g. SVG) are rejected with 400.
 *   2. MAX_FILE_SIZE (10 MB): files exceeding the limit are rejected with 413.
 *   3. Room membership ACL: non-members receive 403 (file is cleaned up).
 *   4. Allowed type (image/png) is accepted and results in a successful message.
 *
 * Mutation-check intent:
 *   - Add 'image/svg+xml' to ALLOWED_MIME_TYPES → the SVG-rejected test fails
 *     (the route would accept it and proceed to the DB layer).
 *   - Remove `if (!participation) return 403` → the non-member test fails.
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
    roomParticipant: { findUnique: jest.fn() },
    message: { create: jest.fn() },
    room: { update: jest.fn() },
    project: { findFirst: jest.fn() },
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/inboxService', () => ({
  createMentionInboxItems: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../utils/projectRoomPolicy', () => ({
  getLinkedProjectStatus: jest.fn().mockResolvedValue(null),
  isRoomWriteBlocked: jest.fn().mockReturnValue(false),
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
import prisma from '../lib/prisma';
import { uploadRoutes } from '../routes/upload';

function buildApp() {
  const app = express();
  // express.json() is not needed for multipart; multer parses it.
  app.use('/upload', uploadRoutes);
  // Set io to null so the socket emit branch is skipped.
  app.set('io', null);
  return app;
}

const CREATED_MESSAGE = {
  id: 'msg-1',
  content: '',
  senderId: 'user-1',
  roomId: 'room-1',
  messageType: 'IMAGE',
  attachments: [
    {
      id: 'att-1',
      filename: 'test.png',
      url: '/uploads/test-uuid.png',
      mimeType: 'image/png',
      size: 100,
      type: 'IMAGE',
    },
  ],
  reactions: [],
  sender: {
    id: 'user-1',
    username: 'user1',
    displayName: 'User 1',
    userType: 'HUMAN',
    avatar: null,
  },
};

beforeEach(() => {
  currentUser = {
    id: 'user-1',
    username: 'user1',
    userType: 'HUMAN',
    displayName: 'User 1',
    isAdmin: false,
  };
  jest.clearAllMocks();
  (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
    userId: 'user-1',
    roomId: 'room-1',
  });
  (prisma.message.create as jest.Mock).mockResolvedValue(CREATED_MESSAGE);
  (prisma.room.update as jest.Mock).mockResolvedValue({});
});

// ── 1. SVG rejected (ALLOWED_MIME_TYPES guard) ────────────────────────────

describe('POST /upload — MIME-type guard', () => {
  it('rejects image/svg+xml (SVG — XSS risk, intentionally excluded) with 400', async () => {
    // Mutation target: if 'image/svg+xml' is added to ALLOWED_MIME_TYPES, multer
    // passes the file and the route proceeds to the DB layer (returning something
    // other than 400), failing this assertion.
    const app = buildApp();

    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('<svg><script>alert(1)</script></svg>'), {
        filename: 'malicious.svg',
        contentType: 'image/svg+xml',
      })
      .field('roomId', 'room-1');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  it('accepts image/png with 200', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('PNG content'), {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .field('roomId', 'room-1');

    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  it('accepts application/pdf with 200', async () => {
    (prisma.message.create as jest.Mock).mockResolvedValue({
      ...CREATED_MESSAGE,
      messageType: 'FILE',
      attachments: [{ ...CREATED_MESSAGE.attachments[0], type: 'DOCUMENT', mimeType: 'application/pdf' }],
    });
    const app = buildApp();

    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('%PDF-1.4 content'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      })
      .field('roomId', 'room-1');

    expect(res.status).toBe(200);
  });

  it('rejects application/octet-stream (binary) with 400', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('\x00\x01\x02binary'), {
        filename: 'binary.bin',
        contentType: 'application/octet-stream',
      })
      .field('roomId', 'room-1');

    expect(res.status).toBe(400);
  });
});

// ── 2. File size guard ────────────────────────────────────────────────────

describe('POST /upload — file size guard', () => {
  it('rejects files exceeding 10 MB with 413', async () => {
    const app = buildApp();
    // One byte over the 10 MB limit.
    const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 1, 'x');

    const res = await request(app)
      .post('/upload')
      .attach('file', oversizedBuffer, {
        filename: 'huge.png',
        contentType: 'image/png',
      })
      .field('roomId', 'room-1');

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  }, 30000); // allow extra time for the large buffer
});

// ── 3. Room-membership ACL ────────────────────────────────────────────────

describe('POST /upload — room membership ACL', () => {
  it('returns 403 when the user is not a member of the room', async () => {
    // Mutation target: remove `if (!participation) return 403` → non-members
    // can upload files to arbitrary rooms.
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('PNG content'), {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .field('roomId', 'room-1');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a member/i);
    // Message must not have been created
    expect(prisma.message.create as jest.Mock).not.toHaveBeenCalled();
  });
});

// ── 4. Missing file or roomId ─────────────────────────────────────────────

describe('POST /upload — required fields', () => {
  it('returns 400 when no file is attached', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/upload')
      .field('roomId', 'room-1');

    expect(res.status).toBe(400);
  });

  it('returns 400 when roomId is missing', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('PNG content'), {
        filename: 'photo.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(400);
  });
});
