import { apiClient } from '../lib/apiClient';
import { readError } from '../lib/apiError';

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
  connectionScope?: "user" | "global" | null;
  hasPersonalConnection?: boolean;
  hasGlobalFallback?: boolean;
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
