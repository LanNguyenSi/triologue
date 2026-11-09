import { Router } from "express";
import { authenticate, requireHuman } from "../middleware/auth";
import { getEnabledConnector, listEnabledConnectors } from "../connectors/registry";
import {
  buildOAuthAuthorizeUrl,
  clearOAuthStartCookie,
  consumeOAuthStartBinding,
  createOAuthState,
  getOAuthRedirectOrigin,
  issueOAuthStartBinding,
  setOAuthBindingCookie,
  setOAuthStartCookie,
} from "../services/integrationOAuth";
import { getTokenForUser, listIntegrations } from "../services/tokenManager";
import prisma from "../lib/prisma";
import { mintOAuthStartToken, verifyOAuthStartToken } from "../lib/scopedToken";

const router = Router();

router.get("/connectors", authenticate, async (req, res) => {
  try {
    const now = Date.now();
    const expirationWindow = now + 24 * 60 * 60 * 1000;
    const userId = req.user!.id;
    const connectors = listEnabledConnectors();
    const integrations = await listIntegrations();

    const items = await Promise.all(
      connectors.map(async (connector) => {
        const definition = getEnabledConnector(connector.id) || connector;
        const userIntegration = integrations.find(
          (item) =>
            item.provider === definition.auth.provider &&
            item.scope === definition.auth.scope &&
            item.userId === userId,
        );
        const integration = userIntegration || null;

        // Status comes from the user's own row. A tenant-wide row (userId null)
        // is never read for a token, so it is not advertised as a connection.
        let status: "connected" | "expiring" | "expired" | "error" | "disconnected" = "disconnected";
        let connectionScope: "user" | null = null;

        if (integration) {
          connectionScope = "user";
          if (integration.status === "error" || integration.status === "revoked") {
            status = "error";
          } else if (integration.status === "active") {
            const expiresAt = new Date(integration.expiresAt).getTime();
            if (expiresAt <= now) {
              status = "expired";
            } else if (expiresAt <= expirationWindow) {
              status = "expiring";
            } else {
              status = "connected";
            }
          }
        }

        const personalToken = await getTokenForUser(
          definition.auth.provider,
          definition.auth.scope,
          userId,
        );

        return {
          id: definition.id,
          name: definition.name,
          provider: definition.provider,
          scope: definition.auth.scope,
          icon: definition.icon,
          category: definition.category,
          status,
          integrationId: integration?.id,
          connectionScope,
          hasPersonalConnection: Boolean(personalToken),
          actions: definition.actions.map((action) => ({
            id: action.id,
            name: action.name,
            description: action.description,
          })),
        };
      }),
    );

    return res.json({ items });
  } catch {
    return res.status(500).json({ error: "Failed to list user integrations" });
  }
});

type OAuthProvider = "microsoft" | "atlassian";

function readOAuthStartParams(source: unknown): { provider: string; scope: string } {
  const src = (source && typeof source === "object" ? source : {}) as Record<string, unknown>;
  return {
    provider: String(src.provider || "").trim().toLowerCase(),
    scope: String(src.scope || "default").trim(),
  };
}

function isOAuthProvider(provider: string): provider is OAuthProvider {
  return provider === "microsoft" || provider === "atlassian";
}

// The browser starts a flow by top-level navigation, which cannot carry an
// Authorization header. The session JWT is never accepted in the query: the
// client first calls POST /oauth/start-token (authenticated by header) and
// navigates with the returned single-purpose `st` token, which is bound to one
// user, one provider and one scope, expires after two minutes, starts at most one
// flow and works only in the browser that minted it (start cookie). With an
// Authorization header the route uses `authenticate`. Either way the route
// then requires a HUMAN user, so an agent (byoa_ token, bare or with Bearer,
// or an agent user's JWT) gets 403; the base accepted agents on this header
// path, which no browser flow uses.
const authenticateOAuthStart = async (
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) => {
  if (req.headers.authorization) return authenticate(req, res, next);

  const { provider, scope } = readOAuthStartParams(req.query);
  const verified = verifyOAuthStartToken(provider, scope, req.query.st);
  if (!verified) return res.status(401).json({ error: "Authentication required" });
  // The token is spent here whatever follows, and only the browser that minted
  // it (it holds the start cookie) may use it: a replayed `st`, or one pasted
  // into another browser, is refused like an expired one. The cookie is
  // cleared on every response for this token.
  const st = String(req.query.st);
  clearOAuthStartCookie(res, st);
  if (!consumeOAuthStartBinding(st, req.headers.cookie)) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: verified.userId } });
    if (!user || !user.isActive) return res.status(401).json({ error: "Invalid or inactive user" });
    req.user = {
      id: user.id,
      username: user.username,
      userType: user.userType,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      canTriggerAI: user.canTriggerAI,
    };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// The cookies of the flow are host-only, and the provider sends the browser
