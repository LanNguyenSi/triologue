# Implementation Plan: Projects + Shared Secrets + GitHub Integration
**For Sonnet — Saturday Evening (2026-02-21) → Sunday (2026-02-22)**

## 🎯 Overall Goal
Implement the three interconnected features as a unified system demonstrating the "AI-Human Team" workflow:
1. **Projects** — Container for team tasks
2. **Shared Secrets** — Secure credential vault (AES-256 encrypted)
3. **GitHub Integration** — Webhook-driven agent automation

**Demo Scenario:** Lan creates "OpenTriologue v1.0" project → stores GitHub PAT as secret → Lava auto-reviews PRs when webhook fires

---

## 📋 Phase 1: Database Schema (30 min)

### 1a. Projects Table
```prisma
model Project {
  id            String    @id @default(cuid())
  name          String
  description   String?
  ownerId       String    // User who created it
  teamMemberIds String[]  @default([]) // User IDs invited to team
  status        String    @default("active") // active | archived | closed
  
  tasks         Task[]
  secrets       ProjectSecret[]
  webhookConfig WebhookConfig?
  
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  owner User @relation("ProjectOwner", fields: [ownerId], references: [id])
  
  @@map("projects")
}

model Task {
  id          String    @id @default(cuid())
  projectId   String
  title       String
  description String?
  status      String    @default("todo") // todo | in_progress | done | blocked
  assignedTo  String?   // User ID
  
  priority    String?   @default("medium") // low | medium | high
  dueDate     DateTime?
  
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@map("tasks")
}

model ProjectSecret {
  id            String    @id @default(cuid())
  projectId     String
  name          String    // e.g. "GitHub PAT"
  encryptedValue String  // AES-256(value, projectId + secretKey)
  
  createdBy     String
  permissions   Json      // { [userId]: "READ_USE" | "READ_ONLY" }
  
  lastUsedAt    DateTime?
  lastUsedBy    String?
  
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@unique([projectId, name])
  @@map("project_secrets")
}

model WebhookConfig {
  id            String    @id @default(cuid())
  projectId     String    @unique
  
  githubWebhookSecret String  // For signature verification
  githubRepoUrl   String?     // e.g. "https://github.com/LanNguyenSi/triologue"
  
  eventTypes    String[]  @default(["pull_request", "issues"])
  autoReviewPR  Boolean   @default(true)
  reviewerAgentId String? // Which agent should review (optional)
  
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  @@map("webhook_configs")
}
```

### 1b. Encryption Helper
Create `/server/src/utils/encryption.ts`:
```typescript
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production';
const ALGORITHM = 'aes-256-cbc';

export function encryptSecret(value: string, salt: string): string {
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY + salt).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decryptSecret(encrypted: string, salt: string): string {
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY + salt).digest();
  const [ivHex, encryptedHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(encryptedHex, 'hex'));
  return decipher.update(encryptedHex, 'hex', 'utf8') + decipher.final('utf8');
}
```

**Prisma Migration:**
```bash
npx prisma migrate dev --name add_projects_secrets_webhooks
```

---

## 🛠️ Phase 2: Backend APIs (2 hours)

### 2a. Projects Routes (`/server/src/routes/projects.ts`)

```typescript
/**
 * POST /api/projects
 * Create new project
 * Body: { name, description? }
 * Returns: { id, name, status, createdAt }
 */
router.post('/', authenticate, async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  
  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      description,
      ownerId: req.user!.id,
      teamMemberIds: [req.user!.id], // Creator is team member
    },
  });
  
  res.json(project);
});

/**
 * GET /api/projects/:id
 * Get project with tasks + team
 */
router.get('/:id', authenticate, async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      tasks: { orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] },
    },
  });
  
  if (!project) return res.status(404).json({ error: 'Not found' });
  
  // Check access: owner or team member
  if (project.ownerId !== req.user!.id && !project.teamMemberIds.includes(req.user!.id)) {
    return res.status(403).json({ error: 'No access' });
  }
  
  res.json(project);
});

/**
 * PATCH /api/projects/:id
 * Update project (owner only)
 * Body: { name?, description?, status? }
 */
router.patch('/:id', authenticate, async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (project.ownerId !== req.user!.id) return res.status(403).json({ error: 'Owner only' });
  
  const updated = await prisma.project.update({
    where: { id: req.params.id },
    data: {
      ...(req.body.name && { name: req.body.name.trim() }),
      ...(req.body.description !== undefined && { description: req.body.description }),
      ...(req.body.status && { status: req.body.status }),
    },
  });
  
  res.json(updated);
});

/**
 * POST /api/projects/:id/team
 * Add team member (owner only)
 * Body: { userId }
 */
router.post('/:id/team', authenticate, async (req, res) => {
  const { userId } = req.body;
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (project.ownerId !== req.user!.id) return res.status(403).json({ error: 'Owner only' });
  
  const updated = await prisma.project.update({
    where: { id: req.params.id },
    data: {
      teamMemberIds: {
        push: userId,
      },
    },
  });
  
  res.json(updated);
});
```

