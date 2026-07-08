import { Router } from "express";
import { getEnabledConnector } from "./registry";
import { resolveToken } from "../services/tokenManager";
import { logAuditEvent } from "../services/auditService";
import { ConnectorResponse } from "./types";
import prisma from "../lib/prisma";
import { logger } from "../utils/logger";
import type { Server as SocketIOServer } from "socket.io";
import { createInboxItems } from "../services/inboxService";

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
    const agentToken = await prisma.agentToken.findUnique({
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

    const permission = await prisma.connectorPermission.findUnique({
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

    // Resolve and AUTHORIZE the task context once, before anything derives
    // trust from it. `taskId` is caller-supplied and ApprovalRequest.taskId has
    // no foreign key, so an unauthorized id must never reach the approval row:
    // approvals.ts derives who may decide from the approval's projectId, and the
    // notification below posts into the task's project room. Both would
    // otherwise be steerable into a project the agent has no access to.
    // The execution path further down reuses this same authorized task.
    const requestedTaskId =
      typeof req.body?.taskId === "string" ? req.body.taskId.trim() : "";
    let authorizedTask: {
      id: string;
      createdBy: string;
      projectId: string;
      project: { roomId: string | null } | null;
    } | null = null;
    if (requestedTaskId) {
      const task = await prisma.task.findUnique({
        where: { id: requestedTaskId },
        select: {
          id: true,
          createdBy: true,
          assignedTo: true,
          projectId: true,
          project: { select: { roomId: true } },
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

      authorizedTask = task;
    }

    // Approval gate: check if action requires human approval
    if (action.requiresApproval === true) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const taskIdForApproval = authorizedTask?.id ?? null;
      const existingApproval = await prisma.approvalRequest.findFirst({
        where: {
          requestedBy: agentToken.userId,
          connectorId,
          actionId,
          taskId: taskIdForApproval,
          status: "approved",
          createdAt: { gte: cutoff },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!existingApproval) {
        // Scope the approval to the authorized task's project: approvals.ts
        // lets that project's owner and team members decide it. Without a task
        // there is no project to derive membership from, so the approval stays
        // unscoped and admin-only.
        const projectIdForApproval = authorizedTask?.projectId ?? undefined;

        const newApproval = await prisma.approvalRequest.create({
          data: {
            requestedBy: agentToken.userId,
            connectorId,
            actionId,
            projectId: projectIdForApproval,
            taskId: taskIdForApproval ?? undefined,
            actionInput: req.body ?? {},
            riskLevel: action.riskLevel ?? "medium",
            reason: req.body?.approvalReason ?? "",
            status: "pending",
          },
        });

        logAuditEvent({
          agentId: agentToken.userId,
          action: `approval.requested`,
          resourceType: "connector",
          resourceId: connectorId,
          details: {
            approvalId: newApproval.id,
            actionId,
            riskLevel: action.riskLevel,
          },
          success: true,
          durationMs: Date.now() - start,
        });

        // Notify project room about pending approval request
        if (taskIdForApproval) {
          try {
            const roomId = authorizedTask?.project?.roomId;
            if (roomId) {
              const notificationContent = JSON.stringify({
                type: "approval_request",
                approvalId: newApproval.id,
                connectorId,
                actionId,
                riskLevel: action.riskLevel ?? "medium",
                reason: req.body?.approvalReason ?? "",
              });

              const systemMessage = await prisma.message.create({
                data: {
                  roomId,
                  senderId: agentToken.userId,
                  content: notificationContent,
                  messageType: "SYSTEM",
                },
                include: { sender: { select: { id: true, displayName: true, userType: true } } },
              });

              await prisma.room.update({
                where: { id: roomId },
                data: { lastActivity: new Date(), messageCount: { increment: 1 } },
              });

              const io: SocketIOServer | undefined = req.app.get("io");
              if (io) {
                io.to(roomId).emit("message:new", systemMessage);
              }

              // Inbox notification: notify all room members
              const roomMembers = await prisma.roomParticipant.findMany({
                where: { roomId },
                select: { userId: true },
              });
              const memberIds = roomMembers.map((m) => m.userId);
              if (memberIds.length > 0) {
                await createInboxItems({
                  recipientIds: memberIds,
                  actorId: agentToken.userId,
                  excludeActor: true,
                  type: 'approval_request',
                  title: `Agent action requires approval: ${connectorId} / ${actionId}`,
                  message: newApproval.reason || `Risk level: ${action.riskLevel ?? 'medium'}`,
                  link: '/approvals',
                  taskId: taskIdForApproval ?? undefined,
                  io,
                });
              }
            }
          } catch (notifyErr) {
            // Non-fatal — log but don't fail the approval request
            logger.warn(`[connector-proxy] Failed to send approval notification: ${notifyErr}`);
          }
        }

        return res.status(202).json({
          requiresApproval: true,
          approvalId: newApproval.id,
          message: `Action '${actionId}' requires human approval (risk: ${action.riskLevel ?? "medium"}). Approval request created.`,
        });
      }

      // Approved — log it and proceed
      logAuditEvent({
        agentId: agentToken.userId,
        action: `approval.consumed`,
        resourceType: "connector",
        resourceId: connectorId,
        details: { approvalId: existingApproval.id, actionId },
        success: true,
        durationMs: 0,
      });
    }

    const rawInput =
      req.body && typeof req.body === "object" ? { ...req.body } : {};
    delete (rawInput as Record<string, unknown>).approvalReason;
    delete rawInput.taskId;

    // Resolved and authorized above, before the approval gate.
    const taskCreatorId: string | null = authorizedTask?.createdBy ?? null;

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
