/**
 * Security tests for src/routes/files.ts — CRIT gap coverage
 *
 * Guards tested:
 *   1. Path-traversal: filenames containing '..' or '/' are rejected with 400.
 *   2. Room-membership ACL: non-members cannot access room-scoped files (403).
 *   3. Members can access room-scoped files (served).
 *   4. Orphan files (no attachment record) return 404.
 *
 * Mutation-check intent:
 *   - Remove the traversal check (lines 101-103) → the '../' test fails with
 *     something other than 400 (DB lookup or sendFile attempt).
 *   - Remove the `!membership` → 403 branch → the non-member test gets 200.
 *
 * Auth: files.ts uses its own inline JWT verify (not authenticate middleware),
 * so we supply a real JWT signed with the test JWT_SECRET from jest.setup.js.
 */

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    agentToken: { findUnique: jest.fn() },
    messageAttachment: { findFirst: jest.fn() },
    roomParticipant: { findUnique: jest.fn() },
    taskAttachment: { findFirst: jest.fn() },
    projectAttachment: { findFirst: jest.fn() },
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { fileRoutes } from '../routes/files';

// ── helpers ──────────────────────────────────────────────────────────────────

// Uploads dir as resolved by files.ts:
//   files.ts lives at server/src/routes/files.ts → __dirname is server/src/routes
//   UPLOAD_DIR = path.resolve(__dirname, '../../uploads') = server/uploads
//
// This test lives at server/src/__tests__/, so from here the uploads dir is
// two levels up from __tests__ (not three): server/src/__tests__/../../uploads
// = server/uploads.
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
const TEST_FILENAME = '__jest_test_file__.txt';
const TEST_FILE_PATH = path.join(UPLOAD_DIR, TEST_FILENAME);

// A valid JWT signed with the test secret defined in jest.setup.js.
const VALID_JWT = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/files', fileRoutes);
  return app;
}

beforeAll(() => {
  // Create a tiny real file so res.sendFile succeeds in the "member served" test.
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(TEST_FILE_PATH, 'hello test');
});

afterAll(() => {
  try { fs.unlinkSync(TEST_FILE_PATH); } catch { /* ignore */ }
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: no attachment, no membership
  (prisma.messageAttachment.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.taskAttachment.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.projectAttachment.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue(null);
});

// ── 1. Path-traversal guard ────────────────────────────────────────────────

describe('GET /api/files/:filename — path-traversal guard', () => {
  it('returns 400 for filenames containing ".." (directory traversal)', async () => {
    // Mutation target: remove the traversal check → the request reaches the DB
    // layer or sendFile instead of returning 400 immediately.
    const app = buildApp();

    const res = await request(app)
      .get('/api/files/..%2Fetc%2Fpasswd')
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid filename/i);
  });

  it('returns 400 for filenames containing "/" (slash traversal)', async () => {
    const app = buildApp();

    // Express will decode the path before the handler receives it; using
    // encoded slashes to pass them as a filename rather than a path segment.
    const res = await request(app)
      .get('/api/files/' + encodeURIComponent('sub/file.txt'))
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid filename/i);
  });

  it('returns 400 for filenames with ".." embedded (alternate encoding)', async () => {
    const app = buildApp();

    const res = await request(app)
      .get('/api/files/' + encodeURIComponent('..\\etc\\passwd'))
      .set('Authorization', `Bearer ${VALID_JWT}`);

    // Backslash triggers the '\\' check in the guard.
    expect(res.status).toBe(400);
  });
});

// ── 2. Missing file → 404 ─────────────────────────────────────────────────

describe('GET /api/files/:filename — missing file', () => {
  it('returns 404 for a filename that does not exist on disk', async () => {
    const app = buildApp();

    const res = await request(app)
      .get('/api/files/totally-nonexistent-uuid-filename.png')
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(404);
  });
});

// ── 3. Room-membership ACL ────────────────────────────────────────────────

describe('GET /api/files/:filename — room-membership ACL', () => {
  it('returns 403 for a non-member trying to access a room file', async () => {
    // Mutation target: remove `if (!membership) return 403` → non-member gets 200.
    (prisma.messageAttachment.findFirst as jest.Mock).mockResolvedValue({
      message: { roomId: 'room-1' },
    });
    // no membership row → findUnique returns null
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a member/i);
  });

  it('serves the file (200) when the user is a member of the room', async () => {
    (prisma.messageAttachment.findFirst as jest.Mock).mockResolvedValue({
      message: { roomId: 'room-1' },
    });
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      roomId: 'room-1',
    });
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(200);
  });
});

// ── 4. Orphan file → 404 ─────────────────────────────────────────────────

