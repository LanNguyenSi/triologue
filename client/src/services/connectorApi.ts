const API_BASE = import.meta.env.VITE_API_URL || "/api";

export interface ConnectorAction {
  id: string;
  name: string;
  description: string;
}

export interface ConnectorInfo {
  id: string;
  name: string;
  provider: string;
  icon?: string;
  category: string;
  status: "connected" | "expiring" | "expired" | "error" | "disconnected";
  integrationId?: string;
  actions: ConnectorAction[];
}

export interface Integration {
  id: string;
  provider: string;
  scope: string;
  tenantId: string | null;
  status: string;
  expiresAt: string;
  createdBy: string;
}

async function readError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = await response.json();
    return new Error(String(body?.error || fallback));
  } catch {
    return new Error(fallback);
  }
}

export async function fetchConnectors(token: string): Promise<ConnectorInfo[]> {
  const res = await fetch(`${API_BASE}/admin/connectors`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw await readError(
      res,
      `Fehler beim Laden der Connectoren (${res.status})`,
    );
  const data = await res.json();
  return data.items || [];
}

export async function fetchIntegrations(token: string): Promise<Integration[]> {
  const res = await fetch(`${API_BASE}/admin/integrations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw await readError(
      res,
      `Fehler beim Laden der Integrationen (${res.status})`,
    );
  const data = await res.json();
  return data.items || [];
}

export async function revokeIntegration(
  id: string,
  token: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/integrations/by-id/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw await readError(
      res,
      `Fehler beim Trennen der Integration (${res.status})`,
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
  token: string,
): Promise<ConnectorPermission[]> {
  const res = await fetch(`${API_BASE}/agents/${agentTokenId}/permissions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
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
  token: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/agents/${agentTokenId}/permissions`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ permissions }),
  });
  if (!res.ok)
    throw await readError(
      res,
      `Fehler beim Speichern der Berechtigungen (${res.status})`,
    );
}
