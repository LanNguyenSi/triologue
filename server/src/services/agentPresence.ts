/**
 * Agent presence: the live status of an agent's running session(s), written
 * by the agent gateway through POST /api/agents/me/presence and read by the
 * room detail route to show it next to the agent's name.
 *
 * Stored in Redis under `agent_presence:<agentUserId>` as JSON with a TTL
 * the writer chooses (30 to 300 seconds, default 120), so a gateway or a
 * session that stops reporting falls back to the ordinary presence
 * (`online_users`, `AgentToken.lastUsedAt`) after at most that long. No
 * database column is involved.
 */

export const AGENT_PRESENCE_STATUSES = ["online", "working", "waiting_approval", "error"] as const;
export type AgentPresenceStatus = (typeof AGENT_PRESENCE_STATUSES)[number];

export const AGENT_PRESENCE_TTL_DEFAULT_SECONDS = 120;
export const AGENT_PRESENCE_TTL_MIN_SECONDS = 30;
export const AGENT_PRESENCE_TTL_MAX_SECONDS = 300;

export interface AgentPresence {
  status: AgentPresenceStatus;
  /** The reporting session, when the writer knows one. */
  sessionId: string | null;
  host: string | null;
  project: string | null;
  detail: string | null;
  /** How many sessions of the agent are live; 1 when the writer did not say. */
  sessions: number;
  updatedAt: string;
}

/** What the room participant list reports in `presenceStatus`. */
export type ParticipantPresence = "online" | "active" | "offline" | "working" | "waiting" | "error";

export function agentPresenceKey(agentUserId: string): string {
  return `agent_presence:${agentUserId}`;
}

export function isAgentPresenceStatus(value: unknown): value is AgentPresenceStatus {
  return typeof value === "string" && (AGENT_PRESENCE_STATUSES as readonly string[]).includes(value);
}

/** Parse a stored presence value; anything malformed reads as "no presence". */
export function parseAgentPresence(raw: string | null | undefined): AgentPresence | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (!isAgentPresenceStatus(p.status)) return null;
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    status: p.status,
    sessionId: str(p.sessionId),
    host: str(p.host),
    project: str(p.project),
    detail: str(p.detail),
    sessions: typeof p.sessions === "number" && Number.isInteger(p.sessions) && p.sessions >= 0 ? p.sessions : 1,
    updatedAt: str(p.updatedAt) ?? new Date(0).toISOString(),
  };
}

/** Map the gateway's status vocabulary onto the participant list's. */
export function toParticipantPresence(status: AgentPresenceStatus): ParticipantPresence {
  switch (status) {
    case "working":
      return "working";
    case "waiting_approval":
      return "waiting";
    case "error":
      return "error";
    default:
      return "online";
  }
}