// back to the host of the redirect URI, so the flow only works when it runs on
// that host (www versus apex are different hosts). Returns the canonical origin
// when this request is on another host, else null. The origin comes from
// configuration, never from request headers; only host names are compared
// (cookies ignore port and scheme).
function wrongHostOrigin(req: import("express").Request, provider: OAuthProvider): string | null {
  try {
    const target = getOAuthRedirectOrigin(provider);
    return req.hostname.toLowerCase() === target.hostname ? null : target.origin;
  } catch {
    return null;
  }
}

// Refuses a start on a non-canonical host. A browser navigation (no
// Authorization header) goes back to the app's connections page, which shows
// its generic OAuth error; a header request gets 409 naming the canonical
// origin. POST /oauth/start-token refuses the same way before minting, so the
// app itself shows the origin to the user.
const requireCanonicalHost = (
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) => {
  const { provider } = readOAuthStartParams(req.query);
  const wrongHost = isOAuthProvider(provider) ? wrongHostOrigin(req, provider) : null;
  if (!wrongHost) return next();
  if (req.headers.authorization) {
    return res.status(409).json({ error: `Open ${wrongHost} to connect this account.`, canonicalOrigin: wrongHost });
  }
  return res.redirect(302, "/settings/connections?error=wrong_host");
};

// Only a human user may start an OAuth flow. The check is on the resolved
// user type (requireHuman), not on the header text: `authenticate` also
// accepts a bare `byoa_...` header and agent users' own JWTs, and all of them
// end up with a non-HUMAN userType and get 403 here.
router.post("/oauth/start-token", authenticate, requireHuman, (req, res) => {
  const { provider, scope } = readOAuthStartParams(req.body);
  if (!isOAuthProvider(provider)) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }
  const wrongHost = wrongHostOrigin(req, provider);
  if (wrongHost) {
    return res.status(409).json({
      error: `Open ${wrongHost} to connect this account: the provider can only send you back to that address.`,
      canonicalOrigin: wrongHost,
    });
  }
  const minted = mintOAuthStartToken(provider, scope, req.user!.id);
  // Bind the token to this browser: only the cookie set here lets
  // GET /oauth/start use it, so a token handed to someone else is worthless.
  setOAuthStartCookie(res, minted.token, issueOAuthStartBinding(minted.token), minted.expiresIn);
  res.setHeader("Cache-Control", "no-store");
  return res.json({ token: minted.token, expiresIn: minted.expiresIn });
});

router.get("/oauth/start", authenticateOAuthStart, requireHuman, requireCanonicalHost, async (req, res) => {
  const { provider, scope } = readOAuthStartParams(req.query);

  if (!isOAuthProvider(provider)) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  try {
    const { state, nonce, bindingSecret } = createOAuthState({
      provider,
      scope,
      userId: req.user!.id,
      mode: "user",
      targetPath: "/settings/connections",
    });
    const authorizeUrl = buildOAuthAuthorizeUrl(provider, scope, state);
    setOAuthBindingCookie(res, provider, nonce, bindingSecret);
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(authorizeUrl);
  } catch (error) {
    return res.status(500).json({ error: (error instanceof Error ? error.message : null) || "OAuth configuration missing" });
  }
});

router.delete("/by-id/:id", authenticate, async (req, res) => {
  try {
    const integration = await prisma.integrationToken.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true },
    });

    if (!integration || integration.userId !== req.user!.id) {
      return res.status(404).json({ error: "Integration not found" });
    }

    await prisma.integrationToken.update({
      where: { id: req.params.id },
      data: { status: "revoked" },
    });

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to revoke integration" });
  }
});

export default router;
