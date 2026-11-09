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
 *   - Remove the traversal check (`isSafeFilename`) → the '../' test fails
 *     with something other than 400 (DB lookup or sendFile attempt).
 *   - Make the message decision ignore `memberOf.has(d.roomId)` → the
 *     non-member test gets 200.
 *
 * Auth: GET uses its own inline JWT verify (not authenticate middleware), so
 * we supply a real JWT signed with the test JWT_SECRET from jest.setup.js.
 * POST /tokens uses the real authenticate middleware over the mocked prisma.
 */

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    agentToken: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn() },
    messageAttachment: { findFirst: jest.fn(), findMany: jest.fn() },
    roomParticipant: { findUnique: jest.fn(), findMany: jest.fn() },
    taskAttachment: { findFirst: jest.fn(), findMany: jest.fn() },
    projectAttachment: { findFirst: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import request from './helpers/loopbackRequest';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { fileRoutes, authorizeFileAccessBatchForTest } from '../routes/files';
import { mintFileToken, mintOAuthStartToken } from '../lib/scopedToken';

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


// ── ACL mock helpers ─────────────────────────────────────────────────────────

type UrlQuery = { where: { url: { in: string[] } } };

// One stored row answers for every requested url (null: the table has no row).
function mockTable(model: jest.Mock | unknown, row: Record<string, unknown> | null) {
  (model as jest.Mock).mockImplementation(async ({ where }: UrlQuery) =>
    row ? where.url.in.map((url) => ({ url, ...row })) : [],
  );
}

// The user is a member of exactly these rooms (any user id).
function mockMembership(roomIds: string[]) {
  (prisma.roomParticipant.findMany as jest.Mock).mockImplementation(
    async ({ where }: { where: { roomId: { in: string[] } } }) =>
      where.roomId.in.filter((r) => roomIds.includes(r)).map((roomId) => ({ roomId })),
  );
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
  mockTable(prisma.messageAttachment.findMany, null);
  mockTable(prisma.taskAttachment.findMany, null);
  mockTable(prisma.projectAttachment.findMany, null);
  mockMembership([]);
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
    // The route's own JSON body, not Express' default HTML 404.
    expect(res.body).toEqual({ error: 'File not found' });
  });
});

// ── 3. Room-membership ACL ────────────────────────────────────────────────

describe('GET /api/files/:filename — room-membership ACL', () => {
  it('returns 403 for a non-member trying to access a room file', async () => {
    // Mutation target: ignore `memberOf.has(d.roomId)` in the batch resolver → non-member gets 200.
    mockTable(prisma.messageAttachment.findMany, {
      message: { roomId: 'room-1' },
    });
    // no membership row → findMany returns no rows
    mockMembership([]);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a member/i);
  });

  it('serves the file (200) when the user is a member of the room', async () => {
    mockTable(prisma.messageAttachment.findMany, {
      message: { roomId: 'room-1' },
    });
    mockMembership(['room-1']);
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
    mockTable(prisma.messageAttachment.findMany, null);
    mockTable(prisma.taskAttachment.findMany, null);
    mockTable(prisma.projectAttachment.findMany, null);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(404);
    // The route's own JSON body, not Express' default HTML 404.
    expect(res.body).toEqual({ error: 'File not found' });
  });
});

// ── 5. Task/project attachment ACLs ───────────────────────────────────────

