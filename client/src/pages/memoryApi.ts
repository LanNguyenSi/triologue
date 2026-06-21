export type MemoryScope = "ALL" | "GLOBAL" | "PROJECT";
export type MemoryType =
  | "core.note"
  | "risk"
  | "decision"
  | "resource"
  | "constraint"
  | "handover";

export const MEMORY_TYPE_OPTIONS: MemoryType[] = [
  "core.note",
  "risk",
  "decision",
  "resource",
  "constraint",
  "handover",
];

export interface MemoryPayloadDraft {
  note: string;
  owner: string;
  lastValidatedAt: string;
  validUntil: string;
  sourceRef: string;
  evidenceUrl: string;
  severity: string;
  impact: string;
  mitigation: string;
  decision: string;
  rationale: string;
  resourceKind: string;
  resourceRef: string;
  constraint: string;
  scopeHint: string;
  nextAction: string;
}

export const EMPTY_MEMORY_PAYLOAD_DRAFT: MemoryPayloadDraft = {
  note: "",
  owner: "",
  lastValidatedAt: "",
  validUntil: "",
  sourceRef: "",
  evidenceUrl: "",
  severity: "",
  impact: "",
  mitigation: "",
  decision: "",
  rationale: "",
  resourceKind: "",
  resourceRef: "",
  constraint: "",
  scopeHint: "",
  nextAction: "",
};

export interface MemoryProject {
  id: string;
  name: string;
}

export interface MemoryAuthor {
  id: string;
  username: string;
  displayName: string;
}

export interface MemoryEntry {
  id: string;
  scope: "GLOBAL" | "PROJECT" | string;
  projectId?: string | null;
  projectName?: string | null;
  roomId?: string | null;
  memoryType: string;
  title?: string;
  tags?: string[];
  summary?: string;
  payload?: { note?: string; summary?: string; [key: string]: unknown };
  confidence?: number;
  expiresAt?: string | null;
  freshnessStatus?: "fresh" | "stale" | "unknown" | string;
  freshnessWarning?: string | null;
  validUntil?: string | null;
  lastValidatedAt?: string | null;
  owner?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  editable?: boolean;
  createdBy?: MemoryAuthor | null;
  updatedBy?: MemoryAuthor | null;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface MemoryListResponse {
  items: MemoryEntry[];
  totalCount: number;
  pageInfo?: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

interface ProjectListResponse {
  items: MemoryProject[];
  totalCount: number;
  pageInfo?: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("triologue_token");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function memoryApi(path: string, opts?: RequestInit) {
  return fetch(path, {
    ...opts,
    headers: {
      ...(opts?.headers || {}),
      ...authHeaders(),
    },
  });
}

export async function fetchMemoryProjects(): Promise<MemoryProject[]> {
  const response = await memoryApi("/api/projects?limit=200");
  if (!response.ok) return [];

  const data = await response.json();
  const payload: ProjectListResponse = Array.isArray(data)
    ? {
        items: data,
        totalCount: data.length,
        pageInfo: { limit: 200, hasMore: false, nextCursor: null },
      }
    : data;

  return (payload.items || [])
    .map((entry) => ({
      id: String(entry?.id || ""),
      name: String(entry?.name || ""),
    }))
    .filter((entry: MemoryProject) => entry.id && entry.name);
}

export function parseTags(value: string): string[] {
  const tags = value
    .split(/,|\n/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(tags)).slice(0, 12);
}

export function formatDate(value?: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function toDateInputValue(value?: unknown): string {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (DATE_ONLY_PATTERN.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function toMemoryType(value?: unknown): MemoryType {
  const normalized = String(value || "").trim().toLowerCase();
  if (MEMORY_TYPE_OPTIONS.includes(normalized as MemoryType)) {
    return normalized as MemoryType;
  }
  return "core.note";
}

export function toPayloadDraft(entry?: MemoryEntry | null): MemoryPayloadDraft {
  const payload = entry?.payload && typeof entry.payload === "object" ? entry.payload : {};
  return {
    note: String(payload.note || entry?.summary || ""),
    owner: String(payload.owner || entry?.owner || ""),
    lastValidatedAt: toDateInputValue(payload.lastValidatedAt),
    validUntil: toDateInputValue(payload.validUntil || entry?.validUntil || entry?.expiresAt),
    sourceRef: String(payload.sourceRef || ""),
    evidenceUrl: String(payload.evidenceUrl || ""),
    severity: String(payload.severity || ""),
    impact: String(payload.impact || ""),
    mitigation: String(payload.mitigation || ""),
    decision: String(payload.decision || ""),
    rationale: String(payload.rationale || ""),
    resourceKind: String(payload.resourceKind || ""),
    resourceRef: String(payload.resourceRef || ""),
    constraint: String(payload.constraint || ""),
    scopeHint: String(payload.scopeHint || ""),
    nextAction: String(payload.nextAction || ""),
  };
}

export function buildPayloadForMemoryType(
  memoryType: MemoryType,
  draft: MemoryPayloadDraft,
): Record<string, string> {
  const payload: Record<string, string> = {};

  const add = (key: keyof MemoryPayloadDraft, value = draft[key]) => {
    const normalized = String(value || "").trim();
    if (normalized) payload[key] = normalized;
  };

  add("owner");
  add("lastValidatedAt");
  add("validUntil");
  add("sourceRef");
  add("evidenceUrl");
  add("note");

  if (memoryType === "risk") {
    add("severity");
    add("impact");
    add("mitigation");
  } else if (memoryType === "decision") {
    add("decision");
    add("rationale");
  } else if (memoryType === "resource") {
    add("resourceKind");
    add("resourceRef");
  } else if (memoryType === "constraint") {
    add("constraint");
    add("scopeHint");
  } else if (memoryType === "handover") {
    add("nextAction");
    add("owner");
  }

  return payload;
}
