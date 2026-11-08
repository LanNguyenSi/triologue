/**
 * Short-lived, purpose-bound tokens for the two places a browser cannot send an
 * Authorization header: `<img src>` / `<a href>` file URLs and the top-level
 * navigation that starts an OAuth flow.
 *
 * A token is `v1.<base64url userId>.<expiry, epoch seconds>.<base64url HMAC>`.
 * It is deliberately NOT a JWT: it has four dot-separated parts and no JSON
 * header, so `jwt.verify` (the generic session verifier used by `authenticate`,
 * the socket handshake and the auth routes) rejects it as malformed. The HMAC
 * key is derived with HKDF-SHA256 from JWT_SECRET under a label that includes
 * the purpose, so a token minted for one purpose cannot verify for another and
 * no new secret has to be deployed. The MAC covers (purpose, subject, userId,
 * expiry), where `subject` is the single thing the token is good for (a stored
 * file name, or a provider and scope for the OAuth start).
 *
 * Verification only proves the token was minted by this server for that
 * subject and user, and has not expired. Callers still check at request time
 * that the user is active and authorized for the subject.
 */

import crypto from 'crypto';

export type TokenPurpose = 'file' | 'oauth-start';

const VERSION = 'v1';

function keyFor(purpose: TokenPurpose): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required to derive scoped-token keys');
  return Buffer.from(
    crypto.hkdfSync('sha256', secret, Buffer.alloc(0), `triologue/scoped-token/${VERSION}/${purpose}`, 32),
  );
}

function mac(purpose: TokenPurpose, subject: string, userId: string, exp: number): Buffer {
  return crypto
    .createHmac('sha256', keyFor(purpose))
    .update(JSON.stringify([VERSION, purpose, subject, userId, exp]))
    .digest();
}

export interface MintedToken {
  token: string;
  /** Expiry as epoch seconds. */
  expiresAt: number;
  /** Seconds from `now` until expiry. */
  expiresIn: number;
}

/**
 * Mint a token. The expiry is `now + ttlSeconds` rounded DOWN to a multiple of
 * `bucketSeconds`, so repeated mints for the same (subject, user) inside one
 * bucket return the identical string. For file URLs that keeps the URL stable
 * and the browser cache useful; the lifetime is in `(ttl - bucket, ttl]`.
 */
export function mintScopedToken(opts: {
  purpose: TokenPurpose;
  subject: string;
  userId: string;
  ttlSeconds: number;
  bucketSeconds?: number;
  nowMs?: number;
}): MintedToken {
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const bucket = Math.max(1, Math.floor(opts.bucketSeconds ?? 1));
  const expiresAt = Math.floor((nowSec + opts.ttlSeconds) / bucket) * bucket;
  const sig = mac(opts.purpose, opts.subject, opts.userId, expiresAt).toString('base64url');
  const uid = Buffer.from(opts.userId, 'utf8').toString('base64url');
  return {
    token: `${VERSION}.${uid}.${expiresAt}.${sig}`,
    expiresAt,
    expiresIn: Math.max(0, expiresAt - nowSec),
  };
}

/** Returns the bound user id, or null for any malformed, forged, mismatched or expired token. */
export function verifyScopedToken(opts: {
  purpose: TokenPurpose;
  subject: string;
  token: unknown;
  nowMs?: number;
}): { userId: string } | null {
  if (typeof opts.token !== 'string' || opts.token.length > 512) return null;
  const parts = opts.token.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, uidPart, expPart, sigPart] = parts;
  if (!/^[0-9]{1,12}$/.test(expPart) || !/^[A-Za-z0-9_-]+$/.test(uidPart) || !/^[A-Za-z0-9_-]+$/.test(sigPart)) {
    return null;
  }

  const userId = Buffer.from(uidPart, 'base64url').toString('utf8');
  const exp = Number(expPart);
  if (!userId) return null;

  const given = Buffer.from(sigPart, 'base64url');
  const expected = mac(opts.purpose, opts.subject, userId, exp);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  // The signature is checked first so an attacker learns nothing about expiry
  // from a forged token; an authentic but expired token is refused here.
  if (Math.floor((opts.nowMs ?? Date.now()) / 1000) >= exp) return null;

  return { userId };
}

const DEFAULT_FILE_TOKEN_TTL_SECONDS = 300;

/** File token lifetime in seconds: FILE_TOKEN_TTL_SECONDS (5..3600) or 5 minutes. */
export function fileTokenTtlSeconds(): number {
  const raw = Number(process.env.FILE_TOKEN_TTL_SECONDS);
  if (Number.isInteger(raw) && raw >= 5 && raw <= 3600) return raw;
  return DEFAULT_FILE_TOKEN_TTL_SECONDS;
}

export function mintFileToken(filename: string, userId: string, nowMs?: number): MintedToken {
  const ttlSeconds = fileTokenTtlSeconds();
  return mintScopedToken({
    purpose: 'file',
    subject: filename,
    userId,
    ttlSeconds,
    bucketSeconds: Math.max(1, Math.min(60, Math.floor(ttlSeconds / 5))),
    nowMs,
  });
}

export function verifyFileToken(filename: string, token: unknown, nowMs?: number): { userId: string } | null {
  return verifyScopedToken({ purpose: 'file', subject: filename, token, nowMs });
}

export const OAUTH_START_TOKEN_TTL_SECONDS = 120;

export function oauthStartSubject(provider: string, scope: string): string {
  return `${provider}:${scope}`;
}

export function mintOAuthStartToken(provider: string, scope: string, userId: string, nowMs?: number): MintedToken {
  return mintScopedToken({
    purpose: 'oauth-start',
    subject: oauthStartSubject(provider, scope),
    userId,
    ttlSeconds: OAUTH_START_TOKEN_TTL_SECONDS,
    nowMs,
  });
}

export function verifyOAuthStartToken(
  provider: string,
  scope: string,
  token: unknown,
  nowMs?: number,
): { userId: string } | null {
  return verifyScopedToken({ purpose: 'oauth-start', subject: oauthStartSubject(provider, scope), token, nowMs });
}