describe('GET /api/files/:filename — task/project attachment ACL', () => {
  it('returns 403 for a user outside a task attachment project', async () => {
    mockTable(prisma.taskAttachment.findMany, {
      mimeType: 'image/png',
      filename: 'task.png',
      task: {
        project: {
          ownerId: 'another-user',
          teamMemberIds: [],
          roomId: null,
        },
      },
    });
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  it('returns 403 for a user outside a project attachment project', async () => {
    mockTable(prisma.projectAttachment.findMany, {
      mimeType: 'image/png',
      filename: 'project.png',
      project: {
        ownerId: 'another-user',
        teamMemberIds: [],
        roomId: null,
      },
    });
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not allowed/i);
  });
});

// ── 6. Unauthenticated → 401 ─────────────────────────────────────────────

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
    mockTable(prisma.messageAttachment.findMany, {
      message: { roomId: 'room-1' },
    });
    mockMembership(['room-1']);
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
    mockTable(prisma.messageAttachment.findMany, {
      message: { roomId: 'room-1' },
    });
    mockMembership([]);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${BYOA_TOKEN}`);

    expect(res.status).toBe(403);
  });
});

// ── 7. File-scoped token in ?ft= (browser <img src> / <a href>) ───────────
//
// The session JWT is never accepted in the query. A file token is minted for
// one stored file name and one user (HMAC, 5 minute default), and the ACL and
// the user's active flag are re-checked on every request.
//
// Mutation-check intent:
//   - Drop the `verifyFileToken` call in resolveUserId (or accept `?token=`
//     as an Authorization header again) → the session-JWT-in-query tests go
//     red (200 instead of 401).
//   - Change the subject passed to verifyFileToken (e.g. a constant) → the
//     "token for file A is refused for file B" test goes red.
//   - Skip the expiry check in verifyScopedToken → the expired-token test
//     goes red (see scopedToken.test.ts for the signature/compare mutants).
//   - Drop the `isActive` check → the deactivated-user test goes red.
//   - Cache the ACL decision at issue time instead of calling
//     authorizeFileAccess on serve → the lost-membership test goes red.

describe('GET /api/files/:filename, ?ft= file token', () => {
  const OTHER_FILENAME = '__jest_test_file_other__.txt';
  const OTHER_PATH = path.join(UPLOAD_DIR, OTHER_FILENAME);

  beforeAll(() => {
    fs.writeFileSync(OTHER_PATH, 'other');
  });

  afterAll(() => {
    try {
      fs.unlinkSync(OTHER_PATH);
    } catch {
      /* ignore */
    }
  });

  beforeEach(() => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ isActive: true });
    mockTable(prisma.messageAttachment.findMany, {
      mimeType: 'text/plain',
      filename: 'x.txt',
      message: { roomId: 'room-1' },
    });
    // Membership is per user: only user-1 is in room-1.
    (prisma.roomParticipant.findMany as jest.Mock).mockImplementation(
      async ({ where }: { where: { userId: string; roomId: { in: string[] } } }) =>
        where.userId === 'user-1' ? where.roomId.in.filter((r) => r === 'room-1').map((roomId) => ({ roomId })) : [],
    );
  });

  it('serves the file for a valid token bound to this file and user', async () => {
    const { token } = mintFileToken(TEST_FILENAME, 'user-1');

    const res = await request(buildApp()).get(`/api/files/${TEST_FILENAME}?ft=${token}`);

    expect(res.status).toBe(200);
  });

  it('refuses a token minted for file A when it is used for file B', async () => {
    const { token } = mintFileToken(TEST_FILENAME, 'user-1');

    const res = await request(buildApp()).get(`/api/files/${OTHER_FILENAME}?ft=${token}`);

    expect(res.status).toBe(401);
  });

  it('refuses an expired token', async () => {
    const { token } = mintFileToken(TEST_FILENAME, 'user-1', Date.now() - 10 * 60 * 1000);

    const res = await request(buildApp()).get(`/api/files/${TEST_FILENAME}?ft=${token}`);

    expect(res.status).toBe(401);
  });

  it('refuses a token with a bad signature', async () => {
    const { token } = mintFileToken(TEST_FILENAME, 'user-1');
    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');

    const res = await request(buildApp()).get(`/api/files/${TEST_FILENAME}?ft=${tampered}`);

    expect(res.status).toBe(401);
  });

  it('binds the token to its user: swapping the user id in a valid token is refused', async () => {
    const parts = mintFileToken(TEST_FILENAME, 'user-1').token.split('.');
    parts[1] = Buffer.from('user-2', 'utf8').toString('base64url');

    const res = await request(buildApp()).get(`/api/files/${TEST_FILENAME}?ft=${parts.join('.')}`);

    expect(res.status).toBe(401);
  });

  it('applies the room ACL to the token user: a token minted for a non-member gets 403', async () => {
    const { token } = mintFileToken(TEST_FILENAME, 'user-2');

    const res = await request(buildApp()).get(`/api/files/${TEST_FILENAME}?ft=${token}`);

    expect(res.status).toBe(403);
  });

  it('checks membership at request time: a token issued before the user left the room gets 403', async () => {
    const { token } = mintFileToken(TEST_FILENAME, 'user-1');
    const app = buildApp();
    expect((await request(app).get(`/api/files/${TEST_FILENAME}?ft=${token}`)).status).toBe(200);

    mockMembership([]);
    const res = await request(app).get(`/api/files/${TEST_FILENAME}?ft=${token}`);

    expect(res.status).toBe(403);
  });

  it('refuses a valid token once the user is deactivated', async () => {
    const { token } = mintFileToken(TEST_FILENAME, 'user-1');
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ isActive: false });

    const res = await request(buildApp()).get(`/api/files/${TEST_FILENAME}?ft=${token}`);

    expect(res.status).toBe(401);
  });

  it('refuses a token whose user no longer exists', async () => {
    const { token } = mintFileToken(TEST_FILENAME, 'user-1');
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await request(buildApp()).get(`/api/files/${TEST_FILENAME}?ft=${token}`);

    expect(res.status).toBe(401);
  });

  it('refuses the session JWT in ?token= and never reaches the ACL', async () => {
    const res = await request(buildApp()).get(`/api/files/${TEST_FILENAME}?token=${VALID_JWT}`);

    expect(res.status).toBe(401);
    expect(prisma.messageAttachment.findMany).not.toHaveBeenCalled();
  });

  it('refuses a byoa_ token in ?token=', async () => {
    const res = await request(buildApp()).get(`/api/files/${TEST_FILENAME}?token=byoa_some_agent_token`);

    expect(res.status).toBe(401);
    expect(prisma.agentToken.findUnique).not.toHaveBeenCalled();
  });

  it('refuses the session JWT when it is sent as the file token (?ft=)', async () => {
    const res = await request(buildApp()).get(`/api/files/${TEST_FILENAME}?ft=${VALID_JWT}`);

    expect(res.status).toBe(401);
  });

  it('refuses a token minted for another purpose (OAuth start)', async () => {
    const { token } = mintOAuthStartToken('microsoft', TEST_FILENAME, 'user-1');

    const res = await request(buildApp()).get(`/api/files/${TEST_FILENAME}?ft=${token}`);

    expect(res.status).toBe(401);
  });

  it('returns 401 for a malformed ?ft=', async () => {
    const res = await request(buildApp()).get(`/api/files/${TEST_FILENAME}?ft=not-a-token`);

    expect(res.status).toBe(401);
  });

  it.each(['Basic dXNlcjpwdw==', 'Token abc', 'bearer lowercase-scheme'])(
    'ignores ?ft= whenever any Authorization header is present (%s): the header decides, and an unusable one is 401',
    async (header) => {
      const { token } = mintFileToken(TEST_FILENAME, 'user-1');

      const res = await request(buildApp())
        .get(`/api/files/${TEST_FILENAME}?ft=${token}`)
        .set('Authorization', header);

      expect(res.status).toBe(401);
    },
  );

  it('prefers the Authorization header over ?ft= when both are present', async () => {
    // The header carries an invalid token, the query a valid file token: the
    // header decides, so the request is rejected.
    const { token } = mintFileToken(TEST_FILENAME, 'user-1');

    const res = await request(buildApp())
      .get(`/api/files/${TEST_FILENAME}?ft=${token}`)
      .set('Authorization', 'Bearer not-a-valid-jwt');

    expect(res.status).toBe(401);
  });
});

// ── 7b. POST /api/files/tokens (issue) ────────────────────────────────────

describe('POST /api/files/tokens', () => {
  beforeEach(() => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'user-1',
      username: 'u1',
      userType: 'HUMAN',
      displayName: 'U1',
      isAdmin: false,
      isActive: true,
      canTriggerAI: false,
    });
    (prisma.messageAttachment.findMany as jest.Mock).mockImplementation(async ({ where }: UrlQuery) =>
      where.url.in
        .filter((url) => url === `/uploads/${TEST_FILENAME}`)
        .map((url) => ({ url, mimeType: 'text/plain', filename: 'x.txt', message: { roomId: 'room-1' } })),
    );
    mockMembership(['room-1']);
  });

  it('requires authentication', async () => {
    const res = await request(buildApp()).post('/api/files/tokens').send({ filenames: [TEST_FILENAME] });

    expect(res.status).toBe(401);
  });

  it('issues a token that the file route accepts, and never contains the session JWT', async () => {
    const app = buildApp();

    const issued = await request(app)
      .post('/api/files/tokens')
      .set('Authorization', `Bearer ${VALID_JWT}`)
      .send({ filenames: [TEST_FILENAME] });

    expect(issued.status).toBe(200);
    const entry = issued.body.tokens[TEST_FILENAME];
    expect(entry.token).not.toContain(VALID_JWT);
    expect(entry.expiresIn).toBeGreaterThan(0);
    expect(entry.expiresIn).toBeLessThanOrEqual(300);
    expect(issued.body.denied).toEqual([]);

    const served = await request(app).get(`/api/files/${TEST_FILENAME}?ft=${entry.token}`);
    expect(served.status).toBe(200);
  });

  it('returns the same token for the same file and user inside one expiry bucket (stable URL)', async () => {
    const app = buildApp();
    // Pin the clock mid-bucket so the two mints cannot straddle a bucket edge.
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Math.floor(Date.now() / 60000) * 60000 + 10_000);
    const send = () =>
      request(app)
        .post('/api/files/tokens')
        .set('Authorization', `Bearer ${VALID_JWT}`)
        .send({ filenames: [TEST_FILENAME] });

    const [a, b] = [await send(), await send()];
    nowSpy.mockRestore();

    expect(a.body.tokens[TEST_FILENAME].token).toBe(b.body.tokens[TEST_FILENAME].token);
  });

  it('issues no token for a file the user cannot access (non-member), an orphan file, or a traversal name', async () => {
    mockMembership([]);
    const app = buildApp();

    const res = await request(app)
      .post('/api/files/tokens')
      .set('Authorization', `Bearer ${VALID_JWT}`)
      .send({ filenames: [TEST_FILENAME, 'orphan.png', '../etc/passwd'] });

    expect(res.status).toBe(200);
    expect(res.body.tokens).toEqual({});
    expect(res.body.denied.sort()).toEqual(['../etc/passwd', 'orphan.png', TEST_FILENAME].sort());
  });

  it('accepts exactly 50 file names in one request (the limit is inclusive) and issues a token for each allowed one', async () => {
    const names = Array.from({ length: 50 }, (_v, i) => (i === 0 ? TEST_FILENAME : `orphan-${i}.png`));

    const res = await request(buildApp())
      .post('/api/files/tokens')
      .set('Authorization', `Bearer ${VALID_JWT}`)
      .send({ filenames: names });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.tokens)).toEqual([TEST_FILENAME]);
    expect(res.body.denied).toHaveLength(49);
  });

  it('does not look a traversal name up at all (no ACL query for it)', async () => {
    const res = await request(buildApp())
      .post('/api/files/tokens')
      .set('Authorization', `Bearer ${VALID_JWT}`)
      .send({ filenames: ['../uploads/x.png', 'a/b.png', 'a\\b.png'] });

    expect(res.status).toBe(200);
    expect(res.body.denied).toHaveLength(3);
    expect(prisma.messageAttachment.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['no body', undefined],
    ['filenames not an array', { filenames: TEST_FILENAME }],
    ['empty array', { filenames: [] }],
    ['non-string entry', { filenames: [1] }],
    ['too many entries', { filenames: Array.from({ length: 51 }, (_v, i) => `f${i}.png`) }],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await request(buildApp())
      .post('/api/files/tokens')
      .set('Authorization', `Bearer ${VALID_JWT}`)
      .send(body as object);

    expect(res.status).toBe(400);
  });
});

// ── 8. Content-Type from stored mimetype, not on-disk extension (2fec600d) ──
//
// The on-disk filename's extension comes from the user-controlled
// `originalname` (see upload.ts's `filename` storage callback), while the
// MIME allowlist validates `file.mimetype`. A bare `res.sendFile(filePath)`
// lets `send`/express derive Content-Type from that on-disk extension, so an
// upload declared (and stored) as text/plain but saved with an on-disk
// `.html` extension would be served as text/html — usable to get
// script-executing HTML rendered on this app's own origin.
//
// Mutation-check intent:
//   - Revert either serveStoredFile() call site back to bare
//     `res.sendFile(filePath)` → the "x.html served as text/plain" test
//     fails (content-type reverts to text/html for the .html-named file).
//   - Drop the `X-Content-Type-Options: nosniff` header for non-inline-safe
//     types → the nosniff assertion fails.

describe('GET /api/files/:filename — Content-Type from stored mimetype, not extension', () => {
  const HTML_EXT_FILENAME = '__jest_test_file_html_ext__.html';
  const HTML_EXT_PATH = path.join(UPLOAD_DIR, HTML_EXT_FILENAME);

  beforeAll(() => {
    fs.writeFileSync(HTML_EXT_PATH, '<html><body>should never be sniffed as html</body></html>');
  });

  afterAll(() => {
    try {
      fs.unlinkSync(HTML_EXT_PATH);
    } catch {
      /* ignore */
    }
  });

  it('serves an upload stored as text/plain with an on-disk .html name as text/plain, never text/html, as an attachment with nosniff', async () => {
    mockTable(prisma.messageAttachment.findMany, {
      mimeType: 'text/plain',
      filename: 'notes.html',
      message: { roomId: 'room-1' },
    });
    mockMembership(['room-1']);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${HTML_EXT_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['content-type']).not.toMatch(/html/);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('still renders an image upload inline with its stored mimetype (no forced download)', async () => {
    mockTable(prisma.messageAttachment.findMany, {
      mimeType: 'image/png',
      filename: 'photo.png',
      message: { roomId: 'room-1' },
    });
    mockMembership(['room-1']);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  // Mutation-check intent:
  //   - Weaken the allowlist back to a `mimeType.startsWith('image/')` prefix
  //     match → this legacy `image/svg+xml` row would render inline again
  //     instead of being forced to download with nosniff.
  it('forces a legacy image/svg+xml-stored upload to download with nosniff, never inline', async () => {
    mockTable(prisma.messageAttachment.findMany, {
      mimeType: 'image/svg+xml',
      filename: 'legacy.svg',
      message: { roomId: 'room-1' },
    });
    mockMembership(['room-1']);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  // A row with no stored mimetype (legacy data predating the mimeType
  // column, or a NULL value) must still fail safe: fall back to
  // application/octet-stream, forced download, nosniff.
  it('falls back to application/octet-stream, attachment and nosniff for a NULL stored mimeType', async () => {
    mockTable(prisma.messageAttachment.findMany, {
      mimeType: null,
      filename: 'mystery-file',
      message: { roomId: 'room-1' },
    });
    mockMembership(['room-1']);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/octet-stream/);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  // Mutation-check intent: dropping the `filename*=` RFC
  // 5987 parameter would lose the real (non-ASCII) display filename; the
  // ASCII `filename` fallback alone replaces every non-ASCII code point
  // with `_`, which this assertion on `filename*=` would catch going missing.
  it("carries the display filename's non-ASCII characters via filename*=UTF-8''", async () => {
    mockTable(prisma.messageAttachment.findMany, {
      mimeType: 'text/plain',
      filename: 'résumé.txt',
      message: { roomId: 'room-1' },
    });
    mockMembership(['room-1']);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('résumé.txt')}`,
    );
  });

  // Mutation-check intent: the taskAttachment and projectAttachment
  // decisions (all served through the one serveStoredFile call) had each
  // reverted independently to a bare `res.sendFile(filePath)` and survived
  // the suite, since only the messageAttachment site was covered. These two
  // cases pin each of the other two sites the same way the message-
  // attachment case above does.
  it('serves a task-attachment upload with its stored mimetype, never the on-disk extension', async () => {
    mockTable(prisma.messageAttachment.findMany, null);
    mockTable(prisma.taskAttachment.findMany, {
      mimeType: 'text/plain',
      filename: 'notes.html',
      task: {
        project: {
          ownerId: 'user-1',
          teamMemberIds: [],
          roomId: null,
        },
      },
    });
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${HTML_EXT_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['content-type']).not.toMatch(/html/);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves a project-attachment upload with its stored mimetype, never the on-disk extension', async () => {
    mockTable(prisma.messageAttachment.findMany, null);
    mockTable(prisma.taskAttachment.findMany, null);
    mockTable(prisma.projectAttachment.findMany, {
      mimeType: 'text/plain',
      filename: 'notes.html',
      project: {
        ownerId: 'user-1',
        teamMemberIds: [],
        roomId: null,
      },
    });
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${HTML_EXT_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['content-type']).not.toMatch(/html/);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  // Mutation-check intent: dropping the quote/backslash replace in
  // sanitizeForContentDisposition would let a stored display filename
  // carrying an unescaped `"` or `\` unbalance the quoted `filename=` value
  // (e.g. `filename="he said "hi"\bad.txt"`), which this assertion on the
  // full quoted-value shape would catch going missing.
  it('strips quotes and backslashes from the ASCII filename inside the quoted Content-Disposition value', async () => {
    mockTable(prisma.messageAttachment.findMany, {
      mimeType: 'text/plain',
      filename: 'he said "hi"\\bad.txt',
      message: { roomId: 'room-1' },
    });
    mockMembership(['room-1']);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(200);
    const header = res.headers['content-disposition'];
    expect(header).toMatch(/^attachment/);
    expect(header).toMatch(/^attachment; filename="[^"\\]*";/);
  });

  // Mutation-check intent: reverting encodeExtValueForContentDisposition to
  // bare encodeURIComponent leaves `'`, `(` and `)` unescaped in the
  // `filename*=UTF-8''...` extended value; express's own strict
  // content-disposition parser rejects that as an invalid extended field
  // value, which this assertion (checked against the literal percent-encoded
  // string, since `content-disposition` is a transitive dependency here, not
  // a declared one) would catch going missing.
  it("percent-encodes apostrophes and parentheses in the filename*=UTF-8'' extended value", async () => {
    mockTable(prisma.messageAttachment.findMany, {
      mimeType: 'text/plain',
      filename: "o'brien (final).txt",
      message: { roomId: 'room-1' },
    });
    mockMembership(['room-1']);
    const app = buildApp();

    const res = await request(app)
      .get(`/api/files/${TEST_FILENAME}`)
      .set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(200);
    const header = res.headers['content-disposition'];
    expect(header).toMatch(/^attachment/);
    expect(header).not.toMatch(/filename\*=UTF-8''[^;]*['()]/);
    expect(header).toContain("filename*=UTF-8''o%27brien%20%28final%29.txt");
  });
});

// ── 9. Batched ACL: bounded query count, precedence, duplicates ───────────────
//
// A small in-memory stand-in for the four tables, answering the findMany
// calls the ACL makes (url filter, orderBy id, userId + roomId filter).

describe('file ACL batch resolver (POST /tokens and GET share it)', () => {
  type Row = {
    id: string;
    mimeType?: string;
    filename?: string;
    roomId?: string;
    project?: { ownerId: string; teamMemberIds: string[]; roomId: string | null };
  };
  let db: {
    message: Record<string, Row[]>;
    task: Record<string, Row[]>;
    project: Record<string, Row[]>;
    members: Record<string, string[]>;
  };

  const u = (name: string) => `/uploads/${name}`;
  const OTHER_PROJECT = { ownerId: 'someone-else', teamMemberIds: [] as string[], roomId: 'room-p' };
  const OWN_PROJECT = { ownerId: 'user-1', teamMemberIds: [] as string[], roomId: 'room-p' };

  function answer(table: Record<string, Row[]>, shape: (r: Row) => object) {
    return async ({ where, orderBy }: { where: { url: { in: string[] } }; orderBy?: { id: 'asc' } }) => {
      const out: object[] = [];
      for (const url of where.url.in) {
        const rows = [...(table[url] ?? [])];
        if (orderBy?.id === 'asc') rows.sort((a, b) => (a.id < b.id ? -1 : 1));
        for (const r of rows) out.push({ url, mimeType: r.mimeType ?? null, filename: r.filename ?? null, ...shape(r) });
      }
      return out;
    };
  }

  const calls = () => ({
    message: (prisma.messageAttachment.findMany as jest.Mock).mock.calls.length,
    task: (prisma.taskAttachment.findMany as jest.Mock).mock.calls.length,
    project: (prisma.projectAttachment.findMany as jest.Mock).mock.calls.length,
    room: (prisma.roomParticipant.findMany as jest.Mock).mock.calls.length,
  });
  const total = () => Object.values(calls()).reduce((a, b) => a + b, 0);

  function expectNoSingleLookups() {
    expect(prisma.messageAttachment.findFirst).not.toHaveBeenCalled();
    expect(prisma.taskAttachment.findFirst).not.toHaveBeenCalled();
    expect(prisma.projectAttachment.findFirst).not.toHaveBeenCalled();
    expect(prisma.roomParticipant.findUnique).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    db = { message: {}, task: {}, project: {}, members: { 'user-1': ['room-1'] } };
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'user-1', username: 'u1', userType: 'HUMAN', displayName: 'U1', isAdmin: false, isActive: true, canTriggerAI: false,
    });
    (prisma.messageAttachment.findMany as jest.Mock).mockImplementation(
      answer(db.message, (r) => ({ message: { roomId: r.roomId } })),
    );
    (prisma.taskAttachment.findMany as jest.Mock).mockImplementation(
      answer(db.task, (r) => ({ task: { project: r.project } })),
    );
    (prisma.projectAttachment.findMany as jest.Mock).mockImplementation(
      answer(db.project, (r) => ({ project: r.project })),
    );
    (prisma.roomParticipant.findMany as jest.Mock).mockImplementation(
      async ({ where }: { where: { userId: string; roomId: { in: string[] } } }) =>
        where.roomId.in.filter((r) => (db.members[where.userId] ?? []).includes(r)).map((roomId) => ({ roomId })),
    );
  });

  const mint = (names: string[]) =>
    request(buildApp()).post('/api/files/tokens').set('Authorization', `Bearer ${VALID_JWT}`).send({ filenames: names });
  const names = (prefix: string, n = 50) => Array.from({ length: n }, (_v, i) => `${prefix}-${i}.png`);

  it('50 message attachments: 2 queries (message table, one membership lookup), later tables skipped', async () => {
    const list = names('m');
    list.forEach((n) => (db.message[u(n)] = [{ id: 'a', roomId: 'room-1' }]));

    const res = await mint(list);

    expect(Object.keys(res.body.tokens)).toHaveLength(50);
    expect(res.body.denied).toEqual([]);
    expect(calls()).toEqual({ message: 1, task: 0, project: 0, room: 1 });
    expectNoSingleLookups();
  });

  it('50 task attachments in a project the user does not own: 3 queries', async () => {
    const list = names('t');
    list.forEach((n) => (db.task[u(n)] = [{ id: 'a', project: { ...OTHER_PROJECT, roomId: 'room-1' } }]));

    const res = await mint(list);

    expect(Object.keys(res.body.tokens)).toHaveLength(50);
    expect(calls()).toEqual({ message: 1, task: 1, project: 0, room: 1 });
    expectNoSingleLookups();
  });

  it('50 project attachments: 4 queries (the upper bound)', async () => {
    const list = names('p');
    list.forEach((n) => (db.project[u(n)] = [{ id: 'a', project: { ...OTHER_PROJECT, roomId: 'room-1' } }]));

    const res = await mint(list);

    expect(Object.keys(res.body.tokens)).toHaveLength(50);
    expect(calls()).toEqual({ message: 1, task: 1, project: 1, room: 1 });
    expect(total()).toBe(4);
    expectNoSingleLookups();
  });

  it('50 names without any attachment row: 3 queries, all denied, no membership lookup', async () => {
    const res = await mint(names('x'));

    expect(res.body.tokens).toEqual({});
    expect(res.body.denied).toHaveLength(50);
    expect(calls()).toEqual({ message: 1, task: 1, project: 1, room: 0 });
    expectNoSingleLookups();
  });

  it('owner and team member of the project need no membership lookup (owner shortcut)', async () => {
    db.task[u('own.png')] = [{ id: 'a', project: OWN_PROJECT }];
    db.project[u('team.png')] = [
      { id: 'a', project: { ownerId: 'someone-else', teamMemberIds: ['user-1'], roomId: 'room-p' } },
    ];

    const res = await mint(['own.png', 'team.png']);

    expect(Object.keys(res.body.tokens).sort()).toEqual(['own.png', 'team.png']);
    expect(calls().room).toBe(0);
    expect(total()).toBe(3);
  });

  it('a non-owner project without a linked room is denied without a membership lookup', async () => {
    db.task[u('noroom.png')] = [{ id: 'a', project: { ...OTHER_PROJECT, roomId: null } }];

    const res = await mint(['noroom.png']);

    expect(res.body.denied).toEqual(['noroom.png']);
    expect(calls().room).toBe(0);
  });

  it('the membership lookup is for this user and only for rooms that need a check', async () => {
    db.message[u('m.png')] = [{ id: 'a', roomId: 'room-1' }];
    db.task[u('owned.png')] = [{ id: 'a', project: { ...OWN_PROJECT, roomId: 'room-skip' } }];
    db.project[u('other.png')] = [{ id: 'a', project: { ...OTHER_PROJECT, roomId: 'room-p' } }];

    await mint(['m.png', 'owned.png', 'other.png']);

    const [arg] = (prisma.roomParticipant.findMany as jest.Mock).mock.calls[0];
    expect(arg.where.userId).toBe('user-1');
    expect([...arg.where.roomId.in].sort()).toEqual(['room-1', 'room-p']);
  });

  it('a membership in someone else\'s rooms does not allow (membership is per user)', async () => {
    db.members = { 'user-2': ['room-1'] };
    db.message[u('m.png')] = [{ id: 'a', roomId: 'room-1' }];

    const res = await mint(['m.png']);

    expect(res.body.denied).toEqual(['m.png']);
  });

  it('a 50-name mixed request: per-name results and at most 4 queries', async () => {
    const expected: Record<string, boolean> = {};
    for (let i = 0; i < 50; i++) {
      const n = `mix-${i}.png`;
      switch (i % 10) {
        case 0: db.message[u(n)] = [{ id: 'a', roomId: 'room-1' }]; expected[n] = true; break;
        case 1: db.message[u(n)] = [{ id: 'a', roomId: 'room-9' }]; expected[n] = false; break;
        case 2: db.task[u(n)] = [{ id: 'a', project: OWN_PROJECT }]; expected[n] = true; break;
        case 3: db.task[u(n)] = [{ id: 'a', project: OTHER_PROJECT }]; expected[n] = false; break;
        case 4: db.task[u(n)] = [{ id: 'a', project: { ...OTHER_PROJECT, roomId: 'room-1' } }]; expected[n] = true; break;
        case 5: db.project[u(n)] = [{ id: 'a', project: OWN_PROJECT }]; expected[n] = true; break;
        case 6: db.project[u(n)] = [{ id: 'a', project: OTHER_PROJECT }]; expected[n] = false; break;
        case 7: db.project[u(n)] = [{ id: 'a', project: { ...OTHER_PROJECT, roomId: 'room-1' } }]; expected[n] = true; break;
        default: expected[n] = false; // no row
      }
    }

    const res = await mint(Object.keys(expected));

    expect(res.status).toBe(200);
    for (const [n, allowed] of Object.entries(expected)) {
      expect(Boolean(res.body.tokens[n])).toBe(allowed);
      expect(res.body.denied.includes(n)).toBe(!allowed);
    }
    expect(total()).toBeLessThanOrEqual(4);
    expectNoSingleLookups();
  });

  it('only names without a message row reach the task and project tables', async () => {
    db.message[u('m.png')] = [{ id: 'a', roomId: 'room-1' }];
    db.task[u('t.png')] = [{ id: 'a', project: OWN_PROJECT }];

    await mint(['m.png', 't.png', 'p.png']);

    const arg = (model: unknown, call = 0) => (model as jest.Mock).mock.calls[call][0].where.url.in;
    expect(arg(prisma.messageAttachment.findMany)).toEqual([u('m.png'), u('t.png'), u('p.png')]);
    expect(arg(prisma.taskAttachment.findMany)).toEqual([u('t.png'), u('p.png')]);
    expect(arg(prisma.projectAttachment.findMany)).toEqual([u('p.png')]);
  });

  it('table precedence: a message row in a room the user is not in denies even when a task row would allow', async () => {
    db.message[u('s.png')] = [{ id: 'a', roomId: 'room-9' }];
    db.task[u('s.png')] = [{ id: 'a', project: OWN_PROJECT }];
    db.project[u('s.png')] = [{ id: 'a', project: OWN_PROJECT }];

    const res = await mint(['s.png']);

    expect(res.body.denied).toEqual(['s.png']);
    expect(calls().task).toBe(0);
  });

  it('table precedence: a task row decides before a project row for the same url', async () => {
    db.task[u('s.png')] = [{ id: 'a', project: OTHER_PROJECT }];
    db.project[u('s.png')] = [{ id: 'a', project: OWN_PROJECT }];

    const res = await mint(['s.png']);

    expect(res.body.denied).toEqual(['s.png']);
  });

  it('duplicate rows in one table: the lowest id decides, whatever order the database returns', async () => {
    // Stored with the allowing row first: only the id order picks the denying row.
    db.message[u('d.png')] = [
      { id: 'b', roomId: 'room-1' },
      { id: 'a', roomId: 'room-9' },
    ];
    db.task[u('e.png')] = [
      { id: 'b', project: OWN_PROJECT },
      { id: 'a', project: OTHER_PROJECT },
    ];
    db.project[u('f.png')] = [
      { id: 'b', project: OWN_PROJECT },
      { id: 'a', project: OTHER_PROJECT },
    ];

    const res = await mint(['d.png', 'e.png', 'f.png']);

    expect(res.body.tokens).toEqual({});
    for (const model of [prisma.messageAttachment, prisma.taskAttachment, prisma.projectAttachment]) {
      expect((model.findMany as jest.Mock).mock.calls[0][0].orderBy).toEqual({ id: 'asc' });
    }
  });

  it('GET serves the metadata of the lowest-id row among duplicates', async () => {
    db.message[u(TEST_FILENAME)] = [
      { id: 'b', roomId: 'room-1', mimeType: 'image/png', filename: 'later.png' },
      { id: 'a', roomId: 'room-1', mimeType: 'text/plain', filename: 'first.txt' },
    ];

    const res = await request(buildApp()).get(`/api/files/${TEST_FILENAME}`).set('Authorization', `Bearer ${VALID_JWT}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['content-disposition']).toContain('first.txt');
    expect(calls()).toEqual({ message: 1, task: 0, project: 0, room: 1 });
    expectNoSingleLookups();
  });

  it('GET and mint agree on a denied name', async () => {
    db.message[u(TEST_FILENAME)] = [{ id: 'a', roomId: 'room-9' }];

    const got = await request(buildApp()).get(`/api/files/${TEST_FILENAME}`).set('Authorization', `Bearer ${VALID_JWT}`);
    const minted = await mint([TEST_FILENAME]);

    expect(got.status).toBe(403);
    expect(minted.body.denied).toEqual([TEST_FILENAME]);
  });

  it('duplicate names in one request are resolved once', async () => {
    db.message[u('m.png')] = [{ id: 'a', roomId: 'room-1' }];

    const res = await mint(['m.png', 'm.png']);

    expect(Object.keys(res.body.tokens)).toEqual(['m.png']);
    expect((prisma.messageAttachment.findMany as jest.Mock).mock.calls[0][0].where.url.in).toEqual([u('m.png')]);
  });

  it('traversal names alone run no query at all', async () => {
    const res = await mint(['../x.png', 'a/b.png', 'a\\b.png', '..']);

    expect(res.body.denied).toHaveLength(4);
    expect(total()).toBe(0);
    expectNoSingleLookups();
  });

  it('traversal names mixed with real ones are not part of any query', async () => {
    db.message[u('m.png')] = [{ id: 'a', roomId: 'room-1' }];

    await mint(['../x.png', 'm.png']);

    expect((prisma.messageAttachment.findMany as jest.Mock).mock.calls[0][0].where.url.in).toEqual([u('m.png')]);
  });
});

describe('authorizeFileAccessBatch with a missing identity', () => {
  it.each([undefined, ''])('denies every name and runs no query for userId %p', async (userId) => {
    jest.clearAllMocks();
    const result = await authorizeFileAccessBatchForTest(userId as unknown as string, ['a.png', 'b.png']);
    expect([...result.values()].every((r) => r.ok === false && r.status === 403)).toBe(true);
    expect(result.size).toBe(2);
    expect(prisma.messageAttachment.findMany).not.toHaveBeenCalled();
    expect(prisma.roomParticipant.findMany).not.toHaveBeenCalled();
  });
});
