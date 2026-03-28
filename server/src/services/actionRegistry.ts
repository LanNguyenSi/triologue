import { listEnabledConnectors } from "../connectors/registry";
import prisma from "../lib/prisma";
import { resolveToken } from "./tokenManager";

export interface ActionDescriptor {
  id: string;
  name: string;
  description: string;
  type: "internal" | "connector";
  method: string;
  url: string;
  input?: Record<string, unknown>;
  connectorId?: string;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(String(value || "").trim());
}

export function buildActionsForTask(
  taskId: string,
  projectId: string,
  roomId: string | null,
): ActionDescriptor[] {
  const taskIdSafe = encodePathSegment(taskId);
  const projectIdSafe = encodePathSegment(projectId);

  return [
    {
      id: "task.updateStatus",
      name: "Update Task Status",
      description: "Update the lifecycle status of the current task.",
      type: "internal",
      method: "PATCH",
      url: `/api/projects/${projectIdSafe}/tasks/${taskIdSafe}`,
      input: {
        type: "object",
        required: ["status"],
        properties: {
          status: {
            type: "string",
            enum: ["todo", "in_progress", "in_review", "done", "blocked"],
          },
        },
      },
    },
    {
      id: "task.uploadAttachment",
      name: "Upload Task Attachment",
      description: "Upload a file attachment to the current task.",
      type: "internal",
      method: "POST",
      url: `/api/projects/${projectIdSafe}/tasks/${taskIdSafe}/attachments`,
      input: {
        type: "object",
        required: ["file"],
        properties: {
          file: {
            type: "string",
            format: "binary",
          },
        },
      },
    },
    {
      id: "room.postMessage",
      name: "Post Room Message",
      description:
        "Post an agent message to the project room linked to this task.",
      type: "internal",
      method: "POST",
      url: "/api/agents/message",
      input: {
        type: "object",
        required: ["roomId", "content"],
        properties: {
          roomId: {
            type: "string",
            default: roomId || "",
          },
          content: {
            type: "string",
            minLength: 1,
          },
        },
      },
    },
  ];
}

function withTaskContextInput(
  input: Record<string, unknown> | undefined,
  taskId: string | null,
): Record<string, unknown> | undefined {
  if (!taskId) {
    return input;
  }

  const base =
    input && typeof input === "object"
      ? { ...input }
      : { type: "object", properties: {} };
  const properties =
    base.properties && typeof base.properties === "object"
      ? { ...(base.properties as Record<string, unknown>) }
      : {};

  properties.taskId = {
    type: "string",
    default: taskId,
    description:
      "Interne Task-ID fuer die Aufloesung von User-spezifischen Integrationen.",
  };

  return {
    ...base,
    type: "object",
    properties,
  };
}

export async function buildConnectorActions(
  taskCreatedBy?: string | null,
  taskId?: string | null,
): Promise<ActionDescriptor[]> {
  const connectors = listEnabledConnectors();
  const actions: ActionDescriptor[] = [];
  for (const connector of connectors) {
    const token = await resolveToken(
      connector.auth.provider,
      connector.auth.scope,
      taskCreatedBy,
    );
    if (!token) {
      continue;
    }

    for (const action of connector.actions) {
      actions.push({
        id: action.id,
        name: action.name,
        description: action.description,
        type: "connector",
        method: "POST",
        url: `/api/connectors/${connector.id}/actions/${action.id}`,
        input: withTaskContextInput(
          action.input as Record<string, unknown> | undefined,
          taskId || null,
        ),
        connectorId: connector.id,
      });
    }
  }
  return actions;
}

export async function buildPermittedConnectorActions(userId: string): Promise<ActionDescriptor[]> {
  const connectors = listEnabledConnectors();
  const permissions = await (prisma as any).connectorPermission.findMany({
    where: { userId },
    select: { connectorId: true, allowedActions: true },
  });

  const permMap = new Map<string, string[]>();
  for (const perm of permissions) {
    permMap.set(perm.connectorId, perm.allowedActions);
  }

  const actions: ActionDescriptor[] = [];
  for (const connector of connectors) {
    const allowed = permMap.get(connector.id);
    if (!allowed) continue;
    const token = await resolveToken(
      connector.auth.provider,
      connector.auth.scope,
      userId,
    );
    if (!token) continue;
    for (const action of connector.actions) {
      if (allowed.length > 0 && !allowed.includes(action.id)) continue;
      actions.push({
        id: action.id,
        name: action.name,
        description: action.description,
        type: "connector",
        method: "POST",
        url: `/api/connectors/${connector.id}/actions/${action.id}`,
        input: action.input as Record<string, unknown> | undefined,
        connectorId: connector.id,
      });
    }
  }
  return actions;
}