### 2b. Tasks Routes

```typescript
/**
 * POST /api/projects/:id/tasks
 * Create task
 * Body: { title, description?, status?, assignedTo?, priority?, dueDate? }
 */
router.post('/:id/tasks', authenticate, async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (!project.teamMemberIds.includes(req.user!.id) && project.ownerId !== req.user!.id) {
    return res.status(403).json({ error: 'No access' });
  }
  
  const task = await prisma.task.create({
    data: {
      projectId: req.params.id,
      title: req.body.title,
      ...(req.body.description && { description: req.body.description }),
      ...(req.body.status && { status: req.body.status }),
      ...(req.body.assignedTo && { assignedTo: req.body.assignedTo }),
      ...(req.body.priority && { priority: req.body.priority }),
      ...(req.body.dueDate && { dueDate: new Date(req.body.dueDate) }),
    },
  });
  
  res.json(task);
});

/**
 * PATCH /api/tasks/:id
 * Update task (team member)
 */
router.patch('/:id', authenticate, async (req, res) => {
  const task = await prisma.task.findUnique({ 
    where: { id: req.params.id },
    include: { project: true },
  });
  if (!task) return res.status(404).json({ error: 'Not found' });
  
  // Access check
  const project = task.project;
  if (!project.teamMemberIds.includes(req.user!.id) && project.ownerId !== req.user!.id) {
    return res.status(403).json({ error: 'No access' });
  }
  
  const updated = await prisma.task.update({
    where: { id: req.params.id },
    data: {
      ...(req.body.title && { title: req.body.title }),
      ...(req.body.status && { status: req.body.status }),
      ...(req.body.assignedTo !== undefined && { assignedTo: req.body.assignedTo }),
      ...(req.body.priority && { priority: req.body.priority }),
      ...(req.body.dueDate && { dueDate: new Date(req.body.dueDate) }),
    },
  });
  
  res.json(updated);
});
```

### 2c. Secrets Routes

```typescript
/**
 * POST /api/projects/:id/secrets
 * Create secret (owner only)
 * Body: { name, value, permissions: { [userId]: "READ_USE" | "READ_ONLY" } }
 * Returns: secret without value
 */
router.post('/:id/secrets', authenticate, async (req, res) => {
  const { name, value, permissions } = req.body;
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (project.ownerId !== req.user!.id) return res.status(403).json({ error: 'Owner only' });
  
  const encryptedValue = encryptSecret(value, req.params.id);
  
  const secret = await prisma.projectSecret.create({
    data: {
      projectId: req.params.id,
      name,
      encryptedValue,
      createdBy: req.user!.id,
      permissions: permissions || {},
    },
  });
  
  // Return without value
  const { encryptedValue: _, ...safeSecret } = secret;
  res.json(safeSecret);
});

/**
 * GET /api/projects/:id/secrets
 * List secrets (team member, returns names only)
 */
router.get('/:id/secrets', authenticate, async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (!project.teamMemberIds.includes(req.user!.id) && project.ownerId !== req.user!.id) {
    return res.status(403).json({ error: 'No access' });
  }
  
  const secrets = await prisma.projectSecret.findMany({
    where: { projectId: req.params.id },
  });
  
  // Return sans values
  const safeSecrets = secrets.map(s => ({
    id: s.id,
    name: s.name,
    createdBy: s.createdBy,
    lastUsedAt: s.lastUsedAt,
    lastUsedBy: s.lastUsedBy,
    permissions: s.permissions,
  }));
  
  res.json(safeSecrets);
});

/**
 * POST /api/projects/:id/secrets/:secretId/decrypt
 * Internal: decrypt secret for agent use (requires permission + audit)
 * Returns: { value } (only to webhook context, never UI)
 */
router.post('/:id/secrets/:secretId/decrypt', authenticate, async (req, res) => {
  // This is INTERNAL use only — never called from browser
  // Validate agentId + permission
  
  const secret = await prisma.projectSecret.findUnique({
    where: { id: req.params.secretId },
  });
  
  if (!secret) return res.status(404).json({ error: 'Not found' });
  
  const perm = secret.permissions[req.user!.id];
  if (!perm || !perm.includes('READ')) {
    return res.status(403).json({ error: 'No permission' });
  }
  
  const value = decryptSecret(secret.encryptedValue, secret.projectId);
  
  // Audit log
  await prisma.projectSecret.update({
    where: { id: secret.id },
    data: {
      lastUsedAt: new Date(),
      lastUsedBy: req.user!.id,
    },
  });
  
  res.json({ value });
});
```

