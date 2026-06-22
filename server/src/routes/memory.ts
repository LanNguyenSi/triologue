import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import prisma from "../lib/prisma";

const router = Router();
const CORE_MEMORY_PLUGIN_ID = "core-agent-memory";
const MEMORY_TYPES = [
  "core.note",
  "risk",
  "decision",
  "resource",
  "constraint",
  "handover",
] as const;

type MemoryScope = "GLOBAL" | "PROJECT" | "ALL";

function normalizeScope(value: unknown, fallback: MemoryScope = "ALL"): MemoryScope {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "GLOBAL" || normalized === "PROJECT" || normalized === "ALL") {
    return normalized;
  }
  return fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseMemoryType(value: unknown, fallback = "core.note"): string {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

function isAllowedMemoryType(value: string): boolean {
  return (MEMORY_TYPES as readonly string[]).includes(value);
}

function parseConfidence(value: unknown, fallback = 0.7): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Number(clampNumber(value, 0, 1).toFixed(2));
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    const tags: string[] = [];
    for (const item of value) {
      const tag = typeof item === "string" ? item.trim().toLowerCase() : "";
      if (!tag || tags.includes(tag)) continue;
      tags.push(tag.slice(0, 48));
      if (tags.length >= 12) break;
    }
    return tags;
  }

  const raw = typeof value === "string" ? value : "";
  if (!raw.trim()) return [];
  return Array.from(
    new Set(
      raw
        .split(/,|\n/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  )
    .slice(0, 12)
    .map((item) => item.slice(0, 48));
}

function toSummary(payload: Record<string, unknown>): string {
  const summary = String(payload?.summary || "").trim();
  if (summary) return summary.slice(0, 180);
  const note = String(payload?.note || "").trim();
  if (note) return note.slice(0, 180);
  const decision = String(payload?.decision || "").trim();
  if (decision) return decision.slice(0, 180);
  const text = JSON.stringify(payload || {});
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

function toExpiresAt(days: unknown): Date | null {
  const parsed = Number(days);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return null;
  if (parsed <= 0) return null;
  const clamped = clampNumber(Math.round(parsed), 1, 3650);
  const value = new Date();
  value.setDate(value.getDate() + clamped);
  return value;
}

function parseDateInput(
  value: unknown,
  fieldName: string,
): { provided: boolean; date: Date | null; error?: string } {
  if (value === undefined) return { provided: false, date: null };
  if (value === null) return { provided: true, date: null };
  const raw = String(value).trim();
  if (!raw) return { provided: true, date: null };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { provided: true, date: null, error: `${fieldName} must be a valid date` };
  }
  return { provided: true, date: parsed };
}

function upsertPayloadText(
  payload: Record<string, unknown>,
  key: string,
  maxLength: number,
) {
  if (payload[key] === undefined) return;
  const value = String(payload[key] || "").trim().slice(0, maxLength);
  if (value) payload[key] = value;
  else delete payload[key];
}

function normalizePayload(payload: Record<string, unknown>) {
  const fields: Array<[string, number]> = [
    ["note", 6000],
    ["summary", 180],
    ["owner", 120],
    ["severity", 24],
    ["impact", 4000],
    ["mitigation", 4000],
    ["decision", 4000],
    ["rationale", 4000],
    ["resourceKind", 120],
    ["resourceRef", 500],
    ["sourceRef", 600],
    ["evidenceUrl", 1000],
    ["constraint", 4000],
    ["scopeHint", 300],
    ["nextAction", 500],
  ];
  for (const [field, maxLength] of fields) {
    upsertPayloadText(payload, field, maxLength);
  }
}

function normalizeFreshness(
  payload: Record<string, unknown>,
): { error?: string; validUntilDate: Date | null; validUntilProvided: boolean } {
  const lastValidated = parseDateInput(payload.lastValidatedAt, "payload.lastValidatedAt");
  if (lastValidated.error) return { error: lastValidated.error, validUntilDate: null, validUntilProvided: false };
  if (lastValidated.provided) {
    if (lastValidated.date) payload.lastValidatedAt = lastValidated.date.toISOString();
    else delete payload.lastValidatedAt;
  }

  const validUntil = parseDateInput(payload.validUntil, "payload.validUntil");
  if (validUntil.error) return { error: validUntil.error, validUntilDate: null, validUntilProvided: false };
  if (validUntil.provided) {
    if (validUntil.date) payload.validUntil = validUntil.date.toISOString();
    else delete payload.validUntil;
  }

  return {
    validUntilDate: validUntil.date,
    validUntilProvided: validUntil.provided,
  };
}

function ensureTypedMemoryPayload(memoryType: string, payload: Record<string, unknown>): string | null {
  const type = memoryType.toLowerCase();
  const requiredText = (field: string) => String(payload[field] || "").trim();
  const note = requiredText("note");
  switch (type) {
    case "core.note":
      if (!note) return "note is required for core.note memory";
      return null;
    case "risk":
      if (!note) return "note is required for risk memory";
      if (!requiredText("severity")) return "severity is required for risk memory";
      if (!requiredText("impact")) return "impact is required for risk memory";
      if (!requiredText("mitigation")) return "mitigation is required for risk memory";
      return null;
    case "decision":
      if (!requiredText("decision")) return "decision is required for decision memory";
      if (!requiredText("rationale")) return "rationale is required for decision memory";
      return null;
    case "resource":
      if (!requiredText("resourceKind")) return "resourceKind is required for resource memory";
      if (!requiredText("resourceRef")) return "resourceRef is required for resource memory";
      return null;
    case "constraint":
      if (!requiredText("constraint")) return "constraint is required for constraint memory";
      if (!requiredText("scopeHint")) return "scopeHint is required for constraint memory";
      return null;
    case "handover":
      if (!requiredText("nextAction")) return "nextAction is required for handover memory";
      if (!requiredText("owner")) return "owner is required for handover memory";
      return null;
    default:
      return null;
  }
}

function parseDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function deriveFreshnessMeta(
  payload: Record<string, unknown>,
  expiresAtRaw: unknown,
  now: Date,
) {
  const expiresAtDate = parseDateOrNull(expiresAtRaw);
  const payloadValidUntil = parseDateOrNull(payload.validUntil);
  const validUntilDate = expiresAtDate || payloadValidUntil;
  const lastValidatedAtDate = parseDateOrNull(payload.lastValidatedAt);
  const owner = String(payload.owner || "").trim() || null;

  const isStale = Boolean(validUntilDate && validUntilDate.getTime() <= now.getTime());
  const status = isStale ? "stale" : validUntilDate ? "fresh" : "unknown";
  const warning = isStale
    ? "Memory entry is stale and should be reviewed."
    : null;

  return {
    freshnessStatus: status,
    freshnessWarning: warning,
    validUntil: validUntilDate ? validUntilDate.toISOString() : null,
    lastValidatedAt: lastValidatedAtDate ? lastValidatedAtDate.toISOString() : null,
    owner,
    isStale,
  };
}

async function loadProjectAccess(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      roomId: true,
      ownerId: true,
      teamMemberIds: true,
    },
  });
  if (!project) return null;
  const isMember =
    project.ownerId === userId || (project.teamMemberIds || []).includes(userId);
  if (!isMember) return null;
  return project;
}

