/**
 * Revocable session JWTs.
 *
 * A session JWT carries the `tokenVersion` its user had when it was signed.
 * `User.tokenVersion` starts at 0 and is incremented by every credential
 * change (change-password, PATCH /me with a new password), so every session
 * token signed before the change stops verifying while the account stays
 * active (unlike `isActive = false`, which also locks the user out).
 *
 * Rule, in one place for every verifier (the `authenticate` and
 * `optionalAuth` middleware, `GET /api/auth/verify`, the Socket.io handshake
 * and the JWT branch of `/api/files`): a token without the claim counts as
 * version 0, so tokens issued before this claim existed keep working until
 * the user's first credential change; a token is accepted only when its
 * version is strictly equal (`===`) to the user's current one, so a string,
 * a float or null never matches.
 *
 * `byoa_` agent tokens are not JWTs and never go through this check.
 */
import jwt from 'jsonwebtoken';

export interface SessionTokenClaims {
  tokenVersion?: unknown;
}

export function sessionTokenIsCurrent(
  decoded: SessionTokenClaims,
  user: { tokenVersion: number },
): boolean {
  const claimed = decoded.tokenVersion === undefined ? 0 : decoded.tokenVersion;
  return claimed === user.tokenVersion;
}

/**
 * Signs the replacement session token handed to a human user right after a
 * credential change (same payload shape and 7 day lifetime as a login).
 * `user` must be the row as it is AFTER the increment, so the new token
 * carries the new version.
 */
export function signHumanSessionToken(user: {
  id: string;
  username: string;
  userType: string;
  displayName: string;
  tokenVersion: number;
}): string {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      userType: user.userType,
      displayName: user.displayName,
      tokenVersion: user.tokenVersion,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' },
  );
}