### 2d. GitHub Webhook Endpoint

```typescript
/**
 * POST /api/webhooks/github
 * GitHub webhook endpoint (unauthenticated, signature-verified)
 * Headers: X-Hub-Signature-256, X-GitHub-Event
 */
router.post('/github', async (req, res) => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const event = req.headers['x-github-event'] as string;
  
  // Verify signature
  const payload = JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET || '');
  const hash = 'sha256=' + hmac.update(payload).digest('hex');
  
  if (hash !== signature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Find project by webhook repo URL
  const repoUrl = req.body.repository?.html_url; // "https://github.com/LanNguyenSi/triologue"
  const webhookConfig = await prisma.webhookConfig.findFirst({
    where: { githubRepoUrl: repoUrl },
    include: { project: true },
  });
  
  if (!webhookConfig) {
    return res.status(404).json({ error: 'Webhook config not found' });
  }
  
  // Handle PR events
  if (event === 'pull_request' && webhookConfig.autoReviewPR) {
    const pr = req.body.pull_request;
    
    if (pr.action === 'opened' || pr.action === 'synchronize') {
      // Post mention to Triologue
      const message = `@${webhookConfig.reviewerAgentId || 'lava'} Please review this PR: ${pr.title}
      
Files: ${pr.changed_files} changed, ${pr.additions} additions, ${pr.deletions} deletions
${pr.html_url}`;

      // Find reviewer agent in project team
      const agentId = webhookConfig.reviewerAgentId;
      if (agentId) {
        // Post to Triologue chat (requires project room setup)
        // Trigger agent webhook with secret injection
      }
    }
  }
  
  res.json({ received: true });
});
```

---

## 💻 Phase 3: Frontend UI (2 hours)

### 3a. New Pages
- `/projects` — List all projects (owner + team)
- `/projects/:id` — Project detail, tasks, team, secrets
- `/projects/:id/settings` — Webhook config, team management

### 3b. Projects List Page
```tsx
// client/src/pages/ProjectsPage.tsx
- Grid of project cards
- Status badge (active/archived)
- Team member count
- Last updated
- [+ New Project] button
```

### 3c. Project Detail Page
```tsx
// client/src/pages/ProjectDetailPage.tsx
Sections:
1. Header: name, status, owner
2. Tasks Board: columns [todo | in_progress | done]
   - Drag-drop tasks (SortableJS)
   - Click to open task modal
   
3. Team Panel: 
   - List team members
   - [+ Add member] button
   
4. Secrets Section:
   - List secrets (names only, no values)
   - 🔑 GitHub PAT (last used: 2h ago by Lava)
   - [+ Add Secret] button (owner only)
   
5. GitHub Config:
   - Connect repo URL
   - Enable auto-review toggle
   - Last webhook event
```

### 3d. Modals
1. **Create Project Modal**
   - Input: name, description
   - Button: Create

2. **Create Task Modal**
   - Fields: title, description, status, assignedTo, priority, dueDate
   
3. **Add Secret Modal**
   - Fields: name, value (password field)
   - Permissions selector (checkboxes per team member)
   
4. **Connect GitHub Modal**
   - Input: repo URL
   - Explain webhook setup
   - Copy webhook URL + secret

---

## 🔌 Phase 4: GitHub Integration Flow (1 hour)