async function loadAccessibleProjects(userId: string) {
  const rows = await prisma.project.findMany({
    where: {
      OR: [{ ownerId: userId }, { teamMemberIds: { has: userId } }],
    },
    select: { id: true, name: true, ownerId: true },
    take: 500,
  });

  const map = new Map<string, { id: string; name: string; ownerId: string }>();
  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

function canEditProjectEntry(params: {
  isAdmin: boolean;
  userId: string;
  createdBy: string;
  projectOwnerId?: string;
}) {
  if (params.isAdmin) return true;
  if (params.createdBy === params.userId) return true;
  if (params.projectOwnerId && params.projectOwnerId === params.userId) return true;
  return false;
}

router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const isAdmin = Boolean(req.user?.isAdmin);
    const scope = normalizeScope(req.query.scope, "ALL");
    const projectId = String(req.query.projectId || "").trim();
    const includeArchived = String(req.query.includeArchived || "").toLowerCase() === "true";
    const includeExpiredRaw = String(req.query.includeExpired || "").toLowerCase();
    const excludeExpired = includeExpiredRaw === "false";
    const searchRaw = String(req.query.search || "").trim();
    const search = searchRaw.slice(0, 100);
    const searchTag = search.toLowerCase();
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? clampNumber(limitRaw, 1, 200) : 80;
    const cursorRaw = String(req.query.cursor || "").trim();
    const parsedOffset = Number.parseInt(cursorRaw, 10);
    const offset =
      cursorRaw && Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
    const now = new Date();

    const accessibleProjects = await loadAccessibleProjects(userId);
    const accessibleProjectIds = Array.from(accessibleProjects.keys());

    if (projectId) {
      const access = await loadProjectAccess(projectId, userId);
      if (!access) {
        return res.status(403).json({ error: "No access to requested project scope" });
      }
    }

    const andConditions: Prisma.AgentMemoryEntryWhereInput[] = [];
    if (!includeArchived) andConditions.push({ archivedAt: null });
    if (excludeExpired) {
      andConditions.push({
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      });
    }
    if (search) {
      andConditions.push({
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { memoryType: { contains: search, mode: "insensitive" } },
          { pluginId: { contains: search, mode: "insensitive" } },
          { moduleKey: { contains: search, mode: "insensitive" } },
          { tags: { has: searchTag } },
        ],
      });
    }

    let scopeFilter: Prisma.AgentMemoryEntryWhereInput = {};
    if (scope === "GLOBAL") {
      scopeFilter = { scope: "GLOBAL" };
    } else if (scope === "PROJECT") {
      if (projectId) {
        scopeFilter = { scope: "PROJECT", projectId };
      } else {
        if (accessibleProjectIds.length === 0) {
          return res.json({
            items: [],
            totalCount: 0,
            pageInfo: { limit, hasMore: false, nextCursor: null },
          });
        }
        scopeFilter = { scope: "PROJECT", projectId: { in: accessibleProjectIds } };
      }
    } else {
      if (projectId) {
        scopeFilter = {
          OR: [{ scope: "GLOBAL" }, { scope: "PROJECT", projectId }],
        };
      } else if (accessibleProjectIds.length > 0) {
        scopeFilter = {
          OR: [
            { scope: "GLOBAL" },
            { scope: "PROJECT", projectId: { in: accessibleProjectIds } },
          ],
        };
      } else {
        scopeFilter = { scope: "GLOBAL" };
      }
    }

    const where = {
      AND: [scopeFilter, ...andConditions],
    };

    const [rows, totalCount] = await Promise.all([
      prisma.agentMemoryEntry.findMany({
        where,
        orderBy: [
          { isPinned: "desc" },
          { updatedAt: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        skip: offset,
        take: limit + 1,
        select: {
          id: true,
          scope: true,
          projectId: true,
          roomId: true,
          pluginId: true,
          moduleKey: true,
          memoryType: true,
          title: true,
          tags: true,
          isPinned: true,
          payload: true,
          confidence: true,
          sourceRunId: true,
          expiresAt: true,
          archivedAt: true,
          createdBy: true,
          updatedBy: true,
          createdAt: true,
          updatedAt: true,
          project: {
            select: { id: true, name: true, ownerId: true },
          },
          creator: {
            select: { id: true, username: true, displayName: true },
          },
          updater: {
            select: { id: true, username: true, displayName: true },
          },
        },
      }),
      prisma.agentMemoryEntry.count({ where }),
    ]);

    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? String(offset + visibleRows.length) : null;

    const items = visibleRows.map((row) => {
      const payload: Record<string, unknown> = row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : {};
      const freshness = deriveFreshnessMeta(payload, row.expiresAt, now);
      const projectOwnerId = row.project?.ownerId || accessibleProjects.get(row.projectId || "")?.ownerId;
      const editable =
        row.scope === "GLOBAL"
          ? isAdmin
          : canEditProjectEntry({
              isAdmin,
              userId,
              createdBy: row.createdBy,
              projectOwnerId,
            });
      return {
        id: row.id,
        scope: String(row.scope || "PROJECT"),
        projectId: row.projectId || null,
        projectName: row.project?.name || null,
        roomId: row.roomId || null,
        pluginId: row.pluginId,
        moduleKey: row.moduleKey || null,
        memoryType: row.memoryType,
        title: row.title || "",
        tags: Array.isArray(row.tags) ? row.tags : [],
        isPinned: Boolean(row.isPinned),
        payload,
        summary: toSummary(payload),
        confidence: Number(row.confidence || 0),
        sourceRunId: row.sourceRunId || null,
        expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
        archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
        freshnessStatus: freshness.freshnessStatus,
        freshnessWarning: freshness.freshnessWarning,
        validUntil: freshness.validUntil,
        lastValidatedAt: freshness.lastValidatedAt,
        owner: freshness.owner,
        createdBy: {
          id: row.creator?.id || row.createdBy,
          username: row.creator?.username || "",
          displayName: row.creator?.displayName || "",
        },
        updatedBy: row.updater
          ? {
              id: row.updater.id,
              username: row.updater.username || "",
              displayName: row.updater.displayName || "",
            }
          : null,
        editable,
      };
    });

    return res.json({
      items,
      totalCount,
      pageInfo: {
        limit,
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load memory" });
  }
});

router.post("/", authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const isAdmin = Boolean(req.user?.isAdmin);
    const scope = normalizeScope(req.body?.scope, "GLOBAL");
    const projectId = String(req.body?.projectId || "").trim();
    const memoryType = parseMemoryType(req.body?.memoryType, "core.note");
    if (!isAllowedMemoryType(memoryType)) {
      return res.status(400).json({ error: `memoryType must be one of: ${MEMORY_TYPES.join(", ")}` });
    }
    const title = String(req.body?.title || "").trim().slice(0, 160);
    const note = String(req.body?.note || "").trim().slice(0, 6000);
    const payloadPatch =
      req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};
    const tags = parseTags(req.body?.tags);
    const confidence = parseConfidence(req.body?.confidence, 0.72);
    const isPinned = Boolean(req.body?.isPinned);

    if (scope === "GLOBAL" && !isAdmin) {
      return res.status(403).json({ error: "Global memory write requires admin" });
    }

    let project: Awaited<ReturnType<typeof loadProjectAccess>> = null;
    let roomId: string | null = null;
    if (scope === "PROJECT") {
      if (!projectId) {
        return res.status(400).json({ error: "projectId is required for project memory" });
      }
      project = await loadProjectAccess(projectId, userId);
      if (!project) {
        return res.status(403).json({ error: "No project access" });
      }
      roomId = project.roomId || null;
    }

    const payload = {
      ...(payloadPatch && typeof payloadPatch === "object" ? payloadPatch : {}),
      ...(note ? { note, summary: note.slice(0, 180) } : {}),
    };
    normalizePayload(payload);
    const freshness = normalizeFreshness(payload);
    if (freshness.error) return res.status(400).json({ error: freshness.error });

    const explicitExpiresAt = parseDateInput(req.body?.expiresAt, "expiresAt");
    if (explicitExpiresAt.error) return res.status(400).json({ error: explicitExpiresAt.error });

    const expiresByDays =
      req.body?.expiresInDays !== undefined ? toExpiresAt(req.body?.expiresInDays) : null;
    const expiresAt = explicitExpiresAt.provided
      ? explicitExpiresAt.date
      : expiresByDays || freshness.validUntilDate || null;

    if (expiresAt) {
      payload.validUntil = expiresAt.toISOString();
    } else if (
      explicitExpiresAt.provided ||
      req.body?.expiresInDays !== undefined ||
      freshness.validUntilProvided
    ) {
      delete payload.validUntil;
    }

    if (!note && Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "Either note or payload is required" });
    }
    const typeValidationError = ensureTypedMemoryPayload(memoryType, payload);
    if (typeValidationError) return res.status(400).json({ error: typeValidationError });

    const created = await prisma.agentMemoryEntry.create({
      data: {
        scope,
        projectId: scope === "PROJECT" ? projectId : null,
        roomId,
        pluginId: CORE_MEMORY_PLUGIN_ID,
        moduleKey: scope === "GLOBAL" ? "global" : "project",
        memoryType,
        title: title || null,
        tags,
        isPinned: scope === "GLOBAL" ? Boolean(isPinned && isAdmin) : isPinned,
        payload: payload as Prisma.InputJsonValue,
        confidence,
        expiresAt,
        sourceRunId: null,
        createdBy: userId,
        updatedBy: userId,
      },
    });

    return res.status(201).json({ id: created.id });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create memory entry" });
  }
});

