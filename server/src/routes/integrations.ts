import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { getEnabledConnector, listEnabledConnectors } from "../connectors/registry";
import { buildOAuthAuthorizeUrl, createOAuthState } from "../services/integrationOAuth";
import { getToken, getTokenForUser, listIntegrations } from "../services/tokenManager";
import prisma from "../lib/prisma";

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
        const globalIntegration = integrations.find(
          (item) =>
            item.provider === definition.auth.provider &&
            item.scope === definition.auth.scope &&
            item.userId === null,
        );
        const integration = userIntegration || null;

        let status: "connected" | "expiring" | "expired" | "error" | "disconnected" = "disconnected";
        let connectionScope: "user" | "global" | null = null;

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
        } else if (globalIntegration) {
          connectionScope = "global";
          const token = await getToken(definition.auth.provider, definition.auth.scope);
          if (token) {
            status = "connected";
          } else {
            status = "expired";
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
          hasGlobalFallback: Boolean(globalIntegration),
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

// Browser reaches this via `window.location.href=...&token=${token}`, so it is
// the one route that legitimately needs a header-less token. Promote the
// query-param token to an Authorization header locally (mirrors files.ts), and
// reject `byoa_` agent tokens: only a human JWT should start an OAuth flow.
const promoteOAuthStartToken = (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  if (!req.headers.authorization && typeof req.query.token === "string") {
    if (req.query.token.startsWith("byoa_")) {
      return res.status(401).json({ error: "Agent tokens cannot start an OAuth flow" });
    }
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  return next();
};

router.get("/oauth/start", promoteOAuthStartToken, authenticate, async (req, res) => {
  const provider = String(req.query.provider || "").trim().toLowerCase() as
    | "microsoft"
    | "atlassian";
  const scope = String(req.query.scope || "default").trim();

  if (provider !== "microsoft" && provider !== "atlassian") {
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
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "OAuth configuration missing" });
  }
});

router.delete("/by-id/:id", authenticate, async (req, res) => {
  try {
    const integration = await (prisma as any).integrationToken.findUnique({
      where: { id: req.params.id },
      select: { id: true, userId: true },
    });

    if (!integration || integration.userId !== req.user!.id) {
      return res.status(404).json({ error: "Integration not found" });
    }

    await (prisma as any).integrationToken.update({
      where: { id: req.params.id },
      data: { status: "revoked" },
    });

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to revoke integration" });
  }
});

export default router;
