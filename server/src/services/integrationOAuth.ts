import crypto from "crypto";
import type { Response } from "express";
import { OAUTH_START_TOKEN_TTL_SECONDS } from "../lib/scopedToken";
import { logger } from "../utils/logger";

export type OAuthProvider = "microsoft" | "atlassian";
export type OAuthMode = "admin" | "user";

type OAuthNonceData = {
  provider: OAuthProvider;
  scope: string;
  userId: string;
  mode: OAuthMode;
  targetPath: string;
  createdAt: number;
  /** SHA-256 (hex) of the secret handed to the initiating browser as a cookie. */
  bindingHash: string;
};

const OAUTH_NONCE_TTL_MS = 10 * 60 * 1000;

/** Lifetime of the browser-binding cookie: the same as the nonce it is bound to. */
export const OAUTH_BINDING_COOKIE_MAX_AGE_SECONDS = OAUTH_NONCE_TTL_MS / 1000;

const oauthNonces = new Map<string, OAuthNonceData>();

// `st` tokens that already started a flow, mapped to their expiry in epoch ms.
// A token can only be replayed until it expires, so an entry is dropped at
// that moment. In memory and per process, like the nonce map above.
const usedOAuthStartTokens = new Map<string, number>();

/** Drop expired nonces and spent start tokens. Runs once a minute; exported for tests. */
export function sweepOAuthState(now: number = Date.now()): void {
  for (const [nonce, data] of oauthNonces) {
    if (now - data.createdAt > OAUTH_NONCE_TTL_MS) {
      oauthNonces.delete(nonce);
    }
  }
  for (const [token, expiresAtMs] of usedOAuthStartTokens) {
    if (now >= expiresAtMs) {
      usedOAuthStartTokens.delete(token);
    }
  }
}

const oauthNonceCleanup = setInterval(() => sweepOAuthState(), 60 * 1000);
// Background cleanup must not keep the process (or a jest worker) alive on its
// own; it still runs for the lifetime of a normally-running server.
oauthNonceCleanup.unref();

export function createOAuthState(payload: {
  provider: OAuthProvider;
  scope: string;
  userId: string;
  mode: OAuthMode;
  targetPath: string;
}): { state: string; nonce: string; bindingSecret: string } {
  const nonce = crypto.randomBytes(16).toString("hex");
  const bindingSecret = crypto.randomBytes(32).toString("base64url");
  oauthNonces.set(nonce, {
    ...payload,
    createdAt: Date.now(),
    bindingHash: hashBindingSecret(bindingSecret),
  });

  const state = Buffer.from(
    JSON.stringify({
      provider: payload.provider,
      scope: payload.scope,
      nonce,
    }),
  ).toString("base64url");

  return { state, nonce, bindingSecret };
}

function hashBindingSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/**
 * Marks a validly signed `st` token as spent. Returns false when it was
 * already used, so a replay inside its two-minute life is refused. The same
 * user minting twice inside one second gets the identical string, so a second
 * start with it in that second counts as a replay too.
 */
export function claimOAuthStartToken(token: string): boolean {
  if (usedOAuthStartTokens.has(token)) {
    return false;
  }
  // Token format: v1.<uid>.<expiry epoch seconds>.<mac>; it has been verified.
  const expSeconds = Number(token.split(".")[2]);
  const fallback = Date.now() + OAUTH_START_TOKEN_TTL_SECONDS * 1000;
  usedOAuthStartTokens.set(
    token,
    Number.isFinite(expSeconds) ? expSeconds * 1000 : fallback,
  );
  return true;
}

/** The redirect URI registered with the provider; also used for the token exchange. */
export function getOAuthRedirectUri(provider: OAuthProvider): string {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const override =
    provider === "microsoft"
      ? process.env.MICROSOFT_REDIRECT_URI
      : process.env.ATLASSIAN_REDIRECT_URI;
  return override || `${appUrl}/api/admin/integrations/oauth/callback`;
}

function bindingCookieName(nonce: string): string {
  return `oauth_bind_${nonce}`;
}

function bindingCookieOptions(provider: OAuthProvider) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Only a browser that follows https links gets the Secure flag; req.secure
    // is unreliable behind the TLS-terminating proxy chain.
    secure: (process.env.APP_URL || "").startsWith("https:"),
    path: new URL(getOAuthRedirectUri(provider)).pathname,
  };
}

/**
 * Hostname (no port) of the redirect URI a provider sends the browser back to.
 * A host-only cookie reaches only that host, so the flow has to start there.
 */
