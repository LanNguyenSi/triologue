import { Router } from "express";
import { getEnabledConnector } from "./registry";
import { resolveToken } from "../services/tokenManager";
import { logAuditEvent } from "../services/auditService";
import { ConnectorResponse } from "./types";
import prisma from "../lib/prisma";
import { logger } from "../utils/logger";

const router = Router();

function resolveUrlTemplate(
  template: string,
  input: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = input[key];
    return val !== undefined ? encodeURIComponent(String(val)) : "";
  });
}

router.post("/:connectorId/actions/:actionId", async (req, res) => {
  const { connectorId, actionId } = req.params;
  const start = Date.now();

  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer byoa_")) {
      return res.status(401).json({ error: "Agent bearer token required" });
    }
    const rawToken = authHeader.slice("Bearer ".length);
    const agentToken = await (prisma as any).agentToken.findUnique({
      where: { token: rawToken },
      select: { userId: true, isActive: true, status: true },
    });
    if (!agentToken || !agentToken.isActive || agentToken.status !== "active") {
      return res.status(401).json({ error: "Invalid agent token" });
    }

    const connector = getEnabledConnector(connectorId);
    if (!connector) {
      return res
        .status(404)
        .json({ error: `Connector not found: ${connectorId}` });
    }

    const action = connector.actions.find((a) => a.id === actionId);
    if (!action) {
      return res.status(404).json({ error: `Action not found: ${actionId}` });
    }

    const permission = await (prisma as any).connectorPermission.findUnique({
      where: { connectorId_userId: { connectorId, userId: agentToken.userId } },
    });
    if (!permission) {
      return res
        .status(403)
        .json({ error: "Agent has no permission for this connector" });
    }
    if (
      permission.allowedActions.length > 0 &&
      !permission.allowedActions.includes(actionId)
    ) {
      return res
        .status(403)
        .json({ error: "Agent not permitted for this action" });
    }

    const rawInput =
      req.body && typeof req.body === "object" ? { ...req.body } : {};
    const taskId =
      typeof rawInput.taskId === "string" ? rawInput.taskId.trim() : "";
    delete rawInput.taskId;

    let taskCreatorId: string | null = null;
    if (taskId) {
      const task = await (prisma as any).task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          createdBy: true,
          assignedTo: true,
          project: {
            select: {
              roomId: true,
            },
          },
        },
      });
      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }

      let hasAccess = task.assignedTo === agentToken.userId;
      if (!hasAccess && task.project?.roomId) {
        const roomMembership = await prisma.roomParticipant.findUnique({
          where: {
            userId_roomId: {
              userId: agentToken.userId,
              roomId: task.project.roomId,
            },
          },
          select: { userId: true },
        });
        hasAccess = Boolean(roomMembership);
      }
      if (!hasAccess) {
        return res
          .status(403)
          .json({ error: "Agent has no access to this task context" });
      }

      taskCreatorId = task.createdBy;
    }

    const oauthToken = await resolveToken(
      connector.auth.provider,
      connector.auth.scope,
      taskCreatorId,
    );
    if (!oauthToken) {
      return res
        .status(503)
        .json({ error: "Integration not connected or token expired" });
    }

    const input = rawInput;
    const url = resolveUrlTemplate(action.urlTemplate, input);
    const fetchOptions: RequestInit = {
      method: action.method,
      headers: {
        Authorization: `Bearer ${oauthToken}`,
        "Content-Type": "application/json",
      },
    };
    if (action.method !== "GET" && action.method !== "HEAD") {
      fetchOptions.body = JSON.stringify(input);
    }

    const externalRes = await fetch(url, fetchOptions);
    const responseData =
      action.responseType === "text"
        ? await externalRes.text()
        : await externalRes.json().catch(async () => await externalRes.text());

    const result: ConnectorResponse = {
      success: externalRes.ok,
      status: externalRes.status,
      data: responseData,
      error: externalRes.ok ? undefined : String(responseData),
    };

    logAuditEvent({
      agentId: agentToken.userId,
      action: `connector.${actionId}`,
      resourceType: "connector",
      resourceId: connectorId,
      details: { url, method: action.method, status: externalRes.status },
      success: externalRes.ok,
      durationMs: Date.now() - start,
    });

    return res.status(externalRes.ok ? 200 : 502).json(result);
  } catch (err) {
    logger.error(`[connector-proxy] ${connectorId}/${actionId} error:`, err);
    return res.status(500).json({ error: "Connector proxy error" });
  }
});

export const connectorRoutes = router;
