/**
 * Unit tests for server/src/services/tokenManager.ts (AES-256-GCM).
 *
 * Guards tested:
 *   1. storeToken encrypts and getToken decrypts to the original value (round-trip).
 *   2. A tampered GCM auth tag causes getToken to throw.
 *   3. Calling storeToken with INTEGRATION_ENCRYPTION_KEY absent throws.
 *   4. getToken returns null for a revoked or missing token record.
 *   5. getToken returns null for an expired token with no refreshToken,
 *      and the token is marked as error (markError is called).
 *   6. tryRefresh marks the token as error when the outbound refresh call fails.
 *
 * Crypto stays REAL (no mocking of node:crypto). prisma and logger are mocked.
 *
 * Mutation-test intent:
 *   - Removing the `if (!key) throw` guard in getIntegrationKey() breaks test 3.
 *   - `decipher.setAuthTag(authTag)` is pinned by the round-trip test (test 1):
 *     without it GCM final() throws even on a valid tag, so a correct token fails
 *     to decrypt. The tamper test (test 2) additionally proves a flipped tag is
 *     rejected while the original tag is accepted (genuine tamper-detection).
 *   - Removing the `token.status !== 'active'` check in getToken() breaks test 4.
 *   - Removing the `markError` call in tryRefresh() breaks tests 5 and 6.
 */

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    integrationToken: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import prisma from '../lib/prisma';
import { storeToken, getToken } from '../services/tokenManager';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a future Date (default 1 h from now) for expiresAt. */
function futureDate(offsetMs = 3_600_000): Date {
  return new Date(Date.now() + offsetMs);
}

/** Build a past Date (default 1 s ago) for an expired token. */
function pastDate(offsetMs = 1_000): Date {
  return new Date(Date.now() - offsetMs);
}

/**
 * Call storeToken and capture the encrypted values written to prisma.
 * Returns the encrypted accessToken and refreshToken as stored.
 */
async function captureEncryptedTokens(
  accessToken: string,
  refreshToken?: string,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  let captured: { accessToken: string; refreshToken: string | null } | null = null;

  (prisma.integrationToken.upsert as jest.Mock).mockImplementationOnce(
    async ({ create }: { create: { accessToken: string; refreshToken: string | null } }) => {
      captured = { accessToken: create.accessToken, refreshToken: create.refreshToken };
      return {};
    },
  );

  await storeToken(
    '_cap_provider',
    '_cap_scope',
    { accessToken, refreshToken, expiresIn: 3600 },
    'system',
    null,
  );

  if (!captured) throw new Error('storeToken did not call prisma.integrationToken.upsert');
  return captured;
}

// ── test suite ───────────────────────────────────────────────────────────────

