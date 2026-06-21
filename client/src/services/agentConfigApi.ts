import { apiClient } from '../lib/apiClient';
import { readError } from '../lib/apiError';

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

export async function fetchAgentConfig(
  agentTokenId: string,
): Promise<AgentConfigResponse> {
  const res = await apiClient(`/api/agents/${agentTokenId}/config`);
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
): Promise<AgentConfigResponse> {
  const res = await apiClient(`/api/agents/${agentTokenId}/config`, {
    method: "PATCH",
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