describe('GET /api/files/:filename — orphan file', () => {
  it('returns 404 when the file has no attachment record (orphan)', async () => {
    // All attachment lookups return null — file is not linked to any room/task/project.
    (prisma.messageAttachment.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.taskAttachment.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.projectAttachment.findFirst as jest.Mock).mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(404);
  });
});

// ── 5. Unauthenticated → 401 ─────────────────────────────────────────────

describe('GET /api/files/:filename — auth requirement', () => {
  it('returns 401 when no Authorization header is provided', async () => {
    const app = buildApp();

    const res = await request(app).get(`/api/files/${TEST_FILENAME}`);

    expect(res.status).toBe(401);
  });
});

// ── 6. BYOA agent-token auth path (Follow-up to PR #168, residual gap) ────
//
// resolveUserId() has a dedicated branch for `Authorization: Bearer byoa_...`
// (lines ~46-56) that looks up the token in prisma.agentToken and only
// resolves a userId when the agent is `status === 'active' && isActive`.
//
// Mutation-check intent:
//   - Weaken `agent.status === 'active' && agent.isActive` (e.g. to just
//     `if (agent)`) → the "inactive agent" test below would get 200 instead
//     of 401, because a pending/deactivated agent's userId would be trusted.

const BYOA_TOKEN = 'byoa_testtoken1234567890';

describe('GET /api/files/:filename — BYOA agent-token auth', () => {
  it('returns 401 when the byoa_ token is not found in the DB', async () => {
    (prisma.agentToken.findUnique as jest.Mock).mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${BYOA_TOKEN}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it('returns 401 when the byoa_ agent is not active (pending approval)', async () => {
    // Mutation target: removing the `status === 'active' && isActive` check
    // would let this pending agent's userId through, turning the room ACL
    // check into a 200 (member) or 403 (non-member) instead of a 401.
    (prisma.agentToken.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      status: 'pending',
      isActive: true,
    });
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${BYOA_TOKEN}`);

    expect(res.status).toBe(401);
  });

  it('returns 401 when the byoa_ agent has been deactivated (isActive: false)', async () => {
    (prisma.agentToken.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      status: 'active',
      isActive: false,
    });
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${BYOA_TOKEN}`);

    expect(res.status).toBe(401);
  });

  it('resolves the agent userId and serves the file when the byoa_ token is active', async () => {
    (prisma.agentToken.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      status: 'active',
      isActive: true,
    });
    (prisma.messageAttachment.findFirst as jest.Mock).mockResolvedValue({
      message: { roomId: 'room-1' },
    });
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      roomId: 'room-1',
    });
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${BYOA_TOKEN}`);

    expect(res.status).toBe(200);
  });

  it('still enforces room ACL for an active byoa_ agent that is not a room member', async () => {
    (prisma.agentToken.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-agent',
      status: 'active',
      isActive: true,
    });
    (prisma.messageAttachment.findFirst as jest.Mock).mockResolvedValue({
      message: { roomId: 'room-1' },
    });
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${BYOA_TOKEN}`);

    expect(res.status).toBe(403);
  });
});

// ── 7. ?token= query fallback (browser <img src>) ─────────────────────────
//
// Mutation-check intent:
//   - Remove the `if (!req.headers.authorization && req.query.token)`
//     fallback → both tests below would get 401 instead of 200/401 via the
//     query-derived auth (the first would regress to 401 since no header
//     is set; distinguishable from removing the traversal/ACL guards, this
//     mutation is exercised directly by the "valid JWT" case going red).

describe('GET /api/files/:filename — ?token= query fallback', () => {
  it('accepts a valid JWT supplied via ?token= when no Authorization header is present', async () => {
    (prisma.messageAttachment.findFirst as jest.Mock).mockResolvedValue({
      message: { roomId: 'room-1' },
    });
    (prisma.roomParticipant.findUnique as jest.Mock).mockResolvedValue({
      userId: 'user-1',
      roomId: 'room-1',
    });
    const app = buildApp();

    const res = await request(app).get(`/api/files/${TEST_FILENAME}?token=${VALID_JWT}`);

    expect(res.status).toBe(200);
  });

  it('returns 401 for an invalid token supplied via ?token=', async () => {
    const app = buildApp();

    const res = await request(app).get(`/api/files/${TEST_FILENAME}?token=not-a-valid-jwt`);

    expect(res.status).toBe(401);
  });

  it('prefers the Authorization header over ?token= when both are present', async () => {
    // Header carries an invalid token, query carries a valid one — the
    // fallback only fires `if (!req.headers.authorization)`, so the header
    // (invalid) must win and the request must be rejected.
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}?token=${VALID_JWT}`)
      .set('Authorization', 'Bearer not-a-valid-jwt');

    expect(res.status).toBe(401);
  });
});
