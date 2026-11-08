/**
 * Unit tests for src/lib/scopedToken.ts (file tokens and OAuth start tokens).
 *
 * Mutation-check intent:
 *   - Replace the timingSafeEqual comparison with `true` (or drop the length
 *     check) → the forged-signature and wrong-subject tests go red.
 *   - Remove the expiry comparison → the expired test goes red.
 *   - Drop `subject` / `userId` / `purpose` from the MAC input → the
 *     matching "different X" tests go red.
 *   - Return a JWT-shaped token → the "not verifiable as a session JWT" test
 *     goes red.
 */

import jwt from 'jsonwebtoken';
import {
  fileTokenTtlSeconds,
  mintFileToken,
  mintOAuthStartToken,
  mintScopedToken,
  verifyFileToken,
  verifyOAuthStartToken,
  verifyScopedToken,
} from '../lib/scopedToken';

const NOW = Date.UTC(2026, 0, 1, 12, 0, 30);

describe('scoped tokens', () => {
  const originalTtl = process.env.FILE_TOKEN_TTL_SECONDS;
  afterEach(() => {
    if (originalTtl === undefined) delete process.env.FILE_TOKEN_TTL_SECONDS;
    else process.env.FILE_TOKEN_TTL_SECONDS = originalTtl;
  });

  it('round-trips a file token to its user id', () => {
    const { token } = mintFileToken('a.png', 'user-1', NOW);
    expect(verifyFileToken('a.png', token, NOW + 1000)).toEqual({ userId: 'user-1' });
  });

  it('keeps ids with dots, slashes and non-ASCII intact', () => {
    const uid = 'u.1/ü';
    const { token } = mintFileToken('a.png', uid, NOW);
    expect(verifyFileToken('a.png', token, NOW)).toEqual({ userId: uid });
  });

  it('refuses another file name', () => {
    const { token } = mintFileToken('a.png', 'user-1', NOW);
    expect(verifyFileToken('b.png', token, NOW)).toBeNull();
  });

  it('refuses an expired token and accepts it up to the second before expiry', () => {
    const minted = mintFileToken('a.png', 'user-1', NOW);
    expect(verifyFileToken('a.png', minted.token, (minted.expiresAt - 1) * 1000)).not.toBeNull();
    expect(verifyFileToken('a.png', minted.token, minted.expiresAt * 1000)).toBeNull();
    expect(verifyFileToken('a.png', minted.token, minted.expiresAt * 1000 + 60_000)).toBeNull();
  });

  it('refuses a forged signature, a truncated signature and an extended signature', () => {
    const { token } = mintFileToken('a.png', 'user-1', NOW);
    const parts = token.split('.');
    const flip = (sig: string) => (sig.startsWith('A') ? 'B' : 'A') + sig.slice(1);
    expect(verifyFileToken('a.png', [...parts.slice(0, 3), flip(parts[3])].join('.'), NOW)).toBeNull();
    expect(verifyFileToken('a.png', [...parts.slice(0, 3), parts[3].slice(0, -4)].join('.'), NOW)).toBeNull();
    expect(verifyFileToken('a.png', [...parts.slice(0, 3), parts[3] + 'AAAA'].join('.'), NOW)).toBeNull();
  });

  it('refuses a token whose expiry was moved forward', () => {
    const parts = mintFileToken('a.png', 'user-1', NOW).token.split('.');
    parts[2] = String(Number(parts[2]) + 3600);
    expect(verifyFileToken('a.png', parts.join('.'), NOW)).toBeNull();
  });

  it('refuses another user id in an otherwise valid token', () => {
    const parts = mintFileToken('a.png', 'user-1', NOW).token.split('.');
    parts[1] = Buffer.from('user-2').toString('base64url');
    expect(verifyFileToken('a.png', parts.join('.'), NOW)).toBeNull();
  });

  it('separates purposes: a file token is not an OAuth start token and vice versa', () => {
    const file = mintFileToken('microsoft:default', 'user-1', NOW).token;
    expect(verifyOAuthStartToken('microsoft', 'default', file, NOW)).toBeNull();
    const oauth = mintOAuthStartToken('microsoft', 'default', 'user-1', NOW).token;
    expect(verifyFileToken('microsoft:default', oauth, NOW)).toBeNull();
    // Same subject string, different purpose, directly through the generic API.
    const t = mintScopedToken({ purpose: 'file', subject: 's', userId: 'u', ttlSeconds: 60, nowMs: NOW }).token;
    expect(verifyScopedToken({ purpose: 'oauth-start', subject: 's', token: t, nowMs: NOW })).toBeNull();
  });

  it('binds an OAuth start token to provider and scope', () => {
    const { token } = mintOAuthStartToken('microsoft', 'teams', 'user-1', NOW);
    expect(verifyOAuthStartToken('microsoft', 'teams', token, NOW)).toEqual({ userId: 'user-1' });
    expect(verifyOAuthStartToken('atlassian', 'teams', token, NOW)).toBeNull();
    expect(verifyOAuthStartToken('microsoft', 'default', token, NOW)).toBeNull();
    expect(verifyOAuthStartToken('microsoft', 'teams', token, NOW + 121_000)).toBeNull();
  });

  it('refuses an over-long token (more than 512 characters) even when its signature is valid', () => {
    const userId = 'u'.repeat(600);
    const { token } = mintFileToken('a.png', userId, NOW);
    expect(token.length).toBeGreaterThan(512);
    expect(verifyFileToken('a.png', token, NOW)).toBeNull();
  });

  it('is not verifiable as a session JWT', () => {
    const { token } = mintFileToken('a.png', 'user-1', NOW);
    expect(() => jwt.verify(token, process.env.JWT_SECRET!)).toThrow();
    expect(jwt.decode(token)).toBeNull();
    // And a session JWT is not a scoped token.
    const session = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!);
    expect(verifyFileToken('a.png', session, Date.now())).toBeNull();
  });

  it('is derived from JWT_SECRET: a token minted under another secret is refused', () => {
    const original = process.env.JWT_SECRET;
    try {
      process.env.JWT_SECRET = 'another-secret-another-secret-0000';
      const foreign = mintFileToken('a.png', 'user-1', NOW).token;
      process.env.JWT_SECRET = original;
      expect(verifyFileToken('a.png', foreign, NOW)).toBeNull();
    } finally {
      process.env.JWT_SECRET = original;
    }
  });

  it.each([undefined, null, '', 'v1', 'v1...', 'v1.a.b', 'v2.dXNlcg.9999999999.AAAA', 42, {}, 'x'.repeat(600)])(
    'refuses malformed input %p',
    (bad) => {
      expect(verifyFileToken('a.png', bad, NOW)).toBeNull();
    },
  );

  it('rounds the expiry down to a bucket so the token is stable within a bucket', () => {
    delete process.env.FILE_TOKEN_TTL_SECONDS;
    const base = Math.floor(NOW / 60000) * 60000;
    const a = mintFileToken('a.png', 'user-1', base + 1000);
    const b = mintFileToken('a.png', 'user-1', base + 50_000);
    const c = mintFileToken('a.png', 'user-1', base + 61_000);
    expect(a.token).toBe(b.token);
    expect(c.token).not.toBe(a.token);
    expect(a.expiresIn).toBeGreaterThan(240 - 1);
    expect(a.expiresIn).toBeLessThanOrEqual(300);
    expect(c.expiresAt - a.expiresAt).toBe(60);
  });

  it('uses a 5 minute default lifetime and honours FILE_TOKEN_TTL_SECONDS within 5..3600', () => {
    delete process.env.FILE_TOKEN_TTL_SECONDS;
    expect(fileTokenTtlSeconds()).toBe(300);
    process.env.FILE_TOKEN_TTL_SECONDS = '20';
    expect(fileTokenTtlSeconds()).toBe(20);
    process.env.FILE_TOKEN_TTL_SECONDS = '5';
    expect(fileTokenTtlSeconds()).toBe(5); // lower bound is inclusive
    process.env.FILE_TOKEN_TTL_SECONDS = '3600';
    expect(fileTokenTtlSeconds()).toBe(3600); // upper bound is inclusive
    process.env.FILE_TOKEN_TTL_SECONDS = '4';
    expect(fileTokenTtlSeconds()).toBe(300);
    process.env.FILE_TOKEN_TTL_SECONDS = '3601';
    expect(fileTokenTtlSeconds()).toBe(300);
    process.env.FILE_TOKEN_TTL_SECONDS = 'abc';
    expect(fileTokenTtlSeconds()).toBe(300);
    process.env.FILE_TOKEN_TTL_SECONDS = '';
    expect(fileTokenTtlSeconds()).toBe(300);
  });

  it('mints a still-valid token for a short configured lifetime', () => {
    process.env.FILE_TOKEN_TTL_SECONDS = '10';
    const minted = mintFileToken('a.png', 'user-1', NOW);
    expect(minted.expiresIn).toBeGreaterThan(0);
    expect(minted.expiresIn).toBeLessThanOrEqual(10);
    expect(verifyFileToken('a.png', minted.token, NOW)).not.toBeNull();
  });
});
