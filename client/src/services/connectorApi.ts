import { apiClient } from '../lib/apiClient';
import { readError } from '../lib/apiError';
import { API_BASE } from '../lib/apiBase';

export interface ConnectorAction {
  id: string;
  name: string;
  description: string;
}

export interface ConnectorInfo {
  id: string;
  name: string;
  provider: string;
  scope: string;
  icon?: string;
  category: string;
  status: "connected" | "expiring" | "expired" | "error" | "disconnected";
  integrationId?: string;
  connectionScope?: "user" | null;
  hasPersonalConnection?: boolean;
  userConnectionCount?: number;
  actions: ConnectorAction[];
}

export async function fetchConnectors(): Promise<ConnectorInfo[]> {
  const res = await apiClient(`/api/agents/connectors/catalog`);
  if (!res.ok)
    throw await readError(
      res,
      `Fehler beim Laden der Connectoren (${res.status})`,
    );
  const data = await res.json();
  return data.items || [];
}

export async function fetchUserConnectors(): Promise<ConnectorInfo[]> {
  const res = await apiClient(`/api/integrations/connectors`);
  if (!res.ok)
    throw await readError(
      res,
      `Fehler beim Laden deiner Verbindungen (${res.status})`,
    );
  const data = await res.json();
  return data.items || [];
}

/**
 * Start an OAuth connect flow. The browser leaves the app by navigation, which
 * cannot carry an Authorization header, so the session JWT is never put in the
 * URL: a short-lived token bound to this provider and scope is minted first
 * (authenticated by header) and passed as `st`. The same response sets a
 * cookie that only this browser holds, and the start route needs both.
 */
export async function startOAuthConnect(connector: {
  provider: string;
  scope: string;
}): Promise<void> {
  const res = await apiClient(`/api/integrations/oauth/start-token`, {
    method: "POST",
    // The response sets the cookie that binds the token to this browser. A
    // same-origin deploy stores it by default; "include" also covers an API
    // on another origin of the same site (VITE_API_URL), where the default
    // would drop it and the start route would then refuse the token.
    credentials: "include",
    body: JSON.stringify({
      provider: connector.provider,
      scope: connector.scope,
    }),
  });
  if (!res.ok)
    throw await readError(
      res,
      `Fehler beim Starten der Verbindung (${res.status})`,
    );
  const { token } = (await res.json()) as { token: string };
  window.location.href =
    `${API_BASE}/api/integrations/oauth/start` +
    `?provider=${encodeURIComponent(connector.provider)}` +
    `&scope=${encodeURIComponent(connector.scope)}` +
    `&st=${encodeURIComponent(token)}`;
}

export async function revokeUserIntegration(
  id: string,
): Promise<void> {
  const res = await apiClient(`/api/integrations/by-id/${id}`, {
    method: "DELETE",
  });
  if (!res.ok)
    throw await readError(
      res,
      `Fehler beim Trennen deiner Verbindung (${res.status})`,
    );
}


export interface ConnectorPermission {
  id: string;
  connectorId: string;
  allowedActions: string[];
  grantedBy: string;
  createdAt: string;
}

export interface PermissionUpdate {
  connectorId: string;
  allowedActions: string[];
}

export async function fetchPermissions(
  agentTokenId: string,
): Promise<ConnectorPermission[]> {
  const res = await apiClient(`/api/agents/${agentTokenId}/permissions`);
  if (!res.ok)
    throw await readError(
      res,
      `Fehler beim Laden der Berechtigungen (${res.status})`,
    );
  const data = await res.json();
  return data.items || [];
}

export async function updatePermissions(
  agentTokenId: string,
  permissions: PermissionUpdate[],
): Promise<void> {
  const res = await apiClient(`/api/agents/${agentTokenId}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ permissions }),
  });
  if (!res.ok)
    throw await readError(
      res,
      `Fehler beim Speichern der Berechtigungen (${res.status})`,
    );
}
