/**
 * Agent bearer-token rotation with a grace window.
 *
 * The AgentToken row owns two secrets at most: the current `token` and, after
 * a rotation, the replaced one in `previousToken`, honoured as a bearer only
 * until `previousTokenExpiresAt`. Everything here is stateless: time is
 * passed in as a Date and nothing is cached in module state, so a restart
 * loses nothing and a revoked row (isActive false / status not "active")
 * revokes both secrets because the lookup returns the same row.
 */

import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";

/**
 * Default grace window. The gateway re-syncs AgentToken rows every 60 s, so
 * 300 s spans about five sync cycles for every gateway instance and the
 * client to switch, while a stolen old token stays short-lived.
 */
export const DEFAULT_ROTATE_GRACE_MS = 5 * 60 * 1000;

const MAX_GRACE_SECONDS = 3600;

/**
 * Grace window in ms from AGENT_TOKEN_ROTATE_GRACE_SECONDS. A positive
 * integer string is clamped to [30, 3600] seconds; anything else (unset,
 * empty, non-numeric, zero, negative, decimal) falls back to the default.
 */
export function rotateGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AGENT_TOKEN_ROTATE_GRACE_SECONDS;
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw) || Number(raw) <= 0) {
    return DEFAULT_ROTATE_GRACE_MS;
  }
  const seconds = Math.min(Math.max(30, Number(raw)), MAX_GRACE_SECONDS);
  return seconds * 1000;
}

export interface PreviousTokenFields {
  previousToken: string | null;
  previousTokenExpiresAt: Date | null;
}

/** True only while the grace window is open: at the expiry instant it is dead. */
export function isPreviousTokenLive(
  row: PreviousTokenFields,
  now: Date,
): boolean {
  if (row.previousToken === null || row.previousTokenExpiresAt === null) {
    return false;
  }
  return row.previousTokenExpiresAt.getTime() > now.getTime();
}

/**
 * Resolve a raw bearer token to its AgentToken row. The current token is a
 * single findUnique; only a miss falls through to the previous-token slot,
 * which matches only while previousTokenExpiresAt is in the future.
 * `args` carries the caller's include/select, unchanged.
 */
export async function findAgentTokenByRawToken<
  T extends Omit<Prisma.AgentTokenFindFirstArgs, "where">,
>(
  rawToken: string,
  args: Prisma.SelectSubset<T, Omit<Prisma.AgentTokenFindFirstArgs, "where">>,
  now: Date = new Date(),
): Promise<Prisma.AgentTokenGetPayload<T> | null> {
  const current = await prisma.agentToken.findUnique({
    where: { token: rawToken },
    ...(args as object),
  } as Prisma.AgentTokenFindUniqueArgs);
  if (current) {
    return current as unknown as Prisma.AgentTokenGetPayload<T>;
  }
  const previous = await prisma.agentToken.findFirst({
    where: { previousToken: rawToken, previousTokenExpiresAt: { gt: now } },
    ...(args as object),
  } as Prisma.AgentTokenFindFirstArgs);
  return (previous ?? null) as unknown as Prisma.AgentTokenGetPayload<T> | null;
}

/** Thrown when the compare-and-swap lost to a concurrent rotation. */
export class RotateConflictError extends Error {
  constructor() {
    super("Agent token was rotated concurrently");
    this.name = "RotateConflictError";
  }
}

/**
 * Replace `currentToken` of row `agentId` with a fresh token and keep the
 * old one as previousToken for `graceMs`. A second rotation overwrites the
 * previous slot, so at most one previous token exists. The update is a
 * compare-and-swap on the current token: of two concurrent rotations with
 * the same current token exactly one matches, the other throws.
 */
export async function rotateAgentToken(
  agentId: string,
  currentToken: string,
  now: Date,
  graceMs: number,
): Promise<{ token: string; previousTokenExpiresAt: Date }> {
  const newToken = "byoa_" + crypto.randomBytes(32).toString("hex");
  const previousTokenExpiresAt = new Date(now.getTime() + graceMs);
  const result = await prisma.agentToken.updateMany({
    where: { id: agentId, token: currentToken },
    data: {
      token: newToken,
      previousToken: currentToken,
      previousTokenExpiresAt,
    },
  });
  if (result.count === 0) {
    throw new RotateConflictError();
  }
  return { token: newToken, previousTokenExpiresAt };
}

/**
 * previousToken / previousTokenExpiresAt (ISO) for the gateway-config
 * payload while the grace window is open, else both null.
 */
export function gatewayPreviousTokenFields(
  row: PreviousTokenFields,
  now: Date,
): { previousToken: string | null; previousTokenExpiresAt: string | null } {
  return isPreviousTokenLive(row, now) ? {
        previousToken: row.previousToken,
        previousTokenExpiresAt: row.previousTokenExpiresAt!.toISOString(),
      }
    : { previousToken: null, previousTokenExpiresAt: null };
}