router.get("/:id", authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const isAdmin = Boolean(req.user?.isAdmin);
    const memoryId = String(req.params.id || "").trim();
    if (!memoryId) return res.status(400).json({ error: "id is required" });

    const row = await prisma.agentMemoryEntry.findUnique({
      where: { id: memoryId },
      select: {
        id: true,
        scope: true,
        projectId: true,
        roomId: true,
        pluginId: true,
        moduleKey: true,
        memoryType: true,
        title: true,
        tags: true,
        isPinned: true,
        payload: true,
        confidence: true,
        sourceRunId: true,
        expiresAt: true,
        archivedAt: true,
        createdBy: true,
        updatedBy: true,
        createdAt: true,
        updatedAt: true,
        project: {
          select: { id: true, name: true, ownerId: true },
        },
        creator: {
          select: { id: true, username: true, displayName: true },
        },
        updater: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });

    if (!row) return res.status(404).json({ error: "Memory entry not found" });

    const accessibleProjects = await loadAccessibleProjects(userId);
    if (row.scope === "PROJECT") {
      if (!row.projectId) {
        return res.status(404).json({ error: "Memory entry project scope is invalid" });
      }
      const access = await loadProjectAccess(row.projectId, userId);
      if (!access) return res.status(403).json({ error: "No access to requested project scope" });
    }

    const payload: Record<string, unknown> = row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : {};
    const now = new Date();
    const freshness = deriveFreshnessMeta(payload, row.expiresAt, now);
    const projectOwnerId =
      row.project?.ownerId || accessibleProjects.get(row.projectId || "")?.ownerId;
    const editable =
      row.scope === "GLOBAL"
        ? isAdmin
        : canEditProjectEntry({
            isAdmin,
            userId,
            createdBy: row.createdBy,
            projectOwnerId,
          });

    return res.json({
      id: row.id,
      scope: String(row.scope || "PROJECT"),
      projectId: row.projectId || null,
      projectName: row.project?.name || null,
      roomId: row.roomId || null,
      pluginId: row.pluginId,
      moduleKey: row.moduleKey || null,
      memoryType: row.memoryType,
      title: row.title || "",
      tags: Array.isArray(row.tags) ? row.tags : [],
      isPinned: Boolean(row.isPinned),
      payload,
      summary: toSummary(payload),
      confidence: Number(row.confidence || 0),
      sourceRunId: row.sourceRunId || null,
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      freshnessStatus: freshness.freshnessStatus,
      freshnessWarning: freshness.freshnessWarning,
      validUntil: freshness.validUntil,
      lastValidatedAt: freshness.lastValidatedAt,
      owner: freshness.owner,
      createdBy: {
        id: row.creator?.id || row.createdBy,
        username: row.creator?.username || "",
        displayName: row.creator?.displayName || "",
      },
      updatedBy: row.updater
        ? {
            id: row.updater.id,
            username: row.updater.username || "",
            displayName: row.updater.displayName || "",
          }
        : null,
      editable,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load memory entry" });
  }
});

router.patch("/:id", authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const isAdmin = Boolean(req.user?.isAdmin);
    const memoryId = String(req.params.id || "").trim();
    if (!memoryId) return res.status(400).json({ error: "id is required" });

    const existing = await prisma.agentMemoryEntry.findUnique({
      where: { id: memoryId },
      select: {
        id: true,
        scope: true,
        projectId: true,
        memoryType: true,
        createdBy: true,
        payload: true,
        project: { select: { ownerId: true } },
      },
    });

    if (!existing) return res.status(404).json({ error: "Memory entry not found" });

    let allowed = false;
    if (existing.scope === "GLOBAL") {
      allowed = isAdmin;
    } else {
      const project = existing.projectId
        ? await loadProjectAccess(existing.projectId, userId)
        : null;
      if (existing.projectId && !project) {
        return res.status(403).json({ error: "No project access" });
      }
      allowed = canEditProjectEntry({
        isAdmin,
        userId,
        createdBy: existing.createdBy,
        projectOwnerId: existing.project?.ownerId || project?.ownerId,
      });
    }

    if (!allowed) {
      return res.status(403).json({ error: "No permission to edit this entry" });
    }

    const titleRaw = req.body?.title;
    const title =
      titleRaw === undefined ? undefined : String(titleRaw || "").trim().slice(0, 160);
    const memoryTypeRaw = req.body?.memoryType;
    const memoryType =
      memoryTypeRaw === undefined
        ? undefined
        : parseMemoryType(memoryTypeRaw, "core.note");
    if (memoryType !== undefined && !isAllowedMemoryType(memoryType)) {
      return res.status(400).json({ error: `memoryType must be one of: ${MEMORY_TYPES.join(", ")}` });
    }
    const tags = req.body?.tags === undefined ? undefined : parseTags(req.body.tags);
    const confidence =
      req.body?.confidence === undefined
        ? undefined
        : parseConfidence(req.body.confidence, 0.7);
    const isPinned =
      req.body?.isPinned === undefined
        ? undefined
        : Boolean(req.body.isPinned && (existing.scope !== "GLOBAL" || isAdmin));
    const archived =
      req.body?.archived === undefined ? undefined : Boolean(req.body.archived);

    const payloadBase: Record<string, unknown> =
      existing.payload && typeof existing.payload === "object" ? existing.payload as Record<string, unknown> : {};
    const payloadPatch =
      req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : null;
    const noteInput = req.body?.note;
    let payloadNext: Record<string, unknown> | undefined;
    if (payloadPatch || noteInput !== undefined) {
      const nextPayload: Record<string, unknown> = {
        ...payloadBase,
        ...(payloadPatch || {}),
      };
      if (noteInput !== undefined) {
        const note = String(noteInput || "").trim().slice(0, 6000);
        if (note) {
          nextPayload.note = note;
          nextPayload.summary = note.slice(0, 180);
        } else {
          delete nextPayload.note;
          if (!payloadPatch || payloadPatch.summary === undefined) {
            delete nextPayload.summary;
          }
        }
      }
      payloadNext = nextPayload;
    }

    const effectiveMemoryType = memoryType ?? String(existing.memoryType || "core.note");
    let effectivePayload = payloadNext;
    if (effectivePayload) {
      normalizePayload(effectivePayload);
      const freshness = normalizeFreshness(effectivePayload);
      if (freshness.error) return res.status(400).json({ error: freshness.error });
    }

    const explicitExpiresAt = parseDateInput(req.body?.expiresAt, "expiresAt");
    if (explicitExpiresAt.error) return res.status(400).json({ error: explicitExpiresAt.error });
    const clearExpires = req.body?.clearExpires === true;
    const hasExpiresInDays = req.body?.expiresInDays !== undefined;

    let expiresAt: Date | null | undefined = undefined;
    if (clearExpires) {
      expiresAt = null;
    } else if (explicitExpiresAt.provided) {
      expiresAt = explicitExpiresAt.date;
    } else if (hasExpiresInDays) {
      expiresAt = toExpiresAt(req.body?.expiresInDays);
    } else if (effectivePayload && Object.prototype.hasOwnProperty.call(effectivePayload, "validUntil")) {
      const validUntil = parseDateInput(effectivePayload.validUntil, "payload.validUntil");
      if (validUntil.error) return res.status(400).json({ error: validUntil.error });
      expiresAt = validUntil.date;
    }

    if (clearExpires || explicitExpiresAt.provided || hasExpiresInDays) {
      if (!effectivePayload) effectivePayload = { ...payloadBase };
      const synchronizedPayload = effectivePayload as Record<string, unknown>;
      if (expiresAt) synchronizedPayload.validUntil = expiresAt.toISOString();
      else delete synchronizedPayload.validUntil;
    }

    if (effectivePayload && (payloadPatch || noteInput !== undefined || memoryType !== undefined)) {
      const typeValidationError = ensureTypedMemoryPayload(effectiveMemoryType, effectivePayload);
      if (typeValidationError) return res.status(400).json({ error: typeValidationError });
    }

    await prisma.agentMemoryEntry.update({
      where: { id: memoryId },
      data: {
        ...(title !== undefined ? { title: title || null } : {}),
        ...(memoryType !== undefined ? { memoryType } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
        ...(isPinned !== undefined ? { isPinned } : {}),
        ...(effectivePayload !== undefined ? { payload: effectivePayload as Prisma.InputJsonValue } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
        updatedBy: userId,
      },
    });

    return res.json({ success: true, id: memoryId });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to update memory entry" });
  }
});

router.delete("/:id/permanent", authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const isAdmin = Boolean(req.user?.isAdmin);
    const memoryId = String(req.params.id || "").trim();
    if (!memoryId) return res.status(400).json({ error: "id is required" });

    const existing = await prisma.agentMemoryEntry.findUnique({
      where: { id: memoryId },
      select: {
        id: true,
        scope: true,
        projectId: true,
        createdBy: true,
        project: { select: { ownerId: true } },
      },
    });
    if (!existing) return res.status(404).json({ error: "Memory entry not found" });

    let allowed = false;
    if (existing.scope === "GLOBAL") {
      allowed = isAdmin;
    } else {
      const project = existing.projectId
        ? await loadProjectAccess(existing.projectId, userId)
        : null;
      if (existing.projectId && !project) {
        return res.status(403).json({ error: "No project access" });
      }
      allowed = canEditProjectEntry({
        isAdmin,
        userId,
        createdBy: existing.createdBy,
        projectOwnerId: existing.project?.ownerId || project?.ownerId,
      });
    }
    if (!allowed) return res.status(403).json({ error: "No permission to delete this entry" });

    await prisma.agentMemoryEntry.delete({
      where: { id: memoryId },
    });

    return res.json({ success: true, id: memoryId });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to delete memory entry" });
  }
});

