import prisma from "../lib/prisma";

export interface AuditEntry {
  agentId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  projectId?: string;
  roomId?: string;
  details?: Record<string, unknown>;
  success?: boolean;
  durationMs?: number;
}

/**
 * Fire-and-forget audit logging. Must NEVER block the main flow.
 */
export function logAuditEvent(entry: AuditEntry): void {
  (prisma as any).agentAuditLog
    .create({
      data: {
        agentId: entry.agentId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        projectId: entry.projectId ?? null,
        roomId: entry.roomId ?? null,
        details: entry.details ?? {},
        success: entry.success ?? true,
        durationMs: entry.durationMs ?? null,
      },
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[audit] Failed to log:", message);
    });
}

export async function withAudit<T>(
  entry: Omit<AuditEntry, "success" | "durationMs">,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logAuditEvent({ ...entry, success: true, durationMs: Date.now() - start });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logAuditEvent({
      ...entry,
      success: false,
      durationMs: Date.now() - start,
      details: { ...entry.details, error: message },
    });
    throw err;
  }
}
