import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { getEnabledConnector, listEnabledConnectors } from "../connectors/registry";
import { buildOAuthAuthorizeUrl, createOAuthState } from "../services/integrationOAuth";
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
// user, one provider and one scope and expires after two minutes. With an
// Authorization header the route authenticates as before.
const authenticateOAuthStart = async (
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) => {
  if (req.headers.authorization) return authenticate(req, res, next);

  const { provider, scope } = readOAuthStartParams(req.query);
  const verified = verifyOAuthStartToken(provider, scope, req.query.st);
  if (!verified) return res.status(401).json({ error: "Authentication required" });

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

// Only a human session may start an OAuth flow: `byoa_` agent tokens are refused.
router.post("/oauth/start-token", authenticate, (req, res) => {
  if ((req.headers.authorization ?? "").startsWith("Bearer byoa_")) {
    return res.status(401).json({ error: "Agent tokens cannot start an OAuth flow" });
  }
  const { provider, scope } = readOAuthStartParams(req.body);
  if (!isOAuthProvider(provider)) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }
  const minted = mintOAuthStartToken(provider, scope, req.user!.id);
  res.setHeader("Cache-Control", "no-store");
  return res.json({ token: minted.token, expiresIn: minted.expiresIn });
});

router.get("/oauth/start", authenticateOAuthStart, async (req, res) => {
  const { provider, scope } = readOAuthStartParams(req.query);

  if (!isOAuthProvider(provider)) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  try {
    const state = createOAuthState({
      provider,
      scope,
      userId: req.user!.id,
      mode: "user",
      targetPath: "/settings/connections",
    });
    return res.redirect(buildOAuthAuthorizeUrl(provider, scope, state));
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
