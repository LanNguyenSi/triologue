/**
 * Unit tests for server/src/utils/encryption.ts (AES-256-CBC).
 *
 * Guards tested:
 *   1. encrypt → decrypt round-trip returns the original plaintext.
 *   2. A tampered ciphertext (last AES block flipped) throws on decrypt.
 *   3. Calling encryptSecret/decryptSecret with ENCRYPTION_KEY absent throws.
 *   4. A stored value that lacks the ":" separator throws "Invalid encrypted format".
 *
 * No DB, no network, no prisma — pure crypto unit tests using real node:crypto.
 *
 * Mutation-test intent:
 *   - Removing the `if (!key) throw` guard in getEncryptionKey() would break test group 3.
 *   - Removing the `if (!ivHex || !encryptedHex) throw` guard in decryptSecret() would
 *     break test group 4 (decryptSecret would crash later with a less specific error or
 *     produce garbage, not the expected "Invalid encrypted format" message).
 */

import { encryptSecret, decryptSecret } from '../utils/encryption';

describe('encryption utils — AES-256-CBC', () => {
  const SAVED_KEY = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    // jest.setup.js sets ENCRYPTION_KEY; be explicit so tests are self-contained.
    process.env.ENCRYPTION_KEY = 'test-encryption-key-000000000000';
  });

  afterEach(() => {
    // Restore whatever was set before so other test suites are unaffected.
    if (SAVED_KEY !== undefined) {
      process.env.ENCRYPTION_KEY = SAVED_KEY;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  // ── 1. Encrypt → decrypt round-trip ──────────────────────────────────────

  describe('encrypt-then-decrypt round-trip', () => {
    it('returns the original plaintext for a typical secret', () => {
      const plaintext = 'super-secret-api-key-value';
      const salt = 'user-123';
      const encrypted = encryptSecret(plaintext, salt);
      expect(decryptSecret(encrypted, salt)).toBe(plaintext);
    });

    it('round-trips an empty string', () => {
      const encrypted = encryptSecret('', 'any-salt');
      expect(decryptSecret(encrypted, 'any-salt')).toBe('');
    });

    it('round-trips unicode content', () => {
      const plaintext = 'こんにちは 🔐 secret';
      const encrypted = encryptSecret(plaintext, 'unicode-salt');
      expect(decryptSecret(encrypted, 'unicode-salt')).toBe(plaintext);
    });

    it('produces distinct ciphertexts across calls (random IV)', () => {
      const c1 = encryptSecret('same-value', 'same-salt');
      const c2 = encryptSecret('same-value', 'same-salt');
      expect(c1).not.toBe(c2);
    });

    it('the encrypted format contains a ":" separator (iv:cipher)', () => {
      const encrypted = encryptSecret('value', 'salt');
      expect(encrypted).toContain(':');
    });
  });

  // ── 2. Tampered ciphertext throws ────────────────────────────────────────

  describe('tampered ciphertext', () => {
    it('never returns the original when the last AES block of the ciphertext is flipped', () => {
      const plaintext = 'original-plaintext-longer';
      const encrypted = encryptSecret(plaintext, 'my-salt');
      const colonIdx = encrypted.indexOf(':');
      const ivHex = encrypted.slice(0, colonIdx);
      const cipherHex = encrypted.slice(colonIdx + 1);

      // AES-256-CBC uses 16-byte (32 hex-char) blocks. Flip all bits of the last
      // block. CBC is UNAUTHENTICATED, so detection is only probabilistic: roughly
      // 1/256 of the time the corrupted last block still yields valid PKCS#7
      // padding and decryption returns garbage instead of throwing. So asserting
      // toThrow() is flaky. The deterministic guarantee is that a tampered
      // ciphertext NEVER decrypts back to the original plaintext (it either throws
      // on bad padding or returns a different, garbled value).
      const lastBlockBuf = Buffer.from(cipherHex.slice(-32), 'hex');
      const flippedBytes = Buffer.alloc(16);
      for (let i = 0; i < 16; i++) {
        flippedBytes[i] = lastBlockBuf[i] ^ 0xff;
      }
      const tampered = `${ivHex}:${cipherHex.slice(0, -32)}${flippedBytes.toString('hex')}`;

      let result: string | null = null;
      try {
        result = decryptSecret(tampered, 'my-salt');
      } catch {
        result = null; // threw on bad padding — the common path, also acceptable
      }
      if (result !== null) {
        expect(result).not.toBe(plaintext);
      }
    });

    it('decrypting with the wrong salt key produces garbage or throws (not the original)', () => {
      const plaintext = 'my-original-secret';
      const encrypted = encryptSecret(plaintext, 'salt-a');
      // With a different salt the derived key differs; AES-CBC may either throw
      // (bad padding) or return garbled UTF-8. Either outcome is acceptable —
      // the result must NOT equal the original.
      let result: string | null = null;
      try {
        result = decryptSecret(encrypted, 'salt-b');
      } catch {
        // Threw — that's the expected "fails to decrypt" path.
        result = null;
      }
      if (result !== null) {
        expect(result).not.toBe(plaintext);
      }
    });
  });

  // ── 3. Missing ENCRYPTION_KEY throws ─────────────────────────────────────

  describe('missing ENCRYPTION_KEY', () => {
    it('encryptSecret throws when ENCRYPTION_KEY is absent', () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => encryptSecret('value', 'salt')).toThrow('ENCRYPTION_KEY is not configured');
    });

    it('decryptSecret throws when ENCRYPTION_KEY is absent', () => {
      delete process.env.ENCRYPTION_KEY;
      // Even a structurally valid string must not proceed without the key.
      expect(() => decryptSecret('aabbccdd:eeff0011', 'salt')).toThrow(
        'ENCRYPTION_KEY is not configured',
      );
    });
  });

  // ── 4. Malformed stored value throws ─────────────────────────────────────

  describe('malformed stored value', () => {
    it('throws "Invalid encrypted format" when there is no ":" separator', () => {
      expect(() => decryptSecret('malformed-no-colon-at-all', 'salt')).toThrow(
        'Invalid encrypted format',
      );
    });

    it('throws "Invalid encrypted format" when the part after ":" is empty', () => {
      // split(':') yields ['onlyone', ''] — encryptedHex is '' (falsy).
      expect(() => decryptSecret('onlyone:', 'salt')).toThrow('Invalid encrypted format');
    });

    it('throws "Invalid encrypted format" when the part before ":" is empty', () => {
      // split(':') yields ['', 'something'] — ivHex is '' (falsy).
      expect(() => decryptSecret(':something', 'salt')).toThrow('Invalid encrypted format');
    });
  });
});
