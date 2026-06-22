import { Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";

/**
 * Structural type for the resolved BYOA agent token payload.
 * Covers the union of all fields read by any route that uses byoaAuth:
 *   - id, userId               — all routes (audit log, rate limit, DB queries)
 *   - name, mentionKey         — GET /me/context
 *   - config                   — POST /message (rate-limit config)
 *   - status, isActive         — byoaAuth auth checks
 *   - agentUser.id, .isActive  — byoaAuth auth checks
 *   - agentUser.displayName    — POST /message (sendToTeams)
 */
export interface ByoaAgentTokenPayload {
  id: string;
  userId: string;
  name: string;
  mentionKey: string;
  config: unknown;
  status: string;
  isActive: boolean;
  agentUser: {
    id: string;
    isActive: boolean;
    displayName: string;
  };
}

/** Extract a byoa_-prefixed bearer token from the Authorization header. */
export function readByoaBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer byoa_")) return null;
  return authHeader.slice("Bearer ".length);
}

/**
 * Resolve a raw byoa_ token to its active AgentToken record.
 * Returns either { agentToken } on success or { error } on failure.
 *
 * DB query union covers all fields used by any BYOA route handler:
 *   agentUser: { id, isActive, displayName }
 */
export async function resolveActiveAgentToken(rawToken: string): Promise<{
  agentToken?: ByoaAgentTokenPayload;
  error?: { status: number; message: string };
}> {
  const agentToken = await prisma.agentToken.findUnique({
    where: { token: rawToken },
    include: {
      agentUser: { select: { id: true, isActive: true, displayName: true } },
    },
  });

  if (!agentToken || !agentToken.agentUser?.isActive) {
    return { error: { status: 401, message: "Invalid agent token" } };
  }
  if (agentToken.status === "pending") {
    return {
      error: { status: 403, message: "Agent is pending admin approval" },
    };
  }
  if (agentToken.status === "rejected" || !agentToken.isActive) {
    return {
      error: { status: 403, message: "Agent has been deactivated or rejected" },
    };
  }

  return { agentToken };
}

/**
 * Express middleware that validates a BYOA bearer token and attaches the
 * resolved agent token to req.agentToken.
 *
 * Returns 401 when the token is missing or invalid.
 * Returns 403 when the agent is pending, rejected, or deactivated.
 * Calls next() on success — never throws.
 */
export const byoaAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const rawToken = readByoaBearerToken(req);
    if (!rawToken) {
      res
        .status(401)
        .json({ error: "Agent bearer token required (prefix: byoa_)" });
      return;
    }

    const result = await resolveActiveAgentToken(rawToken);
    if (result.error) {
      res.status(result.error.status).json({ error: result.error.message });
      return;
    }

    req.agentToken = result.agentToken!;
    next();
  } catch (err) {
    // In master each route ran the token lookup inside its own try/catch and
    // returned a 500 on a DB/infra error. Preserve that: without this, a
    // rejected promise from an async middleware is not forwarded to the error
    // handler in Express 4, so the request would hang.
    console.error("[agents] byoaAuth: failed to resolve agent token", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
