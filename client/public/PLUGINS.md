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

## Navigation Target Constraints

Every `navItems[].to` (and every other manifest-supplied navigation target,
such as a notification `link`) must be a **path-absolute, same-origin path**:
starts with exactly one `/` that is not itself followed by another `/` or a
backslash (`\`). Examples:

- Safe: `/plugins/my-plugin`, `/plugins/my-plugin/settings?tab=1`
- Rejected: `//evil.example.com` (scheme-relative, escapes the app origin),
  `\/evil.example.com` or `\\evil.example.com` (backslash is treated as a
  path separator by browsers for http(s) URLs, so this also escapes),
  `https://example.com/...` (absolute URL), anything not starting with `/`.

A rejected `to` does **not** fail plugin load or throw. It silently falls
back to `/` (or a call-site-specific fallback, e.g. `/inbox` for inbox
items). This is deliberate: an open redirect through a plugin-supplied nav
target is a phishing primitive on a page that carries session state, so the
client enforces the constraint itself (in `safeNavTarget`,
`client/src/lib/safeNavTarget.ts`) rather than trusting the manifest. In a
dev build, a rejected value is logged to the console (`safeNavTarget:
rejected navigation target, using fallback`) so you can catch a typo in your
own plugin's `to` during development; that logging is stripped from
production builds, so a rejected value in production is silent to the end
user. There is currently no admin-visible list of rejected nav targets in
the client UI — adding one would need new store/UI plumbing (a way to record
and surface rejections across sessions) that is out of scope here; the
dev-console warning is the only diagnostic today. If you see your plugin's
nav item always landing on `/`, check that `to` is a plain path-absolute
string.

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

