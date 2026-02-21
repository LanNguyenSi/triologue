import { create } from "zustand";

export interface AgentInfo {
  username: string;
  displayName: string;
  mentionKey: string;
  emoji: string;
  color: string;
  trustLevel: string;
}

interface AgentStore {
  /** Map of userId → AgentInfo */
  agents: Record<string, AgentInfo>;
  loaded: boolean;
  loadAgents: () => Promise<void>;
  getAgent: (userId: string) => AgentInfo | null;
  getAgentEmoji: (userId: string, fallbackUserType?: string) => string;
  getAgentColor: (userId: string, fallbackUserType?: string) => string;
  isAgent: (userType: string) => boolean;
}

const API_URL = import.meta.env.VITE_API_URL || "";

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: {},
  loaded: false,

  loadAgents: async () => {
    try {
      const res = await fetch(`${API_URL}/api/agents/info`);
      if (res.ok) {
        const data = await res.json();
        set({ agents: data, loaded: true });
      }
    } catch (err) {
      console.error("Failed to load agent info:", err);
    }
  },

  getAgent: (userId: string) => {
    return get().agents[userId] || null;
  },

  getAgentEmoji: (userId: string, fallbackUserType?: string) => {
    const agent = get().agents[userId];
    if (agent) return agent.emoji;
    // Fallback for legacy userTypes during migration
    if (fallbackUserType === "AI_ICE") return "🧊";
    if (fallbackUserType === "AI_LAVA") return "🌋";
    if (fallbackUserType === "AI_OTHER" || fallbackUserType === "AI_AGENT") return "🤖";
    return "";
  },

  getAgentColor: (userId: string, fallbackUserType?: string) => {
    const agent = get().agents[userId];
    if (agent) return agent.color;
    if (fallbackUserType === "AI_ICE") return "#00d4ff";
    if (fallbackUserType === "AI_LAVA") return "#ff4500";
    return "#888888";
  },

  isAgent: (userType: string) => {
    return ["AI_AGENT", "AI_ICE", "AI_LAVA", "AI_OTHER"].includes(userType);
  },
}));
