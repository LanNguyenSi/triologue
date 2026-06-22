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

  const installation = await prisma.pluginInstallation.findUnique({
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

async function isPluginEnabledForUser(
  pluginId: string,
  userId: string,
  workspaceEnabledOverride?: boolean,
): Promise<boolean> {
  const normalizedPluginId = normalizePluginId(pluginId);
  const workspaceEnabled =
    typeof workspaceEnabledOverride === "boolean"
      ? workspaceEnabledOverride
      : await isPluginEnabled(normalizedPluginId);
  if (!workspaceEnabled) return false;

  const preference = await prisma.userPluginPreference.findUnique({
    where: {
      userId_pluginId: {
        userId,
        pluginId: normalizedPluginId,
      },
    },
    select: { isEnabled: true },
  });

  if (!preference) return true;
  return Boolean(preference.isEnabled);
}

export function requirePluginCapabilities(
  pluginId: string,
  requiredCapabilities: string[],
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const normalizedPluginId = normalizePluginId(pluginId);
    const userId = String(req.user?.id || "").trim();

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!pluginManager.isPluginActive(normalizedPluginId)) {
      return res.status(404).json({ error: "Plugin is not active" });
    }

    const workspaceEnabled = await isPluginEnabled(normalizedPluginId);
    if (!workspaceEnabled) {
      return res.status(403).json({
        error: "Plugin is disabled by workspace policy",
        pluginId: normalizedPluginId,
      });
    }

    const userEnabled = await isPluginEnabledForUser(
      normalizedPluginId,
      userId,
      workspaceEnabled,
    );
    if (!userEnabled) {
      return res.status(403).json({
        error: "Plugin is disabled in your user settings",
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

    const link = await prisma.projectPluginLink.findUnique({
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

export async function getPluginEnabledStateForUser(
  pluginId: string,
  userId: string,
): Promise<boolean> {
  return isPluginEnabledForUser(pluginId, userId);
}