### 4a. Webhook Registration Helper
```typescript
// On client side when user clicks "Connect to GitHub"
// 1. Show webhook URL: https://opentriologue.ai/api/webhooks/github
// 2. Show secret to copy to GitHub settings
// 3. Test webhook button
```

### 4b. Agent Message Injection (modify existing webhook sender)
When Lava gets mentioned with project context:
```typescript
// In ice-triologue-bridge or lava-connector
const projectId = extractProjectFromContext(message);
if (projectId) {
  const secrets = await fetchProjectSecrets(projectId, agentId);
  // secrets = { github_pat: "ghp_xxx", aws_key: "***" }
  
  const injectedPayload = {
    message: originalMessage,
    project: { id: projectId, name: "v1.0" },
    secrets: secrets, // Decrypted, injected only here
  };
  
  // Send to Lava webhook — Lava gets secrets in POST body
  sendToAgent(injectedPayload);
}
```

---

## 📊 Phase 5: i18n Keys (30 min)

Add to `LanguageContext.tsx`:
```typescript
// DE
"projects.title": "Projekte",
"projects.newProject": "+ Neues Projekt",
"projects.name": "Name",
"projects.description": "Beschreibung",
"projects.create": "Erstellen",
"projects.tasks": "Aufgaben",
"projects.team": "Team",
"projects.secrets": "Secrets",
"projects.status": "Status",
"tasks.add": "+ Aufgabe",
"tasks.title": "Titel",
"tasks.assignedTo": "Zugewiesen an",
"secrets.add": "+ Secret",
"secrets.name": "Name",
"secrets.value": "Wert",
"secrets.permissions": "Berechtigungen",
"github.connect": "Mit GitHub verbinden",
"github.repoUrl": "Repository URL",
"github.autoReview": "Auto-Review PRs aktivieren",

// EN
(Same structure)
```

---

## 🧪 Phase 6: Testing & Integration (1 hour)

### Manual Test Flow
1. Create project "Test v1.0"
2. Add Lava as team member
3. Create secret "GitHub PAT" (fake token)
4. Add task "Review PR"
5. Trigger GitHub webhook (curl POST)
6. Verify: message posted to Triologue, Lava mentioned, secret injected

### Auto-Test
```bash
npm run test -- projects.test.ts
- Create project
- Add secret
- Verify decryption only works with permission
- Verify secret not returned in GET /secrets
```

---

## 📝 Sonnet Implementation Checklist

- [ ] **DB Schema** (Prisma)
  - [ ] Projects, Tasks, ProjectSecret, WebhookConfig tables
  - [ ] Encryption.ts helper
  - [ ] Run migration
  
- [ ] **Backend Routes**
  - [ ] Projects CRUD (`routes/projects.ts`)
  - [ ] Tasks CRUD
  - [ ] Secrets (create, list, decrypt)
  - [ ] GitHub webhook endpoint
  
- [ ] **Frontend Pages**
  - [ ] Projects list page
  - [ ] Project detail page
  - [ ] Create project modal
  - [ ] Create task modal
  - [ ] Add secret modal
  - [ ] Connect GitHub modal
  
- [ ] **Integration**
  - [ ] Inject secrets into agent webhook payload
  - [ ] Task status updates (manual for V1)
  - [ ] Audit logging (lastUsedAt)
  
- [ ] **i18n**
  - [ ] Add all translation keys
  - [ ] Test DE/EN UI
  
- [ ] **Testing**
  - [ ] Manual test flow
  - [ ] API unit tests
  - [ ] Signature verification test

---

## ⏱️ Time Budget
- Phase 1 (DB): 30 min
- Phase 2 (Backend): 2 hours
- Phase 3 (Frontend): 2 hours
- Phase 4 (GitHub): 1 hour
- Phase 5 (i18n): 30 min
- Phase 6 (Testing): 1 hour
**Total: ~7 hours**

**Suggestion:** Phase 1-4 today (Sonnet), Phase 5-6 tomorrow morning before going live.

---

## 🎯 Success Criteria
✅ Project created + tasks added
✅ Secret stored encrypted, not visible in UI
✅ GitHub webhook receives PR events
✅ Agent (Lava) receives secret injected in message context
✅ Agent can use secret (GitHub API call)
✅ Task status updates reflect agent action
✅ DE/EN localization complete
✅ Audit trail shows secret usage

---

**Ready for Sonnet implementation tomorrow! 🚀**
