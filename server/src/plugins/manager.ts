import { Express } from "express";
import {
  PluginEventName,
  PluginEventPayloads,
  PluginManifest,
  PluginRuntimeContext,
  TriologuePlugin,
} from "./types";

function parsePluginList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

class PluginManager {
  private runtimeContext: PluginRuntimeContext | null = null;
  private activePlugins: TriologuePlugin[] = [];

  initialize(ctx: PluginRuntimeContext, plugins: TriologuePlugin[]) {
    this.runtimeContext = ctx;

    const enabledOnly = parsePluginList(process.env.TRIOLOGUE_ENABLED_PLUGINS);
    const disabled = parsePluginList(process.env.TRIOLOGUE_DISABLED_PLUGINS);

    this.activePlugins = plugins.filter((plugin) => {
      const id = plugin.manifest.id.toLowerCase();
      if (disabled.has(id)) return false;
      if (enabledOnly.size > 0 && !enabledOnly.has(id)) return false;
      if (plugin.isEnabled && !plugin.isEnabled(ctx)) return false;
      if (enabledOnly.size === 0 && plugin.manifest.enabledByDefault === false) {
        return false;
      }
      return true;
    });

    const names = this.activePlugins.map((plugin) => plugin.manifest.id);
    ctx.logger.info(
      names.length > 0
        ? `Plugin manager initialized: ${names.join(", ")}`
        : "Plugin manager initialized: no active plugins",
    );
  }

  mountRoutes(app: Express) {
    if (!this.runtimeContext) {
      throw new Error("PluginManager is not initialized");
    }

    for (const plugin of this.activePlugins) {
      if (!plugin.registerRoutes) continue;

      const mounts = plugin.registerRoutes(this.runtimeContext);
      for (const mount of mounts) {
        app.use(mount.basePath, mount.router);
        this.runtimeContext.logger.info(
          `Mounted plugin route: ${plugin.manifest.id} -> ${mount.basePath}`,
        );
      }
    }
  }

  getPublicManifests(): PluginManifest[] {
    return this.activePlugins.map((plugin) => plugin.manifest);
  }

  getManifest(pluginId: string): PluginManifest | null {
    const id = pluginId.trim().toLowerCase();
    const plugin = this.activePlugins.find(
      (entry) => entry.manifest.id.toLowerCase() === id,
    );
    return plugin?.manifest || null;
  }

  isPluginActive(pluginId: string): boolean {
    const id = pluginId.trim().toLowerCase();
    return this.activePlugins.some((plugin) => plugin.manifest.id.toLowerCase() === id);
  }

  hasCapability(pluginId: string, capability: string): boolean {
    const id = pluginId.trim().toLowerCase();
    const normalizedCapability = capability.trim().toLowerCase();
    const plugin = this.activePlugins.find(
      (entry) => entry.manifest.id.toLowerCase() === id,
    );
    if (!plugin) return false;
    const capabilities = (plugin.manifest.capabilities || []).map((value) =>
      value.toLowerCase(),
    );
    return capabilities.includes(normalizedCapability);
  }

  hasCapabilities(pluginId: string, capabilities: string[]): boolean {
    return capabilities.every((capability) =>
      this.hasCapability(pluginId, capability),
    );
  }

  private async isEnabledByPolicy(plugin: TriologuePlugin): Promise<boolean> {
    if (!this.runtimeContext) return false;

    const pluginId = plugin.manifest.id.trim().toLowerCase();
    const installation = await this.runtimeContext.prisma.pluginInstallation.findUnique({
      where: { pluginId },
      select: { isEnabled: true, isInstalled: true },
    });

    if (installation) {
      return Boolean(installation.isInstalled) && Boolean(installation.isEnabled);
    }

    return plugin.manifest.enabledByDefault !== false;
  }

  async emit<E extends PluginEventName>(
    event: E,
    payload: PluginEventPayloads[E],
  ) {
    if (!this.runtimeContext) return;

    for (const plugin of this.activePlugins) {
      if (!plugin.onEvent) continue;
      const enabled = await this.isEnabledByPolicy(plugin);
      if (!enabled) continue;
      try {
        await plugin.onEvent(event, payload, this.runtimeContext);
      } catch (error) {
        this.runtimeContext.logger.warn(
          `Plugin event failed (${plugin.manifest.id}, ${event}): ${(error as { message?: string })?.message || String(error)}`,
        );
      }
    }
  }
}

export const pluginManager = new PluginManager();
