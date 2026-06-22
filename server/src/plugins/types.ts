import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { Server } from "socket.io";
import { createClient } from "redis";

export type PluginEventName =
  | "message.created"
  | "project.updated"
  | "module.run.started"
  | "module.run.completed"
  | "module.run.failed";

export interface PluginEventPayloads {
  "message.created": {
    messageId: string;
    roomId: string;
    senderId: string;
    source: "socket" | "upload" | "batch" | "agent";
    messageType?: string;
  };
  "project.updated": {
    projectId: string;
    updatedBy?: string;
    status?: string;
    changedFields?: string[];
  };
  "module.run.started": {
    pluginId: string;
    moduleKey: string;
    moduleInstanceId: string;
    runId: string;
    projectId: string;
    roomId: string;
    startedBy: string;
  };
  "module.run.completed": {
    pluginId: string;
    moduleKey: string;
    moduleInstanceId: string;
    runId: string;
    projectId: string;
    roomId: string;
    startedBy: string;
    summary?: string;
  };
  "module.run.failed": {
    pluginId: string;
    moduleKey: string;
    moduleInstanceId: string;
    runId: string;
    projectId: string;
    roomId: string;
    startedBy: string;
    error: string;
  };
}

export interface PluginNavItem {
  to: string;
  label: string;
  labelKey?: string;
  icon?: string;
  adminOnly?: boolean;
  match?: "exact" | "prefix";
}

export interface PluginUiManifest {
  navItems?: PluginNavItem[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabledByDefault?: boolean;
  capabilities?: string[];
  ui?: PluginUiManifest;
}

export interface PluginRouteMount {
  basePath: string;
  router: Router;
}

export interface PluginRuntimeContext {
  prisma: PrismaClient;
  io: Server;
  redis: ReturnType<typeof createClient>;
  logger: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

export interface TriologuePlugin {
  manifest: PluginManifest;
  isEnabled?: (ctx: PluginRuntimeContext) => boolean;
  registerRoutes?: (ctx: PluginRuntimeContext) => PluginRouteMount[];
  onEvent?: (
    event: PluginEventName,
    payload: PluginEventPayloads[PluginEventName],
    ctx: PluginRuntimeContext,
  ) => Promise<void> | void;
}
