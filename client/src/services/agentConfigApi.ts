const API_BASE = import.meta.env.VITE_API_URL || "/api";

export interface AgentConfig {
  messageFrequency: "low" | "medium" | "high";
  proactivity: "reactive" | "balanced" | "proactive";
  maxMessagesPerMinute: number;
  canUploadAttachments: boolean;
  canCreateTasks: boolean;
  canUpdateTaskStatus: boolean;
  canDeleteMessages: boolean;
  suppressMetaReflections: boolean;
  maxResponseLength: number;
  language: "de" | "en";
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  messageFrequency: "medium",
  proactivity: "reactive",
  maxMessagesPerMinute: 5,
  canUploadAttachments: true,
  canCreateTasks: false,
  canUpdateTaskStatus: true,
  canDeleteMessages: false,
  suppressMetaReflections: true,
  maxResponseLength: 4000,
  language: "de",
};

export interface AgentConfigResponse {
  agentTokenId: string;
  name?: string;
  config: AgentConfig;
}

async function readError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = await response.json();
    return new Error(String(body?.error || fallback));
  } catch {
    return new Error(fallback);
  }
}

export async function fetchAgentConfig(
  agentTokenId: string,
  token: string,
): Promise<AgentConfigResponse> {
  const res = await fetch(`${API_BASE}/agents/${agentTokenId}/config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw await readError(res, `Failed to fetch config (${res.status})`);
  }
  const data = (await res.json()) as AgentConfigResponse;
  return {
    ...data,
    config: {
      ...DEFAULT_AGENT_CONFIG,
      ...(data?.config || {}),
    },
  };
}

export async function updateAgentConfig(
  agentTokenId: string,
  patch: Partial<AgentConfig>,
  token: string,
): Promise<AgentConfigResponse> {
  const res = await fetch(`${API_BASE}/agents/${agentTokenId}/config`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw await readError(res, `Failed to update config (${res.status})`);
  }
  const data = (await res.json()) as AgentConfigResponse;
  return {
    ...data,
    config: {
      ...DEFAULT_AGENT_CONFIG,
      ...(data?.config || {}),
    },
  };
}
