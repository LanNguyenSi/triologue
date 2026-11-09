// Mints an `st` token the way POST /oauth/start-token does (token plus a start
// binding) without going through the route, and returns the Cookie header the
// minting browser would send with it.
import { issueOAuthStartBinding, startCookieName } from '../../services/integrationOAuth';
import { mintOAuthStartToken } from '../../lib/scopedToken';

export function mintBoundStartToken(provider: string, scope: string, userId: string, nowMs?: number) {
  const minted = mintOAuthStartToken(provider, scope, userId, nowMs);
  const secret = issueOAuthStartBinding(minted.token);
  return { ...minted, cookie: `${startCookieName(minted.token)}=${secret}` };
}
