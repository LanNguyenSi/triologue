/**
 * POST /api/agents/me/presence
 *
 * The agent gateway reports the live status of an agent's session(s):
 * `online`, `working`, `waiting_approval`, `error`, or `offline` to clear it.
 * The status is kept in Redis with a TTL (see services/agentPresence.ts) and
 * pushed to every room the agent participates in as `agent:presence`, so the
 * participant list updates without a reload. The room detail route reads the
 * same key.
 *
 * Authentication: Bearer <agentToken> (byoaAuth), so an agent can only write
 * its own presence; the key is derived from the token's user, never from the
 * body.
 *
 * Body: { status, sessionId?, host?, project?, detail?, sessions?, ttlSeconds? }
 * Answers 204; 400 on a malformed body; 503 when the presence store is not
 * reachable (the caller should treat presence as best effort and retry later).
 */

import { Router } from "express";
import { byoaAuth } from "../middleware/byoaAuth";
import prisma from "../lib/prisma";
import { logger } from "../utils/logger";
import { PRESENCE_EXCLUDED_ROOM_IDS } from "../utils/projectRoomPolicy";
import {
  AGENT_PRESENCE_STATUSES,
  AGENT_PRESENCE_TTL_DEFAULT_SECONDS,
  AGENT_PRESENCE_TTL_MAX_SECONDS,
  AGENT_PRESENCE_TTL_MIN_SECONDS,
  agentPresenceKey,
  isAgentPresenceStatus,
} from "../services/agentPresence";

const router = Router();

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function optionalString(value: unknown, name: string, max: number): Parsed<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    return { ok: false, error: `${name} must be a non-empty string of at most ${max} characters` };
  }
  return { ok: true, value: value.trim() };
}

function optionalInteger(value: unknown, name: string, min: number, max: number, fallback: number): Parsed<number> {
  if (value === undefined || value === null) return { ok: true, value: fallback };
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return { ok: false, error: `${name} must be an integer between ${min} and ${max}` };
  }
  return { ok: true, value };
}

router.post("/", byoaAuth, async (req, res) => {
  const agentToken = req.agentToken!;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const status = body.status;
  if (status !== "offline" && !isAgentPresenceStatus(status)) {
    return res.status(400).json({
      error: `status must be one of ${[...AGENT_PRESENCE_STATUSES, "offline"].join(", ")}`,
    });
  }
  const sessionId = optionalString(body.sessionId, "sessionId", 64);
  if (!sessionId.ok) return res.status(400).json({ error: sessionId.error });
  const host = optionalString(body.host, "host", 255);
  if (!host.ok) return res.status(400).json({ error: host.error });
  const project = optionalString(body.project, "project", 255);
  if (!project.ok) return res.status(400).json({ error: project.error });
  const detail = optionalString(body.detail, "detail", 500);
  if (!detail.ok) return res.status(400).json({ error: detail.error });
  const sessions = optionalInteger(body.sessions, "sessions", 0, 100, 1);
  if (!sessions.ok) return res.status(400).json({ error: sessions.error });
  const ttl = optionalInteger(
    body.ttlSeconds,
    "ttlSeconds",
    AGENT_PRESENCE_TTL_MIN_SECONDS,
    AGENT_PRESENCE_TTL_MAX_SECONDS,
    AGENT_PRESENCE_TTL_DEFAULT_SECONDS,
  );
  if (!ttl.ok) return res.status(400).json({ error: ttl.error });

  const redis = req.app.get("redis");
  if (!redis) {
    return res.status(503).json({ error: "Presence store unavailable" });
  }

  const now = Date.now();
  const updatedAt = new Date(now).toISOString();
  const stored = {
    status,
    sessionId: sessionId.value,
    host: host.value,
    project: project.value,
    detail: detail.value,
    sessions: status === "offline" ? 0 : sessions.value,
    updatedAt,
    // Clients drop a live event past this instant, so a status whose writer
    // died cannot outlive its TTL on screen either.
    expiresAt: status === "offline" ? updatedAt : new Date(now + ttl.value * 1000).toISOString(),
  };
  const key = agentPresenceKey(agentToken.userId);
  try {
    if (status === "offline") {
      await redis.del(key);
    } else {
      await redis.set(key, JSON.stringify(stored), { EX: ttl.value });
    }
  } catch (err) {
    logger.warn("[agents] presence store write failed:", err);
    return res.status(503).json({ error: "Presence store unavailable" });
  }

  // Push the change to the rooms the agent is in. Best effort: a failure
  // here must not undo the stored status, the next room load reads it.
  const io = req.app.get("io");
  if (io) {
    try {
      const memberships = await prisma.roomParticipant.findMany({
        where: { userId: agentToken.userId },
        select: { roomId: true },
      });
      const event = { userId: agentToken.userId, ...stored };
      const roomIds = memberships
        .map(({ roomId }) => roomId)
        .filter((roomId) => !PRESENCE_EXCLUDED_ROOM_IDS.includes(roomId));
      // One emit for all rooms: a socket in several of them gets the event once.
      if (roomIds.length > 0) io.to(roomIds).emit("agent:presence", event);
    } catch (err) {
      logger.warn("[agents] presence broadcast failed:", err);
    }
  }

  res.status(204).end();
});

export { router as agentPresenceRoutes };
