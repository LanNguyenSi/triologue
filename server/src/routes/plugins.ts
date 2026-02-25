import { Router } from "express";
import { authenticate } from "../middleware/auth";
import prisma from "../lib/prisma";
import { pluginManager } from "../plugins/manager";

const router = Router();

function normalizePluginId(pluginId: string): string {
  return pluginId.trim().toLowerCase();
}

function parseBooleanQuery(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => parseBooleanQuery(entry));
  }
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isAdminUser(req: any): boolean {
  return Boolean(req.user?.isAdmin);
}

function hasProjectReadAccess(project: any, userId: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return project.ownerId === userId || (project.teamMemberIds || []).includes(userId);
}

function hasProjectManageAccess(project: any, userId: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return project.ownerId === userId;
}

async function getInstallationsMap(pluginIds: string[]) {
  if (pluginIds.length === 0) return new Map<string, any>();

  const rows = await (prisma as any).pluginInstallation.findMany({
    where: {
      pluginId: { in: pluginIds },
    },
  });

  return new Map<string, any>(
    rows.map((row: any) => [normalizePluginId(row.pluginId), row]),
  );
}

function toPluginState(manifest: any, installation?: any) {
  const installed = installation ? Boolean(installation.isInstalled) : true;
  const enabled = installation
    ? installed && Boolean(installation.isEnabled)
    : manifest.enabledByDefault !== false;

  return {
    ...manifest,
    installed,
    enabled,
    policy: installation
      ? {
          updatedAt: installation.updatedAt,
          updatedBy: installation.updatedBy || null,
        }
      : null,
  };
}

router.get("/", authenticate, async (req, res) => {
  try {
    const manifests = pluginManager.getPublicManifests();
    const pluginIds = manifests.map((entry) => normalizePluginId(entry.id));
    const installationMap = await getInstallationsMap(pluginIds);

    const includeDisabled =
      isAdminUser(req) && parseBooleanQuery(req.query.includeDisabled);

    const plugins = manifests
      .map((manifest) =>
        toPluginState(
          manifest,
          installationMap.get(normalizePluginId(manifest.id)),
        ),
      )
      .filter((plugin) => includeDisabled || plugin.enabled);

    return res.json({ plugins });
  } catch (error) {
    return res.status(500).json({ error: "Failed to list plugins" });
  }
});

router.get("/manage", authenticate, async (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  try {
    const manifests = pluginManager.getPublicManifests();
    const pluginIds = manifests.map((entry) => normalizePluginId(entry.id));
    const installationMap = await getInstallationsMap(pluginIds);

    const plugins = manifests.map((manifest) =>
      toPluginState(
        manifest,
        installationMap.get(normalizePluginId(manifest.id)),
      ),
    );

    return res.json({ plugins });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load plugin settings" });
  }
});

router.patch("/manage/:pluginId", authenticate, async (req, res) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const pluginId = normalizePluginId(req.params.pluginId || "");
  if (!pluginId) {
    return res.status(400).json({ error: "pluginId is required" });
  }

  if (!pluginManager.isPluginActive(pluginId)) {
    return res.status(404).json({ error: "Plugin not found" });
  }

  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be a boolean" });
  }

  try {
    const installation = await (prisma as any).pluginInstallation.upsert({
      where: { pluginId },
      update: {
        isInstalled: true,
        isEnabled: enabled,
        updatedBy: req.user!.id,
      },
      create: {
        pluginId,
        isInstalled: true,
        isEnabled: enabled,
        updatedBy: req.user!.id,
      },
    });

    const manifest = pluginManager.getManifest(pluginId);
    if (!manifest) {
      return res.status(404).json({ error: "Plugin not found" });
    }

    return res.json({
      plugin: toPluginState(manifest, installation),
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to update plugin policy" });
  }
});

router.get("/projects/:projectId", authenticate, async (req, res) => {
  const projectId = String(req.params.projectId || "").trim();
  if (!projectId) {
    return res.status(400).json({ error: "projectId is required" });
  }

  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: projectId },
      select: { id: true, ownerId: true, teamMemberIds: true },
    });

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const admin = isAdminUser(req);
    const canRead = hasProjectReadAccess(project, req.user!.id, admin);
    if (!canRead) {
      return res.status(403).json({ error: "No project access" });
    }

    const canManage = hasProjectManageAccess(project, req.user!.id, admin);

    const manifests = pluginManager.getPublicManifests();
    const pluginIds = manifests.map((entry) => normalizePluginId(entry.id));
    const installationMap = await getInstallationsMap(pluginIds);
    const links = await (prisma as any).projectPluginLink.findMany({
      where: {
        projectId,
        pluginId: { in: pluginIds },
      },
      select: { pluginId: true },
    });

    const linkedSet = new Set<string>(
      links.map((entry: any) => normalizePluginId(entry.pluginId)),
    );

    const plugins = manifests.map((manifest) => {
      const state = toPluginState(
        manifest,
        installationMap.get(normalizePluginId(manifest.id)),
      );
      return {
        ...state,
        linked: linkedSet.has(normalizePluginId(manifest.id)),
        canManage,
      };
    });

    return res.json({ projectId, canManage, plugins });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load project plugin links" });
  }
});

router.patch("/projects/:projectId/:pluginId", authenticate, async (req, res) => {
  const projectId = String(req.params.projectId || "").trim();
  const pluginId = normalizePluginId(req.params.pluginId || "");

  if (!projectId || !pluginId) {
    return res.status(400).json({ error: "projectId and pluginId are required" });
  }

  if (!pluginManager.isPluginActive(pluginId)) {
    return res.status(404).json({ error: "Plugin not found" });
  }

  const linked = req.body?.linked;
  if (typeof linked !== "boolean") {
    return res.status(400).json({ error: "linked must be a boolean" });
  }

  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: projectId },
      select: { id: true, ownerId: true, teamMemberIds: true },
    });

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const admin = isAdminUser(req);
    const canManage = hasProjectManageAccess(project, req.user!.id, admin);
    if (!canManage) {
      return res.status(403).json({ error: "Only project owner or admin can update plugin links" });
    }

    if (linked) {
      await (prisma as any).projectPluginLink.upsert({
        where: {
          projectId_pluginId: {
            projectId,
            pluginId,
          },
        },
        create: {
          projectId,
          pluginId,
          linkedBy: req.user!.id,
        },
        update: {
          linkedBy: req.user!.id,
        },
      });
    } else {
      await (prisma as any).projectPluginLink.deleteMany({
        where: {
          projectId,
          pluginId,
        },
      });
    }

    return res.json({ projectId, pluginId, linked });
  } catch (error) {
    return res.status(500).json({ error: "Failed to update project plugin link" });
  }
});

export { router as pluginRoutes };
