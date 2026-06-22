import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../utils/logger";
import { buildActionsForTask, buildPermittedConnectorActions, type ActionDescriptor } from "./actionRegistry";

interface IoLike {
  to(room: string): { emit(event: string, data: unknown): void };
}

const AGENT_USER_TYPES = new Set(["AI_AGENT", "AI_ICE", "AI_LAVA", "AI_OTHER"]);

interface TaskAssignedPayload {
  type: "task.assigned";
  taskId: string;
  projectId: string;
  roomId: string | null;
  assignedBy: string;
  task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string | null;
    dueDate: string | null;
    usedMemoryIds: string[];
    handoffNote: unknown | null;
  };
  project: {
    id: string;
    name: string;
    description: string | null;
    projectContext: Prisma.JsonValue;
  };
  context: TaskContextPackage;
}

export interface TaskContextPackage {
  availableConnectorActions: ActionDescriptor[];
  recentRoomMessages: Array<{
    id: string;
    content: string;
    messageType: string;
    createdAt: string;
    sender: { id: string; displayName: string; userType: string } | null;
  }>;
}

export async function emitTaskAssignedIfAgent(options: {
  io: IoLike;
  taskId: string;
  projectId: string;
  assignedTo: string;
  assignedBy: string;
}): Promise<void> {
  try {
    const assignee = await prisma.user.findUnique({
      where: { id: options.assignedTo },
      select: { id: true, userType: true },
    });

    if (!assignee || !AGENT_USER_TYPES.has(assignee.userType)) {
      return;
    }

    const [task, project] = await Promise.all([
      prisma.task.findUnique({
        where: { id: options.taskId },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          dueDate: true,
          usedMemoryIds: true,
          handoffNote: true,
        },
      }),
      prisma.project.findUnique({
        where: { id: options.projectId },
        select: {
          id: true,
          name: true,
          description: true,
          roomId: true,
          projectContext: true,
        },
      }),
    ]);

    if (!task || !project) return;

    // Build context package
    const [connectorActions, recentMessages] = await Promise.all([
      buildPermittedConnectorActions(options.assignedTo).catch(() => [] as ActionDescriptor[]),
      project.roomId
        ? prisma.message.findMany({
            where: { roomId: project.roomId },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              id: true,
              content: true,
              messageType: true,
              createdAt: true,
              sender: { select: { id: true, displayName: true, userType: true } },
            },
          }).then((msgs) => msgs.reverse())
        : Promise.resolve([]),
    ]);

    const availableActions: ActionDescriptor[] = [
      ...buildActionsForTask(task.id, project.id, project.roomId || null),
      ...connectorActions,
    ];

    const context: TaskContextPackage = {
      availableConnectorActions: availableActions,
      recentRoomMessages: recentMessages.map((m) => ({
        id: m.id,
        content: m.content,
        messageType: m.messageType,
        createdAt: m.createdAt.toISOString(),
        sender: m.sender
          ? { id: m.sender.id, displayName: m.sender.displayName, userType: m.sender.userType }
          : null,
      })),
    };

    const payload: TaskAssignedPayload = {
      type: "task.assigned",
      taskId: task.id,
      projectId: project.id,
      roomId: project.roomId || null,
      assignedBy: options.assignedBy,
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
        usedMemoryIds: task.usedMemoryIds || [],
        handoffNote: task.handoffNote ?? null,
      },
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        projectContext: project.projectContext,
      },
      context,
    };

    if (options.io) {
      options.io
        .to(`user:${options.assignedTo}`)
        .emit("task:assigned", payload);
      logger.info(
        `task:assigned event emitted to agent ${options.assignedTo} for task ${task.id} (${availableActions.length} actions, ${context.recentRoomMessages.length} recent messages)`,
      );
    }
  } catch (err) {
    logger.error("Failed to emit task:assigned:", err);
  }
}