describe('tokenManager — AES-256-GCM', () => {
  const TEST_INTEGRATION_KEY = 'test-gcm-integration-key-for-tests';

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_INTEGRATION_KEY;
    process.env.MICROSOFT_CLIENT_ID = 'ms-client-id';
    process.env.MICROSOFT_CLIENT_SECRET = 'ms-client-secret';
    jest.clearAllMocks();
    (prisma.integrationToken.update as jest.Mock).mockResolvedValue({});
    (prisma.integrationToken.upsert as jest.Mock).mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
  });

  // ── 1. Encrypt / decrypt round-trip ────────────────────────────────────

  describe('encrypt/decrypt round-trip', () => {
    it('getToken returns the original accessToken stored by storeToken', async () => {
      const { accessToken: encAccess } = await captureEncryptedTokens('xoxb-real-slack-token');

      // The stored value is encrypted, not the plaintext.
      expect(encAccess).not.toBe('xoxb-real-slack-token');
      // It must contain two colons (iv:authTag:cipher).
      expect(encAccess.split(':').length).toBe(3);

      (prisma.integrationToken.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'tok-1',
        provider: '_cap_provider',
        scope: '_cap_scope',
        userId: null,
        accessToken: encAccess,
        refreshToken: null,
        expiresAt: futureDate(),
        metadata: {},
        status: 'active',
      });

      const result = await getToken('_cap_provider', '_cap_scope');
      expect(result).toBe('xoxb-real-slack-token');
    });

    it('each storeToken call produces a unique ciphertext (random IV)', async () => {
      const calls: string[] = [];
      (prisma.integrationToken.upsert as jest.Mock).mockImplementation(
        async ({ create }: { create: { accessToken: string } }) => {
          calls.push(create.accessToken);
          return {};
        },
      );
      await storeToken('p', 's', { accessToken: 'same', expiresIn: 3600 }, 'u', null);
      await storeToken('p', 's', { accessToken: 'same', expiresIn: 3600 }, 'u', null);
      expect(calls[0]).not.toBe(calls[1]);
    });
  });

  // ── 2. Tampered GCM auth tag throws ───────────────────────────────────

  describe('tampered auth tag', () => {
    it('getToken throws when the stored accessToken has a flipped GCM auth tag', async () => {
      const { accessToken: encAccess } = await captureEncryptedTokens('sensitive-secret');

      // Format: iv_hex:authTag_hex:cipher_hex
      const parts = encAccess.split(':');
      expect(parts).toHaveLength(3);
      const [ivHex, authTagHex, cipherHex] = parts;

      // Flip every bit of the auth tag to guarantee a mismatch.
      const authTagBuf = Buffer.from(authTagHex, 'hex');
      const flipped = Buffer.alloc(authTagBuf.length);
      for (let i = 0; i < authTagBuf.length; i++) {
        flipped[i] = authTagBuf[i] ^ 0xff;
      }
      const tampered = `${ivHex}:${flipped.toString('hex')}:${cipherHex}`;

      (prisma.integrationToken.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'tok-tampered',
        provider: '_cap_provider',
        scope: '_cap_scope',
        userId: null,
        accessToken: tampered,
        refreshToken: null,
        expiresAt: futureDate(),
        metadata: {},
        status: 'active',
      });

      await expect(getToken('_cap_provider', '_cap_scope')).rejects.toThrow();

      // Control: the SAME ciphertext with the ORIGINAL (correct) auth tag decrypts
      // fine, so the rejection above is specifically the tag mismatch, not a generic
      // decrypt failure (genuine tamper-detection, not "any change throws").
      (prisma.integrationToken.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'tok-original',
        provider: '_cap_provider',
        scope: '_cap_scope',
        userId: null,
        accessToken: encAccess,
        refreshToken: null,
        expiresAt: futureDate(),
        metadata: {},
        status: 'active',
      });
      await expect(getToken('_cap_provider', '_cap_scope')).resolves.toBe('sensitive-secret');
    });
  });

  // ── 3. Missing INTEGRATION_ENCRYPTION_KEY ─────────────────────────────

  describe('missing INTEGRATION_ENCRYPTION_KEY', () => {
    it('storeToken throws when INTEGRATION_ENCRYPTION_KEY is absent', async () => {
      delete process.env.INTEGRATION_ENCRYPTION_KEY;
      await expect(
        storeToken('p', 's', { accessToken: 'tok', expiresIn: 3600 }, 'user'),
      ).rejects.toThrow('INTEGRATION_ENCRYPTION_KEY not configured');
    });
  });

  // ── 4. getToken returns null for revoked / missing records ──────────────

  describe('getToken — null cases', () => {
    it('returns null when the token record has status "revoked"', async () => {
      (prisma.integrationToken.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'tok-rev',
        provider: 'p', scope: 's', userId: null,
        accessToken: 'encrypted', refreshToken: null,
        expiresAt: futureDate(), metadata: {}, status: 'revoked',
      });
      expect(await getToken('p', 's')).toBeNull();
    });

    it('returns null when the token record has status "error"', async () => {
      (prisma.integrationToken.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'tok-err',
        provider: 'p', scope: 's', userId: null,
        accessToken: 'encrypted', refreshToken: null,
        expiresAt: futureDate(), metadata: {}, status: 'error',
      });
      expect(await getToken('p', 's')).toBeNull();
    });

    it('returns null when prisma returns null (no matching record)', async () => {
      (prisma.integrationToken.findFirst as jest.Mock).mockResolvedValueOnce(null);
      expect(await getToken('p', 's')).toBeNull();
    });
  });

  // ── 5. Expired token with no refreshToken → markError called ──────────

  describe('getToken — expired token without refreshToken', () => {
    it('returns null and marks the token as error when refreshToken is absent', async () => {
      (prisma.integrationToken.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'tok-exp',
        provider: 'p', scope: 's', userId: null,
        accessToken: 'some-encrypted-access',
        refreshToken: null,
        expiresAt: pastDate(),
        metadata: {}, status: 'active',
      });

      const result = await getToken('p', 's');

      expect(result).toBeNull();
      // markError must have persisted status:'error' to the DB.
      expect(prisma.integrationToken.update as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tok-exp' },
          data: expect.objectContaining({ status: 'error' }),
        }),
      );
    });
  });

  // ── 6. tryRefresh marks error when outbound refresh call fails ─────────

  describe('tryRefresh — refresh call failure', () => {
    it('marks the token as error and returns null when the Microsoft refresh endpoint fails', async () => {
      // Generate encrypted access+refresh tokens via storeToken.
      const { accessToken: encAccess, refreshToken: encRefresh } =
        await captureEncryptedTokens('old-access', 'my-refresh-token');
      expect(encRefresh).not.toBeNull();

      // Mock fetch to return a non-ok response → Microsoft handler throws.
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'invalid_grant' }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).fetch = mockFetch;

      (prisma.integrationToken.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'tok-ms-exp',
        provider: 'microsoft',
        scope: 'mail',
        userId: null,
        accessToken: encAccess,
        refreshToken: encRefresh,
        expiresAt: pastDate(),
        metadata: { tenantId: 'common' },
        status: 'active',
      });

      const result = await getToken('microsoft', 'mail');

      expect(result).toBeNull();
      expect(prisma.integrationToken.update as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tok-ms-exp' },
          data: expect.objectContaining({ status: 'error' }),
        }),
      );

      // Clean up the global fetch mock.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (global as any).fetch;
    });

    it('returns null (no error) for an unknown provider that has no refresh handler', async () => {
      const { accessToken: encAccess, refreshToken: encRefresh } =
        await captureEncryptedTokens('acc', 'ref');

      (prisma.integrationToken.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'tok-unknown',
        provider: 'unknown-provider',
        scope: 'api',
        userId: null,
        accessToken: encAccess,
        refreshToken: encRefresh,
        expiresAt: pastDate(),
        metadata: {},
        status: 'active',
      });

      const result = await getToken('unknown-provider', 'api');
      // No handler → tryRefresh logs a warning and returns null → getToken returns null.
      expect(result).toBeNull();
      // markError is NOT called for an unknown provider (no handler path doesn't call it).
      expect(prisma.integrationToken.update as jest.Mock).not.toHaveBeenCalled();
    });
  });
});
