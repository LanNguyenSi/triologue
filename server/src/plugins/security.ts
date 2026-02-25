import { Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { pluginManager } from "./manager";

type ProjectIdSource = "body" | "query" | "params";

function normalizePluginId(pluginId: string): string {
  return pluginId.trim().toLowerCase();
}

async function isPluginEnabled(pluginId: string): Promise<boolean> {
  const normalizedPluginId = normalizePluginId(pluginId);
  if (!pluginManager.isPluginActive(normalizedPluginId)) {
    return false;
  }

  const installation = await (prisma as any).pluginInstallation.findUnique({
    where: { pluginId: normalizedPluginId },
    select: { isEnabled: true },
  });

  if (installation) {
    return Boolean(installation.isEnabled);
  }

  const manifest = pluginManager.getManifest(normalizedPluginId);
  if (!manifest) return false;
  return manifest.enabledByDefault !== false;
}

export function requirePluginCapabilities(
  pluginId: string,
  requiredCapabilities: string[],
) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    const normalizedPluginId = normalizePluginId(pluginId);

    if (!pluginManager.isPluginActive(normalizedPluginId)) {
      return res.status(404).json({ error: "Plugin is not active" });
    }

    const enabled = await isPluginEnabled(normalizedPluginId);
    if (!enabled) {
      return res.status(403).json({
        error: "Plugin is disabled by workspace policy",
        pluginId: normalizedPluginId,
      });
    }

    if (!pluginManager.hasCapabilities(normalizedPluginId, requiredCapabilities)) {
      return res.status(403).json({
        error: "Plugin capability policy denied this operation",
        pluginId: normalizedPluginId,
        requiredCapabilities,
      });
    }

    next();
  };
}

function extractProjectId(req: Request, source: ProjectIdSource): string {
  const raw =
    source === "query"
      ? req.query.projectId
      : source === "params"
        ? req.params.projectId
        : req.body?.projectId;

  return String(raw || "").trim();
}

export function requireProjectPluginLink(
  pluginId: string,
  projectIdSource: ProjectIdSource = "body",
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const projectId = extractProjectId(req, projectIdSource);
    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const normalizedPluginId = normalizePluginId(pluginId);

    const link = await (prisma as any).projectPluginLink.findUnique({
      where: {
        projectId_pluginId: {
          projectId,
          pluginId: normalizedPluginId,
        },
      },
      select: { id: true },
    });

    if (!link) {
      return res.status(409).json({
        error: "Plugin is not linked to this project",
        pluginId: normalizedPluginId,
        projectId,
      });
    }

    next();
  };
}

export async function getPluginEnabledState(pluginId: string): Promise<boolean> {
  return isPluginEnabled(pluginId);
}
