/**
 * Pure agent-memory formatting helpers, extracted from routes/agents.ts
 * (agent-tasks 3b85d69e).
 *
 * These functions feed the agent memory-query search haystack and result
 * filter (routes/agents.ts). They are module-local there, which means they
 * cannot be unit-tested without importing the whole ~2660-line Express
 * router. Moving them here (types-only import from @prisma/client, no
 * Express/Prisma-client runtime deps) makes them independently
 * unit-testable and locks their behavior against silent changes during
 * future refactors (see server/src/__tests__/agentMemoryFormat.test.ts).
 *
 * This is a behavior-preserving move: the function bodies below are
 * byte-identical to the ones previously inlined in routes/agents.ts.
 */

import type { Prisma } from "@prisma/client";

/** Safely coerce a Prisma JsonValue to a plain object (empty object for non-objects). */
export function asJsonObject(v: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  if (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) {
    return v as Prisma.JsonObject;
  }
  return {};
}

export function parseDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function summarizeMemoryPayload(payload: Prisma.JsonValue | null | undefined): string {
  if (!payload || typeof payload !== "object") return "";
  // Arrays fall through to JSON.stringify (they carry no summary/note/decision);
  // only plain objects read the named fields. Preserves the pre-typing behavior,
  // including `{}` -> "{}" and `||` (not `??`) falsy coercion on the fields.
  if (!Array.isArray(payload)) {
    const obj = payload as Prisma.JsonObject;
    const summary = String(obj["summary"] || "").trim();
    if (summary) return summary.slice(0, 180);
    const note = String(obj["note"] || "").trim();
    if (note) return note.slice(0, 180);
    const decision = String(obj["decision"] || "").trim();
    if (decision) return decision.slice(0, 180);
  }
  const text = JSON.stringify(payload);
  return text.length > 180 ? `${text.slice(0, 180)}...` : text;
}

export function deriveMemoryFreshness(payload: Prisma.JsonValue | null | undefined, expiresAtRaw: unknown, now: Date) {
  const payloadObj = asJsonObject(payload);
  const expiresAt = parseDateOrNull(expiresAtRaw);
  const payloadValidUntil = parseDateOrNull(payloadObj["validUntil"]);
  const validUntil = expiresAt || payloadValidUntil;
  const isStale = Boolean(validUntil && validUntil.getTime() <= now.getTime());
  return {
    status: isStale ? "stale" : validUntil ? "fresh" : "unknown",
    warning: isStale ? "Memory entry is stale and should be reviewed." : null,
    validUntil: validUntil ? validUntil.toISOString() : null,
    isStale,
  };
}