router.delete("/:id", authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const isAdmin = Boolean(req.user?.isAdmin);
    const memoryId = String(req.params.id || "").trim();
    if (!memoryId) return res.status(400).json({ error: "id is required" });

    const existing = await prisma.agentMemoryEntry.findUnique({
      where: { id: memoryId },
      select: {
        id: true,
        scope: true,
        projectId: true,
        createdBy: true,
        project: { select: { ownerId: true } },
      },
    });
    if (!existing) return res.status(404).json({ error: "Memory entry not found" });

    let allowed = false;
    if (existing.scope === "GLOBAL") {
      allowed = isAdmin;
    } else {
      const project = existing.projectId
        ? await loadProjectAccess(existing.projectId, userId)
        : null;
      if (existing.projectId && !project) {
        return res.status(403).json({ error: "No project access" });
      }
      allowed = canEditProjectEntry({
        isAdmin,
        userId,
        createdBy: existing.createdBy,
        projectOwnerId: existing.project?.ownerId || project?.ownerId,
      });
    }
    if (!allowed) return res.status(403).json({ error: "No permission to archive this entry" });

    await prisma.agentMemoryEntry.update({
      where: { id: memoryId },
      data: { archivedAt: new Date(), updatedBy: userId },
    });

    return res.json({ success: true, id: memoryId });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to archive memory entry" });
  }
});

export { router as memoryRoutes };