export function getOAuthRedirectOrigin(provider: OAuthProvider): {
  origin: string;
  hostname: string;
} {
  const url = new URL(getOAuthRedirectUri(provider));
  return { origin: url.origin, hostname: url.hostname.toLowerCase() };
}

/** Hands the secret to the initiating browser: HttpOnly, SameSite=Lax, host-only, scoped to the callback path. */
export function setOAuthBindingCookie(
  res: Response,
  provider: OAuthProvider,
  nonce: string,
  bindingSecret: string,
): void {
  res.cookie(bindingCookieName(nonce), bindingSecret, {
    ...bindingCookieOptions(provider),
    maxAge: OAUTH_BINDING_COOKIE_MAX_AGE_SECONDS * 1000,
  });
}

function parseStateParts(
  stateValue: string,
): { provider: OAuthProvider; scope: string; nonce: string } | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(String(stateValue), "base64url").toString(),
    ) as { provider?: string; scope?: string; nonce?: string };
    const provider = String(parsed.provider || "");
    const nonce = String(parsed.nonce || "");
    if (provider !== "microsoft" && provider !== "atlassian") return null;
    if (!/^[0-9a-f]{32}$/.test(nonce)) return null;
    return { provider, scope: String(parsed.scope || ""), nonce };
  } catch {
    return null;
  }
}

/**
 * Expires the binding cookie for the flow named by `stateValue`, with the same
 * name, path and attributes it was set with. A no-op for a state that does not
 * parse. The callback calls this before it decides anything, so every redirect
 * it sends, success or error, carries the clearing header.
 */
export function clearOAuthBindingCookie(res: Response, stateValue: unknown): void {
  const parts = parseStateParts(String(stateValue ?? ""));
  if (!parts) return;
  res.clearCookie(bindingCookieName(parts.nonce), bindingCookieOptions(parts.provider));
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Consumes the one-time nonce and checks that the browser completing the flow
 * is the browser that started it. The nonce is spent first, so a refused
 * callback cannot be retried with the right cookie. Returns null for an
 * unknown or replayed state, a provider/scope mismatch, and a missing or
 * wrong binding cookie alike.
 */
export function consumeOAuthState(
  stateValue: string,
  cookieHeader: string | undefined,
): OAuthNonceData | null {
  const parts = parseStateParts(stateValue);
  if (!parts) {
    return null;
  }

  const nonceData = oauthNonces.get(parts.nonce);
  if (!nonceData) {
    return null;
  }

  oauthNonces.delete(parts.nonce);

  if (nonceData.provider !== parts.provider || nonceData.scope !== parts.scope) {
    return null;
  }

  const presented = readCookie(cookieHeader, bindingCookieName(parts.nonce));
  const presentedHash = Buffer.from(hashBindingSecret(presented ?? ""), "hex");
  const expectedHash = Buffer.from(nonceData.bindingHash, "hex");
  const bound =
    presented !== null &&
    presentedHash.length === expectedHash.length &&
    crypto.timingSafeEqual(presentedHash, expectedHash);
  if (!bound) {
    logger.warn("OAuth callback refused: browser binding missing or mismatched", {
      provider: parts.provider,
      cookiePresent: presented !== null,
    });
    return null;
  }

  return nonceData;
}

export function buildOAuthAuthorizeUrl(
  provider: OAuthProvider,
  scope: string,
  state: string,
): string {
  if (provider === "microsoft") {
    const tenantId = process.env.MICROSOFT_TENANT_ID || "common";
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) {
      throw new Error("Microsoft OAuth not configured");
    }
    const redirectUri = getOAuthRedirectUri("microsoft");
    const scopes =
      scope === "teams"
        ? "Team.ReadBasic.All ChannelMessage.Read.All ChannelMessage.Send offline_access"
        : "Files.ReadWrite.All Sites.Read.All offline_access";
    return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(
      redirectUri,
    )}&scope=${encodeURIComponent(scopes)}&state=${state}`;
  }

  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  if (!clientId) {
    throw new Error("Atlassian OAuth not configured");
  }
  const redirectUri = getOAuthRedirectUri("atlassian");
  const scopes = "read:jira-work write:jira-work offline_access";
  return `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${clientId}&scope=${encodeURIComponent(
    scopes,
  )}&redirect_uri=${encodeURIComponent(
    redirectUri,
  )}&state=${state}&response_type=code&prompt=consent`;
}
