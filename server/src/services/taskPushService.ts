import prisma from "../lib/prisma";
import { logger } from "../utils/logger";

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
  };
  project: {
    id: string;
    name: string;
    description: string | null;
  };
}

export async function emitTaskAssignedIfAgent(options: {
  io: any;
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
        },
      }),
      prisma.project.findUnique({
        where: { id: options.projectId },
        select: { id: true, name: true, description: true, roomId: true },
      }),
    ]);

    if (!task || !project) return;

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
      },
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
      },
    };

    if (options.io) {
      options.io
        .to(`user:${options.assignedTo}`)
        .emit("task:assigned", payload);
      logger.info(
        `task:assigned event emitted to agent ${options.assignedTo} for task ${task.id}`,
      );
    }
  } catch (err) {
    logger.error("Failed to emit task:assigned:", err);
  }
}
