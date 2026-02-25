# Triologue Plugin Development

Triologue is plugin-ready. Integrations can be docked as modules without turning every integration into core code.

## Scope (Current)

This is the current internal plugin model:

- Manifest-based plugin registration
- Optional API route mounting per plugin
- Plugin event hooks
- Client-side navigation and workspace rendering from manifest metadata
- Module runtime for project-linked runs (instances, run history, task sync)

No untrusted remote code execution is enabled in this phase.

## Architecture Overview

### Server

- `server/src/plugins/types.ts`  
  Types for plugin manifests, routes, event hooks.
- `server/src/plugins/manager.ts`  
  Central manager that registers and exposes enabled plugins.
- `server/src/plugins/builtin/*`  
  Built-in plugin definitions.
- `server/src/routes/plugins.ts`  
  Public manifest endpoint: `GET /api/plugins` (auth required).

### Client

- `client/src/types/plugins.ts`  
  Client-side manifest typings.
- `client/src/stores/pluginStore.ts`  
  Loads plugin manifests and keeps enabled-state in UI.
- `client/src/pages/PluginWorkspacePage.tsx`  
  Generic plugin workspace route: `/plugins/:pluginId`.

## Runtime Contract

The module runtime is room-native and project-linked:

- `PluginModuleInstance`  
  Stable binding (`pluginId + moduleKey + projectId + roomId`)
- `PluginModuleRun`  
  Immutable run record with status, input, output, error metadata
- `PluginTaskSync`  
  Idempotent task mapping (`projectId + syncKey`)

Module lifecycle events are emitted and can also be surfaced as room cards.

## Event Hooks

Current hook events:

- `message.created`
- `project.updated`
- `module.run.started`
- `module.run.completed`
- `module.run.failed`

## Minimal Plugin Skeleton

```ts
import type { TriologuePlugin } from "../types";

export const myPlugin: TriologuePlugin = {
  manifest: {
    id: "my-plugin",
    name: "My Plugin",
    version: "0.1.0",
    description: "Example plugin",
    enabledByDefault: true,
    capabilities: ["projects.read", "tasks.write"],
    ui: {
      navItems: [
        {
          to: "/plugins/my-plugin",
          label: "My Plugin",
          icon: "🧩",
        },
      ],
    },
  },
  registerRoutes(app) {
    // mount plugin API routes here
  },
  onEvent(event) {
    // optional event reaction
  },
};
```

## Add a New Internal Plugin

1. Create plugin in `server/src/plugins/builtin/`.
2. Export a `TriologuePlugin` with a unique `manifest.id`.
3. Optionally implement `registerRoutes`.
4. Optionally implement `onEvent`.
5. Register plugin in `server/src/plugins/builtin/index.ts`.
6. Add `ui.navItems` if you want sidebar navigation.

## Project Linking Pattern

Recommended flow for operational modules:

1. User links plugin to a project
2. User provides project-scoped inputs (attachments, settings)
3. Plugin creates/updates project tasks via runtime sync
4. Team executes in linked room using mentions and clear handoff prompts

This keeps work auditable and tied to project context.

## Activation Controls

Plugin availability can be controlled globally:

- `TRIOLOGUE_ENABLED_PLUGINS=id1,id2`
- `TRIOLOGUE_DISABLED_PLUGINS=id3,id4`

If neither is set, all plugins with `enabledByDefault !== false` are active.

## Next Evolution

Potential next phase:

- Signed external plugins
- Version compatibility checks
- Capability policy hardening
- Registry/distribution model

