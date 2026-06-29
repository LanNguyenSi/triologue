/**
 * Security tests for src/routes/secrets.ts — CRIT gap coverage
 *
 * Guards tested:
 *   1. Per-user ownership: GET /:id, PUT /:id, DELETE /:id each return 403
 *      when the requesting user is not the secret owner.
 *   2. Encrypt-on-write: POST and PUT with a new value must store an
 *      encrypted value (different from the plaintext input).
 *
 * Mutation-check intent:
 *   - Drop `if (secret.userId !== userId) return 403` from GET/PUT/DELETE →
 *     the non-owner test for that verb fails.
 *   - Remove the `encryptSecret(value, userId)` call in POST/PUT and store
 *     plaintext directly → the encrypt-on-write test fails.
 */

// Module-level variable injected into the mocked authenticate middleware.
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
    userSecret: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    project: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import request from 'supertest';
import prisma from '../lib/prisma';
import secretsRouter from '../routes/secrets';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/secrets', secretsRouter);
  return app;
}

// Fixture secrets
const OWNER_SECRET = {
  id: 'secret-1',
  userId: 'user-1',
  name: 'My Secret',
  encryptedValue: 'iv:cipher',
  description: 'test',
  projectId: null,
  project: null,
  lastUsedAt: null,
  lastUsedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const OTHER_USER_SECRET = {
  ...OWNER_SECRET,
  id: 'secret-2',
  userId: 'user-2',
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
});

// ── GET /:id ─────────────────────────────────────────────────────────────────

describe('GET /api/secrets/:id — ownership guard', () => {
  it('returns 200 and the secret when the requesting user is the owner', async () => {
    (prisma.userSecret.findUnique as jest.Mock).mockResolvedValue(OWNER_SECRET);
    const app = buildApp();

    const res = await request(app).get('/api/secrets/secret-1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('secret-1');
    // Encrypted value must never be exposed
    expect(res.body.encryptedValue).toBeUndefined();
  });

  it('returns 403 when the requesting user is NOT the owner (ownership guard)', async () => {
    // Mutation target: if the `if (secret.userId !== userId) return 403` guard
    // is removed, this test will fail with a 200 instead of 403.
    (prisma.userSecret.findUnique as jest.Mock).mockResolvedValue(OTHER_USER_SECRET);
    const app = buildApp();

    const res = await request(app).get('/api/secrets/secret-2');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not your secret/i);
  });

  it('returns 404 when the secret does not exist', async () => {
    (prisma.userSecret.findUnique as jest.Mock).mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app).get('/api/secrets/nonexistent');

    expect(res.status).toBe(404);
  });
});

// ── PUT /:id ─────────────────────────────────────────────────────────────────

describe('PUT /api/secrets/:id — ownership guard + encrypt-on-write', () => {
  it('returns 200 when the requesting user is the owner', async () => {
    (prisma.userSecret.findUnique as jest.Mock).mockResolvedValue(OWNER_SECRET);
    const updated = { ...OWNER_SECRET, name: 'Updated Name', encryptedValue: 'new:cipher' };
    (prisma.userSecret.update as jest.Mock).mockResolvedValue(updated);
    const app = buildApp();

    const res = await request(app)
      .put('/api/secrets/secret-1')
      .send({ name: 'Updated Name' });

    expect(res.status).toBe(200);
  });

  it('returns 403 when the requesting user is NOT the owner (ownership guard)', async () => {
    // Mutation target: remove the ownership check → non-owner test fails with 200.
    (prisma.userSecret.findUnique as jest.Mock).mockResolvedValue(OTHER_USER_SECRET);
    const app = buildApp();

    const res = await request(app)
      .put('/api/secrets/secret-2')
      .send({ name: 'Hijack' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not your secret/i);
  });

  it('stores an encrypted value (not plaintext) when a new value is submitted (encrypt-on-write)', async () => {
    // Mutation target: if encryptSecret is bypassed and plaintext is stored,
    // the captured encryptedValue will equal the plaintext input and this test fails.
    (prisma.userSecret.findUnique as jest.Mock).mockResolvedValue(OWNER_SECRET);
    let capturedEncryptedValue: string | undefined;
    (prisma.userSecret.update as jest.Mock).mockImplementation(
      async ({ data }: { data: { encryptedValue?: string } }) => {
        capturedEncryptedValue = data.encryptedValue;
        return { ...OWNER_SECRET, ...data };
      },
    );
    const app = buildApp();
    const plaintext = 'my-super-secret-value';

    const res = await request(app)
      .put('/api/secrets/secret-1')
      .send({ value: plaintext });

    expect(res.status).toBe(200);
    expect(capturedEncryptedValue).toBeDefined();
    expect(capturedEncryptedValue).not.toBe(plaintext);
    // AES-CBC format: iv:cipher (two colon-separated hex chunks)
    expect(capturedEncryptedValue).toContain(':');
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe('DELETE /api/secrets/:id — ownership guard', () => {
  it('returns 200 when the requesting user is the owner', async () => {
    (prisma.userSecret.findUnique as jest.Mock).mockResolvedValue(OWNER_SECRET);
    (prisma.userSecret.delete as jest.Mock).mockResolvedValue(OWNER_SECRET);
    const app = buildApp();

    const res = await request(app).delete('/api/secrets/secret-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 when the requesting user is NOT the owner (ownership guard)', async () => {
    // Mutation target: remove the ownership check → non-owner can delete any secret.
    (prisma.userSecret.findUnique as jest.Mock).mockResolvedValue(OTHER_USER_SECRET);
    const app = buildApp();

    const res = await request(app).delete('/api/secrets/secret-2');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not your secret/i);
    // The delete must NOT have been called
    expect(prisma.userSecret.delete as jest.Mock).not.toHaveBeenCalled();
  });
});

// ── POST / — encrypt-on-write ─────────────────────────────────────────────────

describe('POST /api/secrets — encrypt-on-write', () => {
  it('stores an encrypted value (not plaintext) on create', async () => {
    // Mutation target: if encryptSecret is bypassed in POST, capturedEncryptedValue
    // will equal the plaintext value and this assertion fails.
    let capturedEncryptedValue: string | undefined;
    (prisma.userSecret.create as jest.Mock).mockImplementation(
      async ({ data }: { data: { encryptedValue?: string } }) => {
        capturedEncryptedValue = data.encryptedValue;
        return {
          id: 'new-secret',
          userId: 'user-1',
          name: 'New Secret',
          encryptedValue: data.encryptedValue,
          description: null,
          projectId: null,
          lastUsedAt: null,
          lastUsedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    );
    const app = buildApp();
    const plaintext = 'plaintext-secret-value';

    const res = await request(app)
      .post('/api/secrets')
      .send({ name: 'New Secret', value: plaintext });

    expect(res.status).toBe(200);
    expect(capturedEncryptedValue).toBeDefined();
    expect(capturedEncryptedValue).not.toBe(plaintext);
    expect(capturedEncryptedValue).toContain(':');
  });

  it('returns 400 when name or value is missing', async () => {
    const app = buildApp();

    const noValue = await request(app)
      .post('/api/secrets')
      .send({ name: 'My Secret' });
    expect(noValue.status).toBe(400);

    const noName = await request(app)
      .post('/api/secrets')
      .send({ value: 'secretvalue' });
    expect(noName.status).toBe(400);
  });
});
