import { pluginManager } from "./manager";

export type ModuleRunStatus = "started" | "completed" | "failed";

interface ModuleContextInput {
  pluginId: string;
  moduleKey: string;
  projectId: string;
  roomId: string;
  startedBy: string;
  runInput?: any;
  moduleConfig?: any;
}

interface ModuleRuntimeServices {
  prisma: any;
  io: any;
}

const SYSTEM_SENDER_ID = "gateway-system";

function toStatusEmoji(status: ModuleRunStatus): string {
  if (status === "completed") return "✅";
  if (status === "failed") return "❌";
  return "🚀";
}

export async function ensureModuleInstance(
  services: ModuleRuntimeServices,
  input: ModuleContextInput,
) {
  const key = {
    pluginId: input.pluginId,
    moduleKey: input.moduleKey,
    projectId: input.projectId,
    roomId: input.roomId,
  };

  const existing = await (services.prisma as any).pluginModuleInstance.findUnique({
    where: {
      pluginId_moduleKey_projectId_roomId: key,
    },
  });

  if (existing) {
    return existing;
  }

  try {
    return await (services.prisma as any).pluginModuleInstance.create({
      data: {
        ...key,
        config: input.moduleConfig || {},
        createdBy: input.startedBy,
      },
    });
  } catch (error: any) {
    // Parallel run race: unique (pluginId, moduleKey, projectId, roomId) hit.
    if (error?.code === "P2002") {
      const instance = await (services.prisma as any).pluginModuleInstance.findUnique({
        where: {
          pluginId_moduleKey_projectId_roomId: key,
        },
      });
      if (instance) return instance;
    }
    throw error;
  }
}

export async function createModuleRun(
  services: ModuleRuntimeServices,
  moduleInstanceId: string,
  input: ModuleContextInput,
) {
  const run = await (services.prisma as any).pluginModuleRun.create({
    data: {
      moduleInstanceId,
      pluginId: input.pluginId,
      moduleKey: input.moduleKey,
      projectId: input.projectId,
      roomId: input.roomId,
      status: "started",
      runInput: input.runInput || {},
      startedBy: input.startedBy,
    },
  });

  await pluginManager.emit("module.run.started", {
    pluginId: input.pluginId,
    moduleKey: input.moduleKey,
    moduleInstanceId,
    runId: run.id,
    projectId: input.projectId,
    roomId: input.roomId,
    startedBy: input.startedBy,
  });

  return run;
}

export async function completeModuleRun(
  services: ModuleRuntimeServices,
  run: any,
  output: any,
  summary?: string,
) {
  const updated = await (services.prisma as any).pluginModuleRun.update({
    where: { id: run.id },
    data: {
      status: "completed",
      runOutput: output || {},
      completedAt: new Date(),
    },
  });

  await pluginManager.emit("module.run.completed", {
    pluginId: run.pluginId,
    moduleKey: run.moduleKey,
    moduleInstanceId: run.moduleInstanceId,
    runId: run.id,
    projectId: run.projectId,
    roomId: run.roomId,
    startedBy: run.startedBy,
    summary,
  });

  return updated;
}

export async function failModuleRun(
  services: ModuleRuntimeServices,
  run: any,
  error: unknown,
) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Run failed";

  const updated = await (services.prisma as any).pluginModuleRun.update({
    where: { id: run.id },
    data: {
      status: "failed",
      errorText: message,
      completedAt: new Date(),
    },
  });

  await pluginManager.emit("module.run.failed", {
    pluginId: run.pluginId,
    moduleKey: run.moduleKey,
    moduleInstanceId: run.moduleInstanceId,
    runId: run.id,
    projectId: run.projectId,
    roomId: run.roomId,
    startedBy: run.startedBy,
    error: message,
  });

  return updated;
}

export async function postModuleRunCard(
  services: ModuleRuntimeServices,
  params: {
    roomId: string;
    startedBy: string;
    pluginId: string;
    moduleKey: string;
    runId: string;
    moduleInstanceId: string;
    status: ModuleRunStatus;
    summary: string;
    details?: Record<string, unknown>;
  },
) {
  const systemUser = await services.prisma.user.findUnique({
    where: { id: SYSTEM_SENDER_ID },
    select: { id: true },
  });
  const senderId = systemUser?.id || params.startedBy;

  const card = {
    version: 1,
    type: "module.run.card",
    pluginId: params.pluginId,
    moduleKey: params.moduleKey,
    moduleInstanceId: params.moduleInstanceId,
    runId: params.runId,
    status: params.status,
    summary: params.summary,
    details: params.details || {},
    timestamp: new Date().toISOString(),
  };

  const content = `${toStatusEmoji(params.status)} [${params.pluginId}/${params.moduleKey}] ${params.summary}`;

  const message = await services.prisma.message.create({
    data: {
      content,
      roomId: params.roomId,
      senderId,
      messageType: "SYSTEM",
      aiContext: card,
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
      reactions: true,
      attachments: true,
    },
  });

  if (services.io) {
    services.io.to(params.roomId).emit("message:new", message);
  }

  return message;
}

export async function createOrReuseSyncedTask(
  services: ModuleRuntimeServices,
  params: {
    projectId: string;
    roomId: string;
    moduleRunId: string;
    syncKey: string;
    title: string;
    description?: string;
    assignedTo: string;
    priority?: string;
    status?: string;
  },
) {
  const existingSync = await (services.prisma as any).pluginTaskSync.findUnique({
    where: { projectId_syncKey: { projectId: params.projectId, syncKey: params.syncKey } },
  });

  if (existingSync) {
    const existingTask = await (services.prisma as any).task.findUnique({
      where: { id: existingSync.taskId },
    });
    if (existingTask) {
      return { task: existingTask, reused: true };
    }
  }

  const task = await (services.prisma as any).task.create({
    data: {
      projectId: params.projectId,
      title: params.title,
      description: params.description || "",
      assignedTo: params.assignedTo,
      priority: params.priority || "medium",
      status: params.status || "todo",
    },
  });

  try {
    await (services.prisma as any).pluginTaskSync.create({
      data: {
        projectId: params.projectId,
        roomId: params.roomId,
        moduleRunId: params.moduleRunId,
        syncKey: params.syncKey,
        taskId: task.id,
      },
    });
    return { task, reused: false };
  } catch (error: any) {
    // Parallel run race: unique (projectId, syncKey) hit.
    if (error?.code === "P2002") {
      const sync = await (services.prisma as any).pluginTaskSync.findUnique({
        where: { projectId_syncKey: { projectId: params.projectId, syncKey: params.syncKey } },
      });
      if (sync) {
        const syncedTask = await (services.prisma as any).task.findUnique({
          where: { id: sync.taskId },
        });
        if (syncedTask) return { task: syncedTask, reused: true };
      }
    }
    throw error;
  }
}
