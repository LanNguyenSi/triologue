import prisma from "../lib/prisma";
import { logger } from "../utils/logger";
import { createInboxItems, type InboxCreateInput } from "./inboxService";
import type { IoLike } from "../types/io";

interface TaskRouterShape {
  id: string;
  title: string;
  assignedTo: string;
  reviewedBy: string | null;
  status: string;
  createdAt: Date;
  attachments: Array<{ filename: string; size: number | null }>;
}

interface ProjectRouterShape {
  id: string;
  name: string;
  ownerId: string;
  roomId: string | null;
}

interface ResultRouterOptions {
  io: IoLike;
  taskId: string;
  projectId: string;
  oldStatus: string;
  newStatus: string;
  updatedBy: string;
}

export async function onTaskStatusChanged(
  options: ResultRouterOptions,
): Promise<void> {
  const { io, taskId, projectId, oldStatus, newStatus, updatedBy } = options;

  try {
    const [task, project] = await Promise.all([
      prisma.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          title: true,
          assignedTo: true,
          reviewedBy: true,
          status: true,
          createdAt: true,
          attachments: {
            select: { filename: true, size: true },
            orderBy: { createdAt: "desc" as const },
            take: 5,
          },
        },
      }),
      prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, name: true, ownerId: true, roomId: true },
      }),
    ]);

    if (!task || !project || !project.roomId) return;

    if (oldStatus === newStatus) return;

    const assignee = await prisma.user.findUnique({
      where: { id: task.assignedTo },
      select: { username: true, displayName: true },
    });
    const assigneeName = assignee ? `@${assignee.username}` : task.assignedTo;

    if (newStatus === "in_review") {
      await handleInReview({ io, task, project, assigneeName, updatedBy });
    } else if (newStatus === "done") {
      await handleDone({ io, task, project, assigneeName, updatedBy });
    }
  } catch (err) {
    logger.error("Result router error:", err);
  }
}

async function handleInReview(ctx: {
  io: IoLike;
  task: TaskRouterShape;
  project: ProjectRouterShape;
  assigneeName: string;
  updatedBy: string;
}) {
  const { io, task, project, assigneeName, updatedBy } = ctx;

  const attachmentLines =
    task.attachments.length > 0
      ? task.attachments
          .map((a) => `${a.filename} (${formatBytes(a.size)})`)
          .join(", ")
      : null;

  let reviewerName = "";
  if (task.reviewedBy) {
    const reviewer = await prisma.user.findUnique({
      where: { id: task.reviewedBy },
      select: { username: true },
    });
    reviewerName = reviewer ? `@${reviewer.username}` : task.reviewedBy;
  }

  let content = `Task "${task.title}" ist bereit fuer Review.\nBearbeitet von: ${assigneeName}`;
  if (reviewerName) content += ` | Reviewer: ${reviewerName}`;
  if (attachmentLines) content += `\nAnhaenge: ${attachmentLines}`;

  await postSystemMessage(io, project.roomId!, content, updatedBy);

  if (task.reviewedBy) {
    await safeCreateInboxItems({
      recipientIds: [task.reviewedBy],
      actorId: updatedBy,
      type: "task.review_requested",
      title: "Task ready for review",
      message: task.title,
      link: `/projects/${project.id}`,
      projectId: project.id,
      taskId: task.id,
      io,
    });
  }
}

async function handleDone(ctx: {
  io: IoLike;
  task: TaskRouterShape;
  project: ProjectRouterShape;
  assigneeName: string;
  updatedBy: string;
}) {
  const { io, task, project, assigneeName, updatedBy } = ctx;

  const durationMs = Date.now() - new Date(task.createdAt).getTime();
  const duration = formatDuration(durationMs);

  const content = `Task "${task.title}" abgeschlossen.\nBearbeitet von: ${assigneeName} | Dauer: ${duration}`;
  await postSystemMessage(io, project.roomId!, content, updatedBy);

  await safeCreateInboxItems({
    recipientIds: [project.ownerId],
    actorId: updatedBy,
    type: "task.completed",
    title: "Task completed",
    message: task.title,
    link: `/projects/${project.id}`,
    projectId: project.id,
    taskId: task.id,
    io,
  });
}

async function postSystemMessage(
  io: IoLike,
  roomId: string,
  content: string,
  senderId: string,
): Promise<void> {
  try {
    const message = await prisma.message.create({
      data: {
        content,
        senderId,
        roomId,
        messageType: "SYSTEM",
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            userType: true,
            avatar: true,
          },
        },
        reactions: {
          include: { user: { select: { username: true, displayName: true } } },
        },
      },
    });

    if (io) {
      io.to(roomId).emit("message:new", message);
    }

    await prisma.room.update({
      where: { id: roomId },
      data: { lastActivity: new Date(), messageCount: { increment: 1 } },
    });
  } catch (err) {
    logger.error("Failed to post system message:", err);
  }
}

async function safeCreateInboxItems(input: InboxCreateInput): Promise<void> {
  try {
    await createInboxItems(input);
  } catch (err) {
    logger.error("Result router inbox error:", err);
  }
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "weniger als 1 Minute";
  if (minutes < 60) return `${minutes} Minute${minutes === 1 ? "" : "n"}`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `${hours} Std ${remainingMinutes} Min`;
  const days = Math.floor(hours / 24);
  return `${days} Tag${days === 1 ? "" : "e"}`;
}
