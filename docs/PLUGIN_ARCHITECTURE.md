# Plugin-Ready Architecture (Phase 1)

This repository now supports internal, manifest-based plugins without introducing external code execution.

## What Is Included

- Server-side plugin manager with:
  - Manifest registration
  - Optional route mounting
  - Event hooks
- Public plugin manifest endpoint:
  - `GET /api/plugins` (authenticated)
- Built-in example plugin:
  - `sales-workbench`
  - API routes under `/api/plugin-modules/sales-workbench/*`
- Client-side plugin loading:
  - Dynamic sidebar entries from plugin manifests
  - Generic plugin workspace route: `/plugins/:pluginId`

## Core Files

- Server:
  - `server/src/plugins/types.ts`
  - `server/src/plugins/manager.ts`
  - `server/src/plugins/builtin/*`
  - `server/src/routes/plugins.ts`
- Client:
  - `client/src/types/plugins.ts`
  - `client/src/stores/pluginStore.ts`
  - `client/src/pages/PluginWorkspacePage.tsx`

## Event Hooks (Current)

- `message.created`
- `project.updated`
- `module.run.started`
- `module.run.completed`
- `module.run.failed`

Current emitters are wired into socket and API write paths so plugins can react centrally.  
Module lifecycle events are emitted by `moduleRuntimeService` when plugin modules start, complete, or fail.

## Module Runtime Contract (Current)

Triologue now includes a room-native module runtime contract for internal plugins:

- `PluginModuleInstance`
  - Stable binding for `pluginId + moduleKey + projectId + roomId`
- `PluginModuleRun`
  - Immutable execution record with status/input/output/error metadata
- `PluginTaskSync`
  - Idempotent task mapping (`projectId + syncKey`) to avoid duplicate tasks across repeated runs

The runtime service also posts SYSTEM room cards (`aiContext.type = module.run.card`) so each run is visible in the linked communication room.

### Sales Workbench (Current Practical Behavior)

`sales-workbench` screening now evaluates real project signals before task orchestration:

- Supports dedicated project attachments (`project_attachments`) as primary screening input.
- Reads linked project and task attachments for text-based formats (`txt`, `md`, `csv`, `json`).
- Extracts deadline/must/risk keyword signals plus date candidates.
- Includes recent room message signal scanning.
- Produces run output with `screeningSignals`, `findings`, and compact evidence snippets.
- Creates follow-up tasks with priorities based on detected gaps (e.g., unsupported attachments/manual PDF review).
- Adds handoff endpoint to publish agent-release instructions into the linked project room.

## Configuration

Optional environment variables:

- `TRIOLOGUE_ENABLED_PLUGINS=id1,id2`
  - If set, only these plugin IDs are active.
- `TRIOLOGUE_DISABLED_PLUGINS=id3,id4`
  - Excludes listed plugin IDs.

If neither variable is set, plugins with `enabledByDefault !== false` are active.

## Adding a New Internal Plugin

1. Create a plugin file in `server/src/plugins/builtin/`.
2. Export a `TriologuePlugin` with a unique `manifest.id`.
3. Optionally add route mounts via `registerRoutes`.
4. Optionally handle events via `onEvent`.
5. Register it in `server/src/plugins/builtin/index.ts`.
6. (Optional) Add `ui.navItems` entries in the manifest to expose navigation in the client.

## Scope of Phase 1

This phase is intentionally internal and safe by default:

- No third-party runtime plugin execution.
- No remote plugin registry.
- No dynamic code loading from untrusted sources.

Phase 2 can add signed external plugins, richer capability enforcement, and versioned compatibility checks.
