import { apiClient } from '../lib/apiClient';

export interface AuditEntry {
  id: string;
  timestamp: string;
  // Null when the acting user has since self-deleted their account: the
  // row survives, anonymised (AgentAuditLog.agentId, onDelete: SetNull; see
  // docs/okf/prisma-data-model-invariants.md, Invariant 6).
  agentId: string | null;
  agentName?: string;
  agentUsername?: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  success: boolean;
  details: Record<string, unknown> | null;
  durationMs: number | null;
}

export interface AuditResponse {
  items: AuditEntry[];
  totalCount: number;
}

export async function fetchProjectActivity(
  projectId: string,
  params: {
    limit?: number;
    offset?: number;
    action?: string;
    agentId?: string;
    success?: string;
  },
): Promise<AuditResponse> {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.offset) searchParams.set("offset", String(params.offset));
  if (params.action) searchParams.set("action", params.action);
  if (params.agentId) searchParams.set("agentId", params.agentId);
  if (params.success) searchParams.set("success", params.success);

  const res = await apiClient(
    `/api/projects/${projectId}/activity?${searchParams}`,
  );
  if (!res.ok) throw new Error(`Failed to fetch activity: ${res.status}`);
  return res.json();
}
