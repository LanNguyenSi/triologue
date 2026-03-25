import crypto from "crypto";

export type OAuthProvider = "microsoft" | "atlassian";
export type OAuthMode = "admin" | "user";

type OAuthNonceData = {
  provider: OAuthProvider;
  scope: string;
  userId: string;
  mode: OAuthMode;
  targetPath: string;
  createdAt: number;
};

const oauthNonces = new Map<string, OAuthNonceData>();

setInterval(() => {
  const now = Date.now();
  for (const [nonce, data] of oauthNonces) {
    if (now - data.createdAt > 10 * 60 * 1000) {
      oauthNonces.delete(nonce);
    }
  }
}, 60 * 1000);

export function createOAuthState(payload: {
  provider: OAuthProvider;
  scope: string;
  userId: string;
  mode: OAuthMode;
  targetPath: string;
}): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  oauthNonces.set(nonce, {
    ...payload,
    createdAt: Date.now(),
  });

  return Buffer.from(
    JSON.stringify({
      provider: payload.provider,
      scope: payload.scope,
      nonce,
    }),
  ).toString("base64url");
}

export function consumeOAuthState(stateValue: string): OAuthNonceData | null {
  try {
    const parsedState = JSON.parse(
      Buffer.from(String(stateValue), "base64url").toString(),
    ) as { provider?: string; scope?: string; nonce?: string };

    const provider = String(parsedState.provider || "") as OAuthProvider;
    const scope = String(parsedState.scope || "");
    const nonce = String(parsedState.nonce || "");

    const nonceData = oauthNonces.get(nonce);
    if (!nonceData) {
      return null;
    }

    oauthNonces.delete(nonce);

    if (nonceData.provider !== provider || nonceData.scope !== scope) {
      return null;
    }

    return nonceData;
  } catch {
    return null;
  }
}

export function buildOAuthAuthorizeUrl(
  provider: OAuthProvider,
  scope: string,
  state: string,
): string {
  const appUrl = process.env.APP_URL || "http://localhost:3000";

  if (provider === "microsoft") {
    const tenantId = process.env.MICROSOFT_TENANT_ID || "common";
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) {
      throw new Error("Microsoft OAuth not configured");
    }
    const redirectUri =
      process.env.MICROSOFT_REDIRECT_URI ||
      `${appUrl}/api/admin/integrations/oauth/callback`;
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
  const redirectUri =
    process.env.ATLASSIAN_REDIRECT_URI ||
    `${appUrl}/api/admin/integrations/oauth/callback`;
  const scopes = "read:jira-work write:jira-work offline_access";
  return `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${clientId}&scope=${encodeURIComponent(
    scopes,
  )}&redirect_uri=${encodeURIComponent(
    redirectUri,
  )}&state=${state}&response_type=code&prompt=consent`;
}
