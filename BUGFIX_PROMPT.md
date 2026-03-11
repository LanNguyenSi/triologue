# Bug Fix: Screening Plugin + Login Issue

## Context
The Triologue app is a React+TypeScript frontend with an Express backend. The "Sales Workbench" plugin (id: `sales-workbench`) has a screening workflow in `client/src/pages/PluginWorkspacePage.tsx`.

## Bug 1: Login Broken (CRITICAL)
**Error:** `POST http://localhost:3001/api/auth/login net::ERR_BLOCKED_BY_CLIENT`

**Root Cause:** Several files use `http://localhost:3001/api` as fallback when `VITE_API_URL` is not set. In production builds without this env var, the browser tries to call `localhost:3001` which gets blocked.

**Files affected:**
- `client/src/stores/authStore.ts`
- `client/src/services/authService.ts`
- `client/src/stores/notificationStore.ts`

**Fix:** Change ALL `http://localhost:3001/api` fallbacks to `/api` (relative path). Other files like `agentStore.ts`, `InboxPage.tsx`, `AdminPage.tsx` already correctly use `/api`. Make all consistent.

Search entire `client/src/` for `localhost:3001` and replace every fallback with `/api`.

## Bug 2: "Tasks anlegen" Button Stays Disabled After Upload
**Description:** In the Screening plugin UI, the "Tasks anlegen" (Create Tasks) button stays disabled even after uploading a file through the plugin's Step 2 ("Ausschreibung hochladen").

**Button disabled condition:**
```tsx
disabled={startingRun || loadingProjects || !canRun || !hasProjectAttachments}
```

Where:
- `canRun = Boolean(isSalesWorkbench && hasExplicitProjectSelection && selectedProject && selectedProject.roomId)`
- `hasProjectAttachments = projectAttachments.length > 0`

**Upload handler in `PluginWorkspacePage.tsx`:**
```tsx
const attachment = data?.attachment;
if (attachment?.id) {
  setProjectAttachments((prev) => [attachment, ...prev]);
} else {
  await loadProjectAttachments();
}
```

**Possible issues to investigate:**
1. After upload, `projectAttachments` state may not update correctly
2. The `loadProjectAttachments()` should ALWAYS be called after upload (not just as fallback)
3. Response parsing: verify server returns `{ attachment: { id, ... } }` and client handles it
4. Check if there's a race condition with useEffect/useCallback that resets the state after upload

**Server upload handler:** `server/src/plugins/builtin/salesWorkbenchPlugin.ts` around line 1015 — `POST /project-attachments` endpoint.

## Build & Deploy
```bash
cd client && npm run build
docker cp client/dist/. triologue-frontend:/usr/share/nginx/html/
```

## Bug 3: Plugin-uploaded attachments must appear on Project Detail Page
**Description:** When a user uploads a file through the Screening plugin's Step 2, the attachment is stored as a `ProjectAttachment` in the database. When the user navigates back to the Project Detail Page, this attachment MUST appear in the project's attachment list.

**Check:** The Project Detail Page loads attachments via `GET /api/projects/:id` (includes attachments) or a separate attachments endpoint. Ensure that attachments uploaded via the plugin endpoint (`POST /api/plugin-modules/sales-workbench/project-attachments`) use the same `project_attachments` table and are visible on the standard project detail view.

Both the plugin's upload endpoint (`salesWorkbenchPlugin.ts`) and the standard project upload endpoint (`projects.ts`) should create records in the same `project_attachments` table. Verify there's no filtering by `sourcePluginId` that would hide plugin-uploaded attachments on the project page.

## Test Steps
1. Open https://opentriologue.ai — login should work (no localhost:3001 errors in console)
2. Go to Screening plugin (`/plugins/sales-workbench`)
3. Select "Screening" project from dropdown
4. Upload a PDF in Step 2 ("Ausschreibung hochladen")
5. "Tasks anlegen" button should become enabled after upload
6. Navigate to the Screening project detail page — the uploaded PDF must appear in the attachments list
7. Check browser console for any errors during upload
