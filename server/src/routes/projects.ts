import { Router, Request } from "express";
import crypto from "crypto";
import fs from "fs";
import multer from "multer";
import path from "path";
import { authenticate } from "../middleware/auth";
import prisma from "../lib/prisma";
import { logger } from "../utils/logger";
import { encryptSecret } from "../utils/encryption";
import { createInboxItems } from "../services/inboxService";
import { onTaskStatusChanged } from "../services/resultRouterService";
import { emitTaskAssignedIfAgent } from "../services/taskPushService";
import { pluginManager } from "../plugins/manager";

const router = Router();

const CORE_TASK_STATUSES = ["todo", "in_progress", "done"] as const;
const OPTIONAL_TASK_STATUSES = ["blocked", "in_review"] as const;
const WORKFLOW_STATUS_ORDER = [
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
] as const;
const TASK_STATUSES = new Set(WORKFLOW_STATUS_ORDER);
const TASK_PRIORITIES = new Set(["low", "medium", "high"]);
const PROJECT_STATUSES = new Set(["active", "archived", "closed"]);
const DEFAULT_PROJECT_LIMIT = 12;
const MAX_PROJECT_LIMIT = 100;
const UPLOAD_DIR = path.resolve(__dirname, "../../uploads");
const MAX_TASK_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_PROJECT_ATTACHMENT_SIZE = 12 * 1024 * 1024; // 12MB
const ALLOWED_TASK_ATTACHMENT_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "image/gif": "IMAGE",
  "image/webp": "IMAGE",
  "application/pdf": "DOCUMENT",
  "text/plain": "DOCUMENT",
  "text/markdown": "DOCUMENT",
  "text/csv": "DOCUMENT",
  "application/json": "DOCUMENT",
};
const ALLOWED_PROJECT_ATTACHMENT_MIME_TYPES: Record<string, string> = {
  ...ALLOWED_TASK_ATTACHMENT_MIME_TYPES,
};

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function sanitizeExportFileName(value: string, fallback: string): string {
  const normalized = (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function attachmentUrlForExport(url?: string | null): string {
  if (!url) return "";
  if (!url.startsWith("/uploads/")) return url;
  const filename = url.replace("/uploads/", "");
  return `/api/files/${encodeURIComponent(filename)}`;
}

const taskAttachmentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const taskAttachmentFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  if (ALLOWED_TASK_ATTACHMENT_MIME_TYPES[file.mimetype]) {
    cb(null, true);
    return;
  }
  cb(new Error(`File type ${file.mimetype} is not allowed`));
};

const taskAttachmentUpload = multer({
  storage: taskAttachmentStorage,
  fileFilter: taskAttachmentFileFilter,
  limits: { fileSize: MAX_TASK_ATTACHMENT_SIZE },
});

const projectAttachmentUpload = multer({
  storage: taskAttachmentStorage,
  fileFilter: taskAttachmentFileFilter,
  limits: { fileSize: MAX_PROJECT_ATTACHMENT_SIZE },
});

function removeUploadedFile(filePath: string) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Best effort cleanup for failed uploads.
  }
}

function normalizeUsedMemoryIds(value: unknown): string[] {
  const ids: string[] = [];
  const addId = (raw: unknown) => {
    const id = String(raw || "").trim();
    if (!id || ids.includes(id)) return;
    ids.push(id.slice(0, 80));
  };

  if (Array.isArray(value)) {
    for (const item of value) addId(item);
  } else if (typeof value === "string") {
    for (const item of value.split(/,|\n/)) addId(item);
  }

  return ids.slice(0, 40);
}

interface ProjectAccessRecord {
  id: string;
  ownerId: string;
  roomId?: string | null;
  teamMemberIds: string[];
  workflowConfig?: any;
  projectContext?: any;
}

interface WorkflowConfig {
  enabledStatuses: string[];
  instructions: Record<string, string>;
}

interface ProjectBrief {
  goal: string;
  scope: string;
  outOfScope: string;
  successCriteria: string;
}

interface ProjectRunbook {
  preferredLanguage: string;
  responseStyle: string;
  constraints: string;
  escalationPath: string;
}

interface DecisionLogEntry {
  id: string;
  date: string;
  title: string;
  decision: string;
  rationale: string;
}

type MilestoneStatus = "planned" | "in_progress" | "done";

interface MilestoneEntry {
  id: string;
  title: string;
  dueDate: string;
  status: MilestoneStatus;
  notes: string;
}

interface ProjectContext {
  definitionOfDone: string[];
  decisionLog: DecisionLogEntry[];
  milestones: MilestoneEntry[];
  brief: ProjectBrief;
  runbook: ProjectRunbook;
}

function defaultWorkflowConfig(): WorkflowConfig {
  const instructions: Record<string, string> = {};
  for (const status of WORKFLOW_STATUS_ORDER) {
    instructions[status] = "";
  }
  return {
    enabledStatuses: [...CORE_TASK_STATUSES],
    instructions,
  };
}

function normalizeWorkflowConfig(raw: any): WorkflowConfig {
  const defaults = defaultWorkflowConfig();
  const rawStatuses = Array.isArray(raw?.enabledStatuses)
    ? raw.enabledStatuses
    : defaults.enabledStatuses;
  const normalizedStatusSet = new Set<string>(CORE_TASK_STATUSES);
  for (const status of rawStatuses) {
    if (TASK_STATUSES.has(status as any)) {
      normalizedStatusSet.add(status);
    }
  }

  const normalizedStatuses = WORKFLOW_STATUS_ORDER.filter((status) =>
    normalizedStatusSet.has(status),
  );
  const instructions: Record<string, string> = { ...defaults.instructions };
  const rawInstructions =
    raw?.instructions && typeof raw.instructions === "object"
      ? raw.instructions
      : {};

  for (const status of WORKFLOW_STATUS_ORDER) {
    const value = rawInstructions[status];
    if (typeof value === "string") {
      instructions[status] = value.trim();
    }
  }

  return {
    enabledStatuses: normalizedStatuses,
    instructions,
  };
}

function mergeWorkflowConfig(baseRaw: any, patchRaw: any): WorkflowConfig {
  const base = normalizeWorkflowConfig(baseRaw);
  const patch = patchRaw && typeof patchRaw === "object" ? patchRaw : {};

  const merged: WorkflowConfig = {
    enabledStatuses: Array.isArray(patch.enabledStatuses)
      ? patch.enabledStatuses
      : base.enabledStatuses,
    instructions: {
      ...base.instructions,
      ...(patch.instructions && typeof patch.instructions === "object"
        ? patch.instructions
        : {}),
    },
  };

  return normalizeWorkflowConfig(merged);
}

function defaultProjectContext(): ProjectContext {
  return {
    definitionOfDone: [],
    decisionLog: [],
    milestones: [],
    brief: {
      goal: "",
      scope: "",
      outOfScope: "",
      successCriteria: "",
    },
    runbook: {
      preferredLanguage: "",
      responseStyle: "",
      constraints: "",
      escalationPath: "",
    },
  };
}

function normalizeProjectContextField(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 2000);
}

function normalizeProjectContextTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 160);
}

function normalizeProjectContextId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 80);
}

function normalizeProjectContextDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function normalizeProjectContext(raw: any): ProjectContext {
  const defaults = defaultProjectContext();
  const rawDefinitionOfDone = Array.isArray(raw?.definitionOfDone)
    ? raw.definitionOfDone
    : [];
  const rawDecisionLog = Array.isArray(raw?.decisionLog) ? raw.decisionLog : [];
  const rawMilestones = Array.isArray(raw?.milestones) ? raw.milestones : [];
  const rawBrief = raw?.brief && typeof raw.brief === "object" ? raw.brief : {};
  const rawRunbook =
    raw?.runbook && typeof raw.runbook === "object" ? raw.runbook : {};

  const definitionOfDone = rawDefinitionOfDone
    .map((item: unknown) => normalizeProjectContextField(item))
    .filter(Boolean)
    .slice(0, 40);

  const decisionLog = rawDecisionLog
    .map((entry: any, index: number): DecisionLogEntry | null => {
      if (!entry || typeof entry !== "object") return null;
      const id = normalizeProjectContextId(entry.id) || `decision-${index + 1}`;
      const date = normalizeProjectContextDate(entry.date);
      const title = normalizeProjectContextTitle(entry.title);
      const decision = normalizeProjectContextField(entry.decision);
      const rationale = normalizeProjectContextField(entry.rationale);
      if (!date && !title && !decision && !rationale) return null;
      return { id, date, title, decision, rationale };
    })
    .filter((entry: DecisionLogEntry | null): entry is DecisionLogEntry =>
      Boolean(entry),
    )
    .slice(0, 100);

  const milestones = rawMilestones
    .map((entry: any, index: number): MilestoneEntry | null => {
      if (!entry || typeof entry !== "object") return null;
      const id =
        normalizeProjectContextId(entry.id) || `milestone-${index + 1}`;
      const title = normalizeProjectContextTitle(entry.title);
      const dueDate = normalizeProjectContextDate(entry.dueDate);
      const notes = normalizeProjectContextField(entry.notes);
      const status: MilestoneStatus = [
        "planned",
        "in_progress",
        "done",
      ].includes(entry.status)
        ? entry.status
        : "planned";
      if (!title && !dueDate && !notes) return null;
      return { id, title, dueDate, status, notes };
    })
    .filter((entry: MilestoneEntry | null): entry is MilestoneEntry =>
      Boolean(entry),
    )
    .slice(0, 100);

  return {
    definitionOfDone,
    decisionLog,
    milestones,
    brief: {
      goal: normalizeProjectContextField(rawBrief.goal) || defaults.brief.goal,
      scope:
        normalizeProjectContextField(rawBrief.scope) || defaults.brief.scope,
      outOfScope:
        normalizeProjectContextField(rawBrief.outOfScope) ||
        defaults.brief.outOfScope,
      successCriteria:
        normalizeProjectContextField(rawBrief.successCriteria) ||
        defaults.brief.successCriteria,
    },
    runbook: {
      preferredLanguage:
        normalizeProjectContextField(rawRunbook.preferredLanguage) ||
        defaults.runbook.preferredLanguage,
      responseStyle:
        normalizeProjectContextField(rawRunbook.responseStyle) ||
        defaults.runbook.responseStyle,
      constraints:
        normalizeProjectContextField(rawRunbook.constraints) ||
        defaults.runbook.constraints,
      escalationPath:
        normalizeProjectContextField(rawRunbook.escalationPath) ||
        defaults.runbook.escalationPath,
    },
  };
}

function mergeProjectContext(baseRaw: any, patchRaw: any): ProjectContext {
  const base = normalizeProjectContext(baseRaw);
  const patch = patchRaw && typeof patchRaw === "object" ? patchRaw : {};

  const merged: ProjectContext = {
    definitionOfDone: Array.isArray(patch.definitionOfDone)
      ? patch.definitionOfDone
      : base.definitionOfDone,
    decisionLog: Array.isArray(patch.decisionLog)
      ? patch.decisionLog
      : base.decisionLog,
    milestones: Array.isArray(patch.milestones)
      ? patch.milestones
      : base.milestones,
    brief: {
      ...base.brief,
      ...(patch.brief && typeof patch.brief === "object" ? patch.brief : {}),
    },
    runbook: {
      ...base.runbook,
      ...(patch.runbook && typeof patch.runbook === "object"
        ? patch.runbook
        : {}),
    },
  };

  return normalizeProjectContext(merged);
}

function isProjectMember(
  project: ProjectAccessRecord,
  userId: string,
): boolean {
  return project.ownerId === userId || project.teamMemberIds.includes(userId);
}

function normalizeTeam(
  project: ProjectAccessRecord,
  extraIds: string[] = [],
): string[] {
  const deduped = new Set<string>([
    project.ownerId,
    ...project.teamMemberIds,
    ...extraIds,
  ]);
  return Array.from(deduped).filter(Boolean);
}

function projectLink(projectId: string): string {
  return `/projects/${projectId}`;
}

async function safeInbox(input: any) {
  try {
    await createInboxItems(input);
  } catch (error) {
    logger.warn(`Failed to create inbox items: ${error}`);
  }
}

async function notifyProjectInvite(options: {
  io: any;
  projectId: string;
  projectName?: string;
  actorId: string;
  recipientId: string;
}) {
  await safeInbox({
    recipientIds: [options.recipientId],
    actorId: options.actorId,
    type: "project.team.invited",
    title: "Added to project team",
    message: `Project: ${options.projectName || "Project"}`,
    link: projectLink(options.projectId),
    projectId: options.projectId,
    io: options.io,
  });
}

async function notifyTaskAssigned(options: {
  io: any;
  projectId: string;
  actorId: string;
  recipientId: string;
  taskId: string;
  taskTitle: string;
}) {
  await safeInbox({
    recipientIds: [options.recipientId],
    actorId: options.actorId,
    type: "task.assigned",
    title: "Task assigned to you",
    message: options.taskTitle,
    link: projectLink(options.projectId),
    projectId: options.projectId,
    taskId: options.taskId,
    io: options.io,
  });
}

async function resolveTaskReviewer(reviewedBy: string | null | undefined) {
  if (!reviewedBy) return null;
  const user = await prisma.user.findUnique({
    where: { id: reviewedBy },
    select: { id: true, username: true, displayName: true, userType: true },
  });
  return user || null;
}

function hasSameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const memberId of b) {
    if (!setA.has(memberId)) return false;
  }
  return true;
}

async function createProjectRoom(
  tx: any,
  projectId: string,
  projectName: string,
  ownerId: string,
) {
  const roomId = `${projectId}-room-${Date.now()}`;
  const gatewayUser = await tx.user.findUnique({
    where: { id: "gateway-system" },
    select: { id: true },
  });

  const participantsToCreate: Array<{
    userId: string;
    role: "OWNER" | "MEMBER";
  }> = [{ userId: ownerId, role: "OWNER" }];

  if (gatewayUser) {
    participantsToCreate.push({ userId: gatewayUser.id, role: "MEMBER" });
  } else {
    logger.warn(
      "gateway-system user missing; creating project room without gateway participant",
    );
  }

  const room = await tx.room.create({
    data: {
      id: roomId,
      name: `${projectName} · Team`,
      description: `Private project room for ${projectName}`,
      roomType: "TRIOLOGUE",
      isPrivate: true,
      participants: {
        create: participantsToCreate,
      },
    },
  });

  await tx.project.update({
    where: { id: projectId },
    data: { roomId: room.id },
  });

  return room;
}

async function addUserToProjectTeam(
  tx: any,
  project: ProjectAccessRecord,
  userId: string,
) {
  const nextTeam = normalizeTeam(project, [userId]);

  const updated = await tx.project.update({
    where: { id: project.id },
    data: { teamMemberIds: nextTeam },
  });

  if (project.roomId) {
    await tx.roomParticipant.upsert({
      where: { userId_roomId: { userId, roomId: project.roomId } },
      create: { userId, roomId: project.roomId, role: "MEMBER" },
      update: {},
    });
  }

  return updated;
}

async function createOneTimeInviteCode(
  tx: any,
  createdById: string,
  projectId: string,
  email: string,
): Promise<string> {
  for (let i = 0; i < 5; i += 1) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    try {
      await tx.inviteCode.create({
        data: {
          code,
          createdById,
          maxUses: 1,
          note: `project:${projectId}|email:${email}`,
        },
      });
      return code;
    } catch (error: any) {
      if (error?.code !== "P2002") {
        throw error;
      }
    }
  }

  throw new Error("Failed to generate unique invite code");
}

async function resolveProjectWithAccess(projectId: string, userId: string) {
  const project = (await (prisma as any).project.findUnique({
    where: { id: projectId },
  })) as ProjectAccessRecord | null;
  if (!project)
    return { project: null, error: { status: 404, message: "Not found" } };
  if (isProjectMember(project, userId)) return { project, error: null };

  // If user is in linked room, auto-sync into project team.
  if (project.roomId) {
    const roomMembership = await prisma.roomParticipant.findUnique({
      where: { userId_roomId: { userId, roomId: project.roomId } },
      select: { userId: true },
    });

    if (roomMembership) {
      const updated = await (prisma as any).project.update({
        where: { id: projectId },
        data: { teamMemberIds: normalizeTeam(project, [userId]) },
      });
      return { project: updated, error: null };
    }
  }

  return { project: null, error: { status: 403, message: "No access" } };
}

/**
 * GET /api/projects
 * List projects owned by or shared with the authenticated user
 */
router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const legacy = (
      Array.isArray(req.query.legacy) ? req.query.legacy : [req.query.legacy]
    )
      .map((value) => String(value).toLowerCase())
      .some((value) => value === "1" || value === "true");
    const rawLimit = Number.parseInt(
      String(req.query.limit ?? DEFAULT_PROJECT_LIMIT),
      10,
    );
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(rawLimit, MAX_PROJECT_LIMIT))
      : DEFAULT_PROJECT_LIMIT;
    const cursor =
      typeof req.query.cursor === "string" && req.query.cursor.trim()
        ? req.query.cursor.trim()
        : null;
    const status =
      typeof req.query.status === "string" && req.query.status.trim()
        ? req.query.status.trim()
        : null;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (status && !PROJECT_STATUSES.has(status)) {
      return res.status(400).json({ error: "Invalid status filter" });
    }

    const accessFilter = {
      OR: [{ ownerId: userId }, { teamMemberIds: { has: userId } }],
    };

    const baseWhere: any = {
      AND: [
        accessFilter,
        ...(status ? [{ status }] : []),
        ...(q
          ? [
              {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { description: { contains: q, mode: "insensitive" } },
                  { roomId: { contains: q, mode: "insensitive" } },
                ],
              },
            ]
          : []),
      ],
    };

    let paginatedWhere: any = baseWhere;

    if (cursor) {
      const cursorProject = await (prisma as any).project.findFirst({
        where: { AND: [baseWhere, { id: cursor }] },
        select: { id: true, updatedAt: true },
      });

      if (!cursorProject) {
        return res.status(400).json({ error: "Invalid cursor" });
      }

      paginatedWhere = {
        AND: [
          baseWhere,
          {
            OR: [
              { updatedAt: { lt: cursorProject.updatedAt } },
              {
                updatedAt: cursorProject.updatedAt,
                id: { lt: cursorProject.id },
              },
            ],
          },
        ],
      };
    }

    const projects = await (prisma as any).project.findMany({
      where: paginatedWhere,
      include: {
        _count: { select: { tasks: true, secrets: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = projects.length > limit;
    const items = hasMore ? projects.slice(0, limit) : projects;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
    const totalCount = await (prisma as any).project.count({
      where: baseWhere,
    });

    if (legacy) {
      return res.json(items);
    }

    res.json({
      items,
      totalCount,
      pageInfo: {
        limit,
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    logger.error("Error listing projects:", error);
    res.status(500).json({ error: "Failed to list projects" });
  }
});

/**
 * POST /api/projects
 * Create new project + auto-create linked private room
 */
router.post("/", authenticate, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name required" });

    const ownerId = req.user!.id;

    const { project, room } = await prisma.$transaction(async (tx) => {
      const createdProject = await (tx as any).project.create({
        data: {
          name: name.trim(),
          description,
          ownerId,
          teamMemberIds: [ownerId],
          workflowConfig: defaultWorkflowConfig(),
          projectContext: defaultProjectContext(),
        },
      });

      const createdRoom = await createProjectRoom(
        tx,
        createdProject.id,
        createdProject.name,
        ownerId,
      );

      return { project: createdProject, room: createdRoom };
    });

    // Notify gateway's live Socket.io connection to join the new room
    try {
      const io = req.app.get("io");
      if (io) {
        for (const [, socket] of io.sockets.sockets) {
          if ((socket as any).userId === "gateway-system") {
            socket.join(room.id);
            logger.info(`👥 gateway joined room dynamically: ${room.name}`);
          }
        }
      }
    } catch {}

    logger.info(
      `Project created: ${project.id} by ${ownerId}, room=${room.id}`,
    );
    res.status(201).json({ ...project, roomId: room.id });
  } catch (error) {
    logger.error("Error creating project:", error);
    res.status(500).json({ error: "Failed to create project" });
  }
});

/**
 * GET /api/projects/:id
 * Get project with tasks and team members
 */
router.get("/:id", authenticate, async (req, res) => {
  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
      include: {
        tasks: {
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
          include: { attachments: { orderBy: { createdAt: "desc" } } },
        },
        attachments: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!project) return res.status(404).json({ error: "Not found" });

    const userId = req.user!.id;
    let effectiveProject: ProjectAccessRecord = project;
    if (!isProjectMember(project, userId) && project.roomId) {
      const roomMembership = await prisma.roomParticipant.findUnique({
        where: { userId_roomId: { userId, roomId: project.roomId } },
        select: { userId: true },
      });
      if (roomMembership) {
        effectiveProject = await (prisma as any).project.update({
          where: { id: project.id },
          data: { teamMemberIds: normalizeTeam(project, [userId]) },
        });
      }
    }

    if (!isProjectMember(effectiveProject, userId)) {
      return res.status(403).json({ error: "No access" });
    }

    let teamMemberIds = normalizeTeam(effectiveProject);
    if (effectiveProject.roomId) {
      const roomParticipants = await prisma.roomParticipant.findMany({
        where: { roomId: effectiveProject.roomId },
        select: { userId: true },
      });
      const roomMemberIds = roomParticipants.map(
        (participant) => participant.userId,
      );
      const mergedTeam = Array.from(
        new Set([...teamMemberIds, ...roomMemberIds]),
      );
      if (!hasSameMembers(mergedTeam, teamMemberIds)) {
        effectiveProject = await (prisma as any).project.update({
          where: { id: effectiveProject.id },
          data: { teamMemberIds: mergedTeam },
        });
        teamMemberIds = normalizeTeam(effectiveProject);
      }
    }

    const teamMembers = await prisma.user.findMany({
      where: { id: { in: teamMemberIds } },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
        userType: true,
      },
    });

    const reviewerIds: string[] = Array.from(
      new Set(
        project.tasks
          .map((task: any) => task.reviewedBy as unknown)
          .filter(
            (reviewerId: unknown): reviewerId is string =>
              typeof reviewerId === "string" && reviewerId.trim().length > 0,
          ),
      ),
    );
    const reviewers =
      reviewerIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: reviewerIds } },
            select: {
              id: true,
              username: true,
              displayName: true,
              userType: true,
            },
          })
        : [];
    const reviewerMap = new Map(
      reviewers.map((reviewer) => [reviewer.id, reviewer]),
    );
    const enrichedTasks = project.tasks.map((task: any) => ({
      ...task,
      reviewer: task.reviewedBy
        ? reviewerMap.get(task.reviewedBy) || null
        : null,
    }));

    const workflowConfig = normalizeWorkflowConfig(
      (effectiveProject as any).workflowConfig,
    );
    const projectContext = normalizeProjectContext(
      (effectiveProject as any).projectContext,
    );
    res.json({
      ...effectiveProject,
      tasks: enrichedTasks,
      attachments: project.attachments,
      teamMemberIds,
      teamMembers,
      workflowConfig,
      projectContext,
    });
  } catch (error) {
    logger.error("Error fetching project:", error);
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

/**
 * GET /api/projects/:id/export
 * Export project context + workflow + tasks as markdown
 */
router.get("/:id/export", authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { project, error } = await resolveProjectWithAccess(
      req.params.id,
      userId,
    );
    if (error) return res.status(error.status).json({ error: error.message });

    const fullProject = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
      include: {
        tasks: {
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
          include: { attachments: { orderBy: { createdAt: "desc" } } },
        },
      },
    });

    if (!fullProject) return res.status(404).json({ error: "Not found" });

    const teamMemberIds = normalizeTeam(project!);
    const teamMembers = await prisma.user.findMany({
      where: { id: { in: teamMemberIds } },
      select: {
        id: true,
        username: true,
        displayName: true,
        userType: true,
      },
    });

    const teamMemberById = new Map(
      teamMembers.map((member) => [member.id, member]),
    );
    const workflowConfig = normalizeWorkflowConfig(
      (project as any).workflowConfig,
    );
    const projectContext = normalizeProjectContext(
      (project as any).projectContext,
    );

    const owner =
      teamMemberById.get(project!.ownerId) ||
      teamMembers.find((member) => member.id === project!.ownerId);
    const ownerLabel = owner
      ? `${owner.displayName || owner.username} (@${owner.username})`
      : project!.ownerId;

    const lines: string[] = [];
    lines.push(`# ${fullProject.name}`);
    lines.push("");
    lines.push(`Exported: ${new Date().toISOString()}`);
    lines.push(`Status: ${fullProject.status}`);
    lines.push(`Owner: ${ownerLabel}`);
    lines.push(`Team members: ${teamMemberIds.length}`);
    lines.push(`Tasks: ${fullProject.tasks.length}`);
    if (fullProject.roomId) lines.push(`Room: ${fullProject.roomId}`);
    lines.push("");

    if (fullProject.description?.trim()) {
      lines.push("## Description");
      lines.push("");
      lines.push(fullProject.description.trim());
      lines.push("");
    }

    lines.push("## Workflow");
    lines.push("");
    lines.push(
      `Enabled statuses: ${workflowConfig.enabledStatuses.join(", ")}`,
    );
    lines.push("");
    lines.push("### Status instructions");
    lines.push("");
    for (const status of workflowConfig.enabledStatuses) {
      const instruction = workflowConfig.instructions[status]?.trim();
      lines.push(`- **${status}**: ${instruction || "-"}`);
    }
    lines.push("");

    lines.push("## Project Context");
    lines.push("");
    lines.push("### Definition of Done");
    if (projectContext.definitionOfDone.length === 0) {
      lines.push("- (none)");
    } else {
      for (const item of projectContext.definitionOfDone) {
        lines.push(`- ${item}`);
      }
    }
    lines.push("");

    lines.push("### Decision Log");
    if (projectContext.decisionLog.length === 0) {
      lines.push("- (none)");
    } else {
      for (const entry of projectContext.decisionLog) {
        lines.push(`- **${entry.date || "-"} · ${entry.title || "Untitled"}**`);
        lines.push(`  - Decision: ${entry.decision || "-"}`);
        lines.push(`  - Rationale: ${entry.rationale || "-"}`);
      }
    }
    lines.push("");

    lines.push("### Milestones");
    if (projectContext.milestones.length === 0) {
      lines.push("- (none)");
    } else {
      for (const milestone of projectContext.milestones) {
        lines.push(`- **${milestone.title || "Untitled"}**`);
        lines.push(`  - Status: ${milestone.status}`);
        lines.push(`  - Due: ${milestone.dueDate || "-"}`);
        lines.push(`  - Notes: ${milestone.notes || "-"}`);
      }
    }
    lines.push("");

    lines.push("### Brief");
    lines.push(`- Goal: ${projectContext.brief.goal || "-"}`);
    lines.push(`- Scope: ${projectContext.brief.scope || "-"}`);
    lines.push(`- Out of scope: ${projectContext.brief.outOfScope || "-"}`);
    lines.push(
      `- Success criteria: ${projectContext.brief.successCriteria || "-"}`,
    );
    lines.push("");

    lines.push("### Runbook");
    lines.push(
      `- Preferred language: ${projectContext.runbook.preferredLanguage || "-"}`,
    );
    lines.push(
      `- Response style: ${projectContext.runbook.responseStyle || "-"}`,
    );
    lines.push(`- Constraints: ${projectContext.runbook.constraints || "-"}`);
    lines.push(
      `- Escalation path: ${projectContext.runbook.escalationPath || "-"}`,
    );
    lines.push("");

    lines.push("## Tasks");
    lines.push("");
    if (fullProject.tasks.length === 0) {
      lines.push("- (none)");
      lines.push("");
    } else {
      fullProject.tasks.forEach((task: any, index: number) => {
        const assignee = teamMemberById.get(task.assignedTo);
        const assigneeLabel = assignee
          ? `${assignee.displayName || assignee.username} (@${assignee.username})`
          : task.assignedTo;

        lines.push(`### ${index + 1}. ${task.title}`);
        lines.push(`- Status: ${task.status}`);
        lines.push(`- Priority: ${task.priority || "medium"}`);
        lines.push(`- Assignee: ${assigneeLabel}`);
        lines.push(
          `- Due date: ${task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : "-"}`,
        );
        lines.push(`- Updated: ${new Date(task.updatedAt).toISOString()}`);
        if (task.description?.trim()) {
          lines.push("- Description:");
          lines.push("");
          lines.push(task.description.trim());
          lines.push("");
        }
        if (task.attachments?.length > 0) {
          lines.push("- Attachments:");
          for (const attachment of task.attachments) {
            const attachmentUrl = attachmentUrlForExport(attachment.url);
            lines.push(`  - [${attachment.filename}](${attachmentUrl})`);
          }
        } else {
          lines.push("- Attachments: none");
        }
        lines.push("");
      });
    }

    const filename = `${sanitizeExportFileName(fullProject.name || "project", "project")}-export.md`;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(lines.join("\n"));
  } catch (error) {
    logger.error("Error exporting project:", error);
    return res.status(500).json({ error: "Failed to export project" });
  }
});

/**
 * PATCH /api/projects/:id
 * Update project (owner only)
 */
router.patch("/:id", authenticate, async (req, res) => {
  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return res.status(404).json({ error: "Not found" });
    if (project.ownerId !== req.user!.id)
      return res.status(403).json({ error: "Owner only" });

    const updated = await (prisma as any).project.update({
      where: { id: req.params.id },
      data: {
        ...(req.body.name && { name: req.body.name.trim() }),
        ...(req.body.description !== undefined && {
          description: req.body.description,
        }),
        ...(req.body.status && { status: req.body.status }),
        ...(req.body.projectContext !== undefined && {
          projectContext: mergeProjectContext(
            (project as any).projectContext,
            req.body.projectContext,
          ),
        }),
      },
    });

    // Keep room name aligned when project is renamed
    if (req.body.name && project.roomId) {
      await prisma.room
        .update({
          where: { id: project.roomId },
          data: { name: `${req.body.name.trim()} · Team` },
        })
        .catch(() => undefined);
    }

    logger.info(`Project updated: ${req.params.id}`);
    const changedFields = [
      "name",
      "description",
      "status",
      "projectContext",
    ].filter((field) => Object.prototype.hasOwnProperty.call(req.body, field));
    await pluginManager.emit("project.updated", {
      projectId: req.params.id,
      updatedBy: req.user!.id,
      status: updated.status,
      changedFields,
    });
    res.json({
      ...updated,
      workflowConfig: normalizeWorkflowConfig((updated as any).workflowConfig),
      projectContext: normalizeProjectContext((updated as any).projectContext),
    });
  } catch (error) {
    logger.error("Error updating project:", error);
    res.status(500).json({ error: "Failed to update project" });
  }
});

/**
 * PUT /api/projects/:id/workflow
 * Define project task workflow (owner only)
 */
router.put("/:id/workflow", authenticate, async (req, res) => {
  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return res.status(404).json({ error: "Not found" });
    if (project.ownerId !== req.user!.id)
      return res.status(403).json({ error: "Owner only" });

    const workflowConfig = mergeWorkflowConfig(
      project.workflowConfig,
      req.body || {},
    );
    const disabledOptionalStatuses = OPTIONAL_TASK_STATUSES.filter(
      (status) => !workflowConfig.enabledStatuses.includes(status),
    );

    if (disabledOptionalStatuses.length > 0) {
      const tasksUsingDisabledStatus = await (prisma as any).task.count({
        where: {
          projectId: req.params.id,
          status: { in: disabledOptionalStatuses },
        },
      });

      if (tasksUsingDisabledStatus > 0) {
        return res.status(400).json({
          error: "Cannot disable a status while tasks are still in that column",
          statuses: disabledOptionalStatuses,
          taskCount: tasksUsingDisabledStatus,
        });
      }
    }

    const updated = await (prisma as any).project.update({
      where: { id: req.params.id },
      data: { workflowConfig },
      select: { id: true, workflowConfig: true, updatedAt: true },
    });
    await safeInbox({
      recipientIds: normalizeTeam(project as any),
      actorId: req.user!.id,
      type: "project.workflow.updated",
      title: "Project workflow updated",
      message: `Project: ${req.params.id}`,
      link: projectLink(req.params.id),
      projectId: req.params.id,
      io: req.app.get("io"),
    });

    logger.info(`Project workflow updated: ${req.params.id}`);
    res.json(updated);
  } catch (error) {
    logger.error("Error updating project workflow:", error);
    res.status(500).json({ error: "Failed to update workflow" });
  }
});

/**
 * PUT /api/projects/:id/context
 * Define project brief + runbook (owner only)
 */
router.put("/:id/context", authenticate, async (req, res) => {
  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return res.status(404).json({ error: "Not found" });
    if (project.ownerId !== req.user!.id)
      return res.status(403).json({ error: "Owner only" });

    const projectContext = mergeProjectContext(
      (project as any).projectContext,
      req.body || {},
    );
    const updated = await (prisma as any).project.update({
      where: { id: req.params.id },
      data: { projectContext },
      select: { id: true, projectContext: true, updatedAt: true },
    });
    await safeInbox({
      recipientIds: normalizeTeam(project as any),
      actorId: req.user!.id,
      type: "project.context.updated",
      title: "Project context updated",
      message: `Project: ${req.params.id}`,
      link: projectLink(req.params.id),
      projectId: req.params.id,
      io: req.app.get("io"),
    });

    logger.info(`Project context updated: ${req.params.id}`);
    res.json({
      ...updated,
      projectContext: normalizeProjectContext(updated.projectContext),
    });
  } catch (error) {
    logger.error("Error updating project context:", error);
    res.status(500).json({ error: "Failed to update project context" });
  }
});

/**
 * DELETE /api/projects/:id
 * Delete project (owner only) + linked room
 */
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });
    if (!project) return res.status(404).json({ error: "Not found" });
    if (project.ownerId !== req.user!.id)
      return res.status(403).json({ error: "Owner only" });

    await prisma.$transaction(async (tx) => {
      await (tx as any).project.delete({ where: { id: req.params.id } });

      if (project.roomId) {
        await tx.room
          .delete({ where: { id: project.roomId } })
          .catch(() => undefined);
      }
    });

    logger.info(`Project deleted: ${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    logger.error("Error deleting project:", error);
    res.status(500).json({ error: "Failed to delete project" });
  }
});

/**
 * POST /api/projects/:id/team
 * Add team member by userId (owner only)
 */
router.post("/:id/team", authenticate, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return res.status(404).json({ error: "Not found" });
    if (project.ownerId !== req.user!.id)
      return res.status(403).json({ error: "Owner only" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const updated = await prisma.$transaction(async (tx) => {
      return addUserToProjectTeam(tx, project, user.id);
    });
    await notifyProjectInvite({
      io: req.app.get("io"),
      projectId: project.id,
      projectName: project.name,
      actorId: req.user!.id,
      recipientId: user.id,
    });

    logger.info(`User ${userId} added to project ${req.params.id}`);
    res.json(updated);
  } catch (error) {
    logger.error("Error adding team member:", error);
    res.status(500).json({ error: "Failed to add team member" });
  }
});

/**
 * POST /api/projects/:id/team/invite
 * Invite by username (humans + agents), by human email, or by agent userId.
 */
router.post("/:id/team/invite", authenticate, async (req, res) => {
  try {
    const { email, agentUserId, username } = req.body;
    const ownerId = req.user!.id;

    const inviteTargets = [email, agentUserId, username].filter(Boolean).length;
    if (inviteTargets === 0) {
      return res
        .status(400)
        .json({ error: "Provide username, email, or agentUserId" });
    }
    if (inviteTargets > 1) {
      return res.status(400).json({ error: "Provide only one invite target" });
    }

    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });
    if (!project) return res.status(404).json({ error: "Not found" });
    if (project.ownerId !== ownerId)
      return res.status(403).json({ error: "Owner only" });

    if (username) {
      const normalizedUsername = String(username).trim();
      if (!normalizedUsername) {
        return res.status(400).json({ error: "Valid username required" });
      }

      const targetUser = await prisma.user.findUnique({
        where: { username: normalizedUsername },
        select: { id: true, userType: true, isActive: true },
      });

      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (targetUser.userType === "HUMAN") {
        const updated = await prisma.$transaction(async (tx) => {
          return addUserToProjectTeam(tx, project, targetUser.id);
        });
        await notifyProjectInvite({
          io: req.app.get("io"),
          projectId: project.id,
          projectName: project.name,
          actorId: ownerId,
          recipientId: targetUser.id,
        });

        logger.info(
          `Human ${targetUser.id} invited to project ${project.id} via username ${normalizedUsername}`,
        );
        return res.json({
          success: true,
          mode: "username-human",
          project: updated,
          userId: targetUser.id,
        });
      }

      const tokenByUsername = await (prisma as any).agentToken.findFirst({
        where: { userId: targetUser.id, isActive: true, status: "active" },
        select: { createdById: true, visibility: true, sharedWith: true },
      });

      if (!tokenByUsername) {
        return res.status(403).json({ error: "Agent is not active" });
      }

      const allowedByVisibility =
        tokenByUsername.createdById === ownerId ||
        tokenByUsername.visibility === "public" ||
        (tokenByUsername.visibility === "shared" &&
          tokenByUsername.sharedWith.includes(ownerId));

      if (!allowedByVisibility) {
        return res
          .status(403)
          .json({ error: "Agent is not visible to this project owner" });
      }

      const updated = await prisma.$transaction(async (tx) => {
        return addUserToProjectTeam(tx, project, targetUser.id);
      });
      await notifyProjectInvite({
        io: req.app.get("io"),
        projectId: project.id,
        projectName: project.name,
        actorId: ownerId,
        recipientId: targetUser.id,
      });

      logger.info(
        `Agent ${targetUser.id} invited to project ${project.id} via username ${normalizedUsername}`,
      );
      return res.json({
        success: true,
        mode: "username-agent",
        project: updated,
        userId: targetUser.id,
      });
    }

    if (email) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!normalizedEmail.includes("@")) {
        return res.status(400).json({ error: "Valid email required" });
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, userType: true, email: true },
      });

      if (!existingUser) {
        const inviteCode = await prisma.$transaction(async (tx) => {
          return createOneTimeInviteCode(
            tx,
            ownerId,
            project.id,
            normalizedEmail,
          );
        });

        logger.info(
          `Pending project invite created for ${normalizedEmail} in project ${project.id}`,
        );
        return res.json({
          success: true,
          mode: "email-pending",
          email: normalizedEmail,
          inviteCode,
          message: "User not found. Share invite code with this email address.",
        });
      }

      if (existingUser.userType !== "HUMAN") {
        return res
          .status(400)
          .json({ error: "Email belongs to a non-human account" });
      }

      const updated = await prisma.$transaction(async (tx) => {
        return addUserToProjectTeam(tx, project, existingUser.id);
      });
      await notifyProjectInvite({
        io: req.app.get("io"),
        projectId: project.id,
        projectName: project.name,
        actorId: ownerId,
        recipientId: existingUser.id,
      });

      logger.info(
        `Human ${existingUser.id} invited to project ${project.id} via email ${normalizedEmail}`,
      );
      return res.json({
        success: true,
        mode: "email-existing-user",
        project: updated,
        userId: existingUser.id,
      });
    }

    const agentUser = await prisma.user.findUnique({
      where: { id: agentUserId },
      select: { id: true, userType: true, isActive: true },
    });

    if (
      !agentUser ||
      !["AI_AGENT", "AI_ICE", "AI_LAVA", "AI_OTHER"].includes(
        agentUser.userType,
      )
    ) {
      return res.status(404).json({ error: "Agent not found" });
    }

    const token = await (prisma as any).agentToken.findFirst({
      where: { userId: agentUser.id, isActive: true, status: "active" },
      select: { createdById: true, visibility: true, sharedWith: true },
    });

    if (!token) {
      return res.status(403).json({ error: "Agent is not active" });
    }

    const allowedByVisibility =
      token.createdById === ownerId ||
      token.visibility === "public" ||
      (token.visibility === "shared" && token.sharedWith.includes(ownerId));

    if (!allowedByVisibility) {
      return res
        .status(403)
        .json({ error: "Agent is not visible to this project owner" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      return addUserToProjectTeam(tx, project, agentUser.id);
    });
    await notifyProjectInvite({
      io: req.app.get("io"),
      projectId: project.id,
      projectName: project.name,
      actorId: ownerId,
      recipientId: agentUser.id,
    });

    logger.info(`Agent ${agentUser.id} added to project ${project.id}`);
    res.json({
      success: true,
      mode: "agent",
      project: updated,
      userId: agentUser.id,
    });
  } catch (error) {
    logger.error("Error inviting team member:", error);
    res.status(500).json({ error: "Failed to invite team member" });
  }
});

/**
 * POST /api/projects/:id/tasks
 * Create task
 */
router.post("/:id/tasks", authenticate, async (req, res) => {
  try {
    const { project, error } = await resolveProjectWithAccess(
      req.params.id,
      req.user!.id,
    );
    if (error) return res.status(error.status).json({ error: error.message });

    if (!req.body.title?.trim()) {
      return res.status(400).json({ error: "title required" });
    }

    const assignedTo = req.body.assignedTo || req.user!.id;
    const allowedTeam = new Set(normalizeTeam(project!));
    const reviewedByInput = req.body.reviewedBy;
    let reviewedBy: string | null | undefined;
    if (reviewedByInput !== undefined) {
      if (reviewedByInput === null || String(reviewedByInput).trim() === "") {
        reviewedBy = null;
      } else {
        reviewedBy = String(reviewedByInput).trim();
      }
    }

    if (!allowedTeam.has(assignedTo)) {
      return res
        .status(400)
        .json({ error: "assignedTo must be a project team member" });
    }
    if (reviewedBy && !allowedTeam.has(reviewedBy)) {
      return res
        .status(400)
        .json({ error: "reviewedBy must be a project team member" });
    }

    if (req.body.status && !TASK_STATUSES.has(req.body.status)) {
      return res.status(400).json({ error: "Invalid task status" });
    }

    const workflowConfig = normalizeWorkflowConfig(
      (project as any).workflowConfig,
    );
    if (
      req.body.status &&
      !workflowConfig.enabledStatuses.includes(req.body.status)
    ) {
      return res
        .status(400)
        .json({ error: "Status is disabled in project workflow" });
    }

    if (req.body.priority && !TASK_PRIORITIES.has(req.body.priority)) {
      return res.status(400).json({ error: "Invalid task priority" });
    }
    const usedMemoryIds = normalizeUsedMemoryIds(req.body.usedMemoryIds);

    const task = await (prisma as any).task.create({
      data: {
        projectId: req.params.id,
        title: req.body.title.trim(),
        assignedTo,
        ...(reviewedBy !== undefined ? { reviewedBy } : {}),
        ...(req.body.description && { description: req.body.description }),
        ...(req.body.status && { status: req.body.status }),
        ...(req.body.priority && { priority: req.body.priority }),
        ...(req.body.dueDate && { dueDate: new Date(req.body.dueDate) }),
        ...(req.body.usedMemoryIds !== undefined ? { usedMemoryIds } : {}),
      },
      include: { attachments: { orderBy: { createdAt: "desc" } } },
    });
    const reviewer = await resolveTaskReviewer(task.reviewedBy);
    await notifyTaskAssigned({
      io: req.app.get("io"),
      projectId: req.params.id,
      actorId: req.user!.id,
      recipientId: task.assignedTo,
      taskId: task.id,
      taskTitle: task.title,
    });
    await emitTaskAssignedIfAgent({
      io: req.app.get("io"),
      taskId: task.id,
      projectId: req.params.id,
      assignedTo: task.assignedTo,
      assignedBy: req.user!.id,
    });

    logger.info(`Task created: ${task.id} in project ${req.params.id}`);
    res.status(201).json({ ...task, reviewer });
  } catch (error) {
    logger.error("Error creating task:", error);
    res.status(500).json({ error: "Failed to create task" });
  }
});

/**
 * POST /api/projects/:projectId/attachments
 * Upload and attach a file to a project
 */
router.post("/:projectId/attachments", authenticate, (req, res) => {
  projectAttachmentUpload.single("file")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "File too large (max 12 MB)" });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file provided" });
    }

    try {
      const userId = req.user!.id;
      const { project, error } = await resolveProjectWithAccess(
        req.params.projectId,
        userId,
      );
      if (error) {
        removeUploadedFile(file.path);
        return res.status(error.status).json({ error: error.message });
      }

      const attachmentType =
        ALLOWED_PROJECT_ATTACHMENT_MIME_TYPES[file.mimetype] || "DOCUMENT";
      const fileUrl = `/uploads/${file.filename}`;

      const attachment = await (prisma as any).projectAttachment.create({
        data: {
          projectId: req.params.projectId,
          filename: file.originalname,
          url: fileUrl,
          mimeType: file.mimetype,
          size: file.size,
          type: attachmentType,
          uploadedBy: userId,
        },
      });
      await safeInbox({
        recipientIds: normalizeTeam(project!),
        actorId: userId,
        type: "project.attachment.added",
        title: "Project attachment added",
        message: file.originalname,
        link: projectLink(req.params.projectId),
        projectId: req.params.projectId,
        io: req.app.get("io"),
      });

      logger.info(
        `Project attachment uploaded: project=${req.params.projectId} file=${file.originalname}`,
      );
      return res.status(201).json({ attachment });
    } catch (error) {
      logger.error("Project attachment upload failed:", error);
      removeUploadedFile(file.path);
      return res.status(500).json({ error: "Upload failed" });
    }
  });
});

/**
 * DELETE /api/projects/:projectId/attachments/:attachmentId
 * Delete an attachment from a project
 */
router.delete(
  "/:projectId/attachments/:attachmentId",
  authenticate,
  async (req, res) => {
    try {
      const userId = req.user!.id;
      const { project, error } = await resolveProjectWithAccess(
        req.params.projectId,
        userId,
      );
      if (error) return res.status(error.status).json({ error: error.message });

      const attachment = await (prisma as any).projectAttachment.findUnique({
        where: { id: req.params.attachmentId },
        select: {
          id: true,
          projectId: true,
          filename: true,
          url: true,
          uploadedBy: true,
        },
      });

      if (!attachment || attachment.projectId !== req.params.projectId) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      const canDelete =
        project!.ownerId === userId ||
        attachment.uploadedBy === userId ||
        Boolean(req.user?.isAdmin);

      if (!canDelete) {
        return res
          .status(403)
          .json({ error: "Only owner or uploader can delete this attachment" });
      }

      await (prisma as any).projectAttachment.delete({
        where: { id: attachment.id },
      });

      if (attachment.url?.startsWith("/uploads/")) {
        const filename = attachment.url.replace("/uploads/", "");
        removeUploadedFile(path.join(UPLOAD_DIR, filename));
      }
      await safeInbox({
        recipientIds: normalizeTeam(project!),
        actorId: userId,
        type: "project.attachment.removed",
        title: "Project attachment removed",
        message: attachment.filename,
        link: projectLink(req.params.projectId),
        projectId: req.params.projectId,
        io: req.app.get("io"),
      });

      logger.info(
        `Project attachment deleted: project=${req.params.projectId} attachment=${attachment.id}`,
      );
      return res.json({
        success: true,
        attachmentId: attachment.id,
      });
    } catch (error) {
      logger.error("Project attachment delete failed:", error);
      return res.status(500).json({ error: "Failed to delete attachment" });
    }
  },
);

/**
 * POST /api/projects/:projectId/tasks/:id/attachments
 * Upload and attach a file to a task
 */
router.post("/:projectId/tasks/:id/attachments", authenticate, (req, res) => {
  taskAttachmentUpload.single("file")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "File too large (max 10 MB)" });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file provided" });
    }

    try {
      const { project, error } = await resolveProjectWithAccess(
        req.params.projectId,
        req.user!.id,
      );
      if (error) {
        removeUploadedFile(file.path);
        return res.status(error.status).json({ error: error.message });
      }

      const task = await (prisma as any).task.findUnique({
        where: { id: req.params.id },
        select: { id: true, projectId: true, assignedTo: true },
      });

      if (!task) {
        removeUploadedFile(file.path);
        return res.status(404).json({ error: "Task not found" });
      }

      if (
        task.projectId !== req.params.projectId ||
        project!.id !== task.projectId
      ) {
        removeUploadedFile(file.path);
        return res
          .status(400)
          .json({ error: "Task does not belong to this project" });
      }

      const attachmentType =
        ALLOWED_TASK_ATTACHMENT_MIME_TYPES[file.mimetype] || "DOCUMENT";
      const fileUrl = `/uploads/${file.filename}`;

      const attachment = await (prisma as any).taskAttachment.create({
        data: {
          taskId: task.id,
          filename: file.originalname,
          url: fileUrl,
          mimeType: file.mimetype,
          size: file.size,
          type: attachmentType,
          uploadedBy: req.user!.id,
        },
      });

      const updatedTask = await (prisma as any).task.findUnique({
        where: { id: task.id },
        include: { attachments: { orderBy: { createdAt: "desc" } } },
      });
      await safeInbox({
        recipientIds: [task.assignedTo, project!.ownerId],
        actorId: req.user!.id,
        type: "task.attachment.added",
        title: "Task attachment added",
        message: file.originalname,
        link: projectLink(req.params.projectId),
        projectId: req.params.projectId,
        taskId: task.id,
        io: req.app.get("io"),
      });

      logger.info(
        `Task attachment uploaded: task=${task.id} file=${file.originalname}`,
      );
      return res.status(201).json({
        task: updatedTask,
        attachment,
      });
    } catch (error) {
      logger.error("Task attachment upload failed:", error);
      removeUploadedFile(file.path);
      return res.status(500).json({ error: "Upload failed" });
    }
  });
});

/**
 * DELETE /api/projects/:projectId/tasks/:id/attachments/:attachmentId
 * Delete an attachment from a task
 */
router.delete(
  "/:projectId/tasks/:id/attachments/:attachmentId",
  authenticate,
  async (req, res) => {
    try {
      const userId = req.user!.id;
      const { project, error } = await resolveProjectWithAccess(
        req.params.projectId,
        userId,
      );
      if (error) return res.status(error.status).json({ error: error.message });

      const attachment = await (prisma as any).taskAttachment.findUnique({
        where: { id: req.params.attachmentId },
        include: {
          task: {
            select: {
              id: true,
              projectId: true,
              assignedTo: true,
            },
          },
        },
      });

      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      if (attachment.taskId !== req.params.id) {
        return res
          .status(400)
          .json({ error: "Attachment does not belong to this task" });
      }

      if (
        attachment.task.projectId !== req.params.projectId ||
        project!.id !== attachment.task.projectId
      ) {
        return res
          .status(400)
          .json({ error: "Task does not belong to this project" });
      }

      const canDelete =
        project!.ownerId === userId ||
        attachment.task.assignedTo === userId ||
        attachment.uploadedBy === userId;

      if (!canDelete) {
        return res.status(403).json({
          error: "Only owner, assignee, or uploader can delete this attachment",
        });
      }

      await (prisma as any).taskAttachment.delete({
        where: { id: attachment.id },
      });

      if (attachment.url?.startsWith("/uploads/")) {
        const filename = attachment.url.replace("/uploads/", "");
        removeUploadedFile(path.join(UPLOAD_DIR, filename));
      }

      const updatedTask = await (prisma as any).task.findUnique({
        where: { id: attachment.taskId },
        include: { attachments: { orderBy: { createdAt: "desc" } } },
      });
      await safeInbox({
        recipientIds: [attachment.task.assignedTo, project!.ownerId],
        actorId: userId,
        type: "task.attachment.removed",
        title: "Task attachment removed",
        message: attachment.filename,
        link: projectLink(req.params.projectId),
        projectId: req.params.projectId,
        taskId: attachment.taskId,
        io: req.app.get("io"),
      });

      logger.info(
        `Task attachment deleted: task=${attachment.taskId} attachment=${attachment.id}`,
      );
      return res.json({
        success: true,
        attachmentId: attachment.id,
        task: updatedTask,
      });
    } catch (error) {
      logger.error("Task attachment delete failed:", error);
      return res.status(500).json({ error: "Failed to delete attachment" });
    }
  },
);

async function updateTask(req: any, res: any) {
  try {
    const task = await (prisma as any).task.findUnique({
      where: { id: req.params.id },
      include: { project: true },
    });

    if (!task) return res.status(404).json({ error: "Not found" });

    const userId = req.user!.id;
    const project = task.project as ProjectAccessRecord;
    if (req.params.projectId && task.projectId !== req.params.projectId) {
      return res
        .status(400)
        .json({ error: "Task does not belong to this project" });
    }
    if (!isProjectMember(project, userId)) {
      return res.status(403).json({ error: "No access" });
    }

    const isOwner = project.ownerId === userId;
    const isCurrentAssignee = task.assignedTo === userId;
    const canEditTask = isOwner || isCurrentAssignee;
    const allowedTeam = new Set(normalizeTeam(project));

    const statusIsChanging =
      req.body.status !== undefined && req.body.status !== task.status;
    if (statusIsChanging && task.assignedTo !== userId) {
      return res
        .status(403)
        .json({ error: "Only the current assignee can move this task" });
    }

    const data: Record<string, unknown> = {};

    if (
      req.body.title !== undefined ||
      req.body.description !== undefined ||
      req.body.priority !== undefined ||
      req.body.dueDate !== undefined ||
      req.body.usedMemoryIds !== undefined
    ) {
      if (!canEditTask) {
        return res
          .status(403)
          .json({ error: "Only owner or current assignee can edit this task" });
      }
    }

    if (req.body.title !== undefined)
      data.title = String(req.body.title).trim();
    if (req.body.description !== undefined) {
      data.description = req.body.description
        ? String(req.body.description).trim()
        : null;
    }

    if (req.body.status !== undefined) {
      if (!TASK_STATUSES.has(req.body.status)) {
        return res.status(400).json({ error: "Invalid task status" });
      }
      const workflowConfig = normalizeWorkflowConfig(
        (project as any).workflowConfig,
      );
      if (!workflowConfig.enabledStatuses.includes(req.body.status)) {
        return res
          .status(400)
          .json({ error: "Status is disabled in project workflow" });
      }
      data.status = req.body.status;
    }

    if (req.body.assignedTo !== undefined) {
      if (!allowedTeam.has(req.body.assignedTo)) {
        return res
          .status(400)
          .json({ error: "assignedTo must be a project team member" });
      }

      if (!isOwner && !isCurrentAssignee) {
        return res
          .status(403)
          .json({ error: "Only owner or current assignee can reassign task" });
      }

      data.assignedTo = req.body.assignedTo;
    }

    if (req.body.reviewedBy !== undefined) {
      if (!canEditTask) {
        return res
          .status(403)
          .json({ error: "Only owner or current assignee can set reviewer" });
      }

      if (
        req.body.reviewedBy === null ||
        String(req.body.reviewedBy).trim() === ""
      ) {
        data.reviewedBy = null;
      } else {
        const reviewerId = String(req.body.reviewedBy).trim();
        if (!allowedTeam.has(reviewerId)) {
          return res
            .status(400)
            .json({ error: "reviewedBy must be a project team member" });
        }
        data.reviewedBy = reviewerId;
      }
    }

    if (req.body.priority !== undefined) {
      if (!TASK_PRIORITIES.has(req.body.priority)) {
        return res.status(400).json({ error: "Invalid task priority" });
      }
      data.priority = req.body.priority;
    }

    if (req.body.dueDate !== undefined) {
      data.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
    }

    if (req.body.usedMemoryIds !== undefined) {
      data.usedMemoryIds = normalizeUsedMemoryIds(req.body.usedMemoryIds);
    }

    const updated = await (prisma as any).task.update({
      where: { id: req.params.id },
      data,
      include: { attachments: { orderBy: { createdAt: "desc" } } },
    });

    const io = req.app.get("io");
    if (updated.assignedTo !== task.assignedTo) {
      await notifyTaskAssigned({
        io,
        projectId: task.projectId,
        actorId: userId,
        recipientId: updated.assignedTo,
        taskId: updated.id,
        taskTitle: updated.title,
      });
      await emitTaskAssignedIfAgent({
        io,
        taskId: updated.id,
        projectId: task.projectId,
        assignedTo: updated.assignedTo,
        assignedBy: userId,
      });
    }

    if (
      typeof data.reviewedBy === "string" &&
      data.reviewedBy !== task.reviewedBy
    ) {
      await safeInbox({
        recipientIds: [data.reviewedBy],
        actorId: userId,
        type: "task.reviewer.assigned",
        title: "You are assigned as reviewer",
        message: updated.title,
        link: projectLink(task.projectId),
        projectId: task.projectId,
        taskId: updated.id,
        io,
      });
    }

    if (
      typeof data.reviewedBy === "string" &&
      data.reviewedBy !== task.reviewedBy
    ) {
      await safeInbox({
        recipientIds: [data.reviewedBy],
        actorId: userId,
        type: "task.reviewer.assigned",
        title: "You are assigned as reviewer",
        message: updated.title,
        link: projectLink(task.projectId),
        projectId: task.projectId,
        taskId: updated.id,
        io,
      });
    }

    if (updated.status !== task.status) {
      await safeInbox({
        recipientIds: [updated.assignedTo, project.ownerId],
        actorId: userId,
        type: "task.status.changed",
        title: "Task status changed",
        message: `${task.title}: ${task.status} -> ${updated.status}`,
        link: projectLink(task.projectId),
        projectId: task.projectId,
        taskId: updated.id,
        io,
      });

      await onTaskStatusChanged({
        io,
        taskId: updated.id,
        projectId: task.projectId,
        oldStatus: task.status,
        newStatus: updated.status,
        updatedBy: userId,
      });

      if (updated.status === "in_review" && updated.reviewedBy) {
        await safeInbox({
          recipientIds: [updated.reviewedBy],
          actorId: userId,
          type: "task.review_requested",
          title: "Task ready for review",
          message: updated.title,
          link: projectLink(task.projectId),
          projectId: task.projectId,
          taskId: updated.id,
          io,
        });
      }
    }

    const oldDue = task.dueDate ? new Date(task.dueDate).getTime() : null;
    const newDue = updated.dueDate ? new Date(updated.dueDate).getTime() : null;
    if (oldDue !== newDue) {
      await safeInbox({
        recipientIds: [updated.assignedTo, project.ownerId],
        actorId: userId,
        type: "task.due_date.changed",
        title: "Task due date updated",
        message: updated.title,
        link: projectLink(task.projectId),
        projectId: task.projectId,
        taskId: updated.id,
        io,
      });
    }

    logger.info(`Task updated: ${req.params.id}`);
    const reviewer = await resolveTaskReviewer(updated.reviewedBy);
    res.json({ ...updated, reviewer });
  } catch (error) {
    logger.error("Error updating task:", error);
    res.status(500).json({ error: "Failed to update task" });
  }
}

async function deleteTask(req: any, res: any) {
  try {
    const task = await (prisma as any).task.findUnique({
      where: { id: req.params.id },
      include: { project: true },
    });

    if (!task) return res.status(404).json({ error: "Not found" });

    const userId = req.user!.id;
    const project = task.project as ProjectAccessRecord;

    if (req.params.projectId && task.projectId !== req.params.projectId) {
      return res
        .status(400)
        .json({ error: "Task does not belong to this project" });
    }
    if (!isProjectMember(project, userId)) {
      return res.status(403).json({ error: "No access" });
    }

    const isOwner = project.ownerId === userId;
    const isCurrentAssignee = task.assignedTo === userId;
    if (!isOwner && !isCurrentAssignee) {
      return res
        .status(403)
        .json({ error: "Only owner or current assignee can delete task" });
    }

    await safeInbox({
      recipientIds: [task.assignedTo, project.ownerId],
      actorId: userId,
      type: "task.deleted",
      title: "Task deleted",
      message: task.title,
      link: projectLink(task.projectId),
      projectId: task.projectId,
      taskId: task.id,
      io: req.app.get("io"),
    });

    await (prisma as any).task.delete({ where: { id: req.params.id } });
    logger.info(`Task deleted: ${req.params.id}`);
    res.json({ success: true, taskId: req.params.id });
  } catch (error) {
    logger.error("Error deleting task:", error);
    res.status(500).json({ error: "Failed to delete task" });
  }
}

/**
 * PATCH /api/projects/tasks/:id
 * Legacy update endpoint
 */
router.patch("/tasks/:id", authenticate, updateTask);

/**
 * DELETE /api/projects/tasks/:id
 * Legacy delete endpoint
 */
router.delete("/tasks/:id", authenticate, deleteTask);

/**
 * PUT /api/projects/:projectId/tasks/:id
 * Project-scoped update endpoint used by frontend
 */
router.put("/:projectId/tasks/:id", authenticate, updateTask);

/**
 * DELETE /api/projects/:projectId/tasks/:id
 * Project-scoped delete endpoint used by frontend
 */
router.delete("/:projectId/tasks/:id", authenticate, deleteTask);

/**
 * POST /api/projects/:id/secrets
 * Create secret (owner only)
 */
router.post("/:id/secrets", authenticate, async (req, res) => {
  try {
    const { name, value, permissions } = req.body;
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return res.status(404).json({ error: "Not found" });
    if (project.ownerId !== req.user!.id)
      return res.status(403).json({ error: "Owner only" });

    const encryptedValue = encryptSecret(value, req.params.id);

    const secret = await (prisma as any).projectSecret.create({
      data: {
        projectId: req.params.id,
        name,
        encryptedValue,
        createdBy: req.user!.id,
        permissions: permissions || {},
      },
    });

    const { encryptedValue: _, ...safeSecret } = secret;
    logger.info(`Secret created: ${secret.id} in project ${req.params.id}`);
    res.json(safeSecret);
  } catch (error) {
    logger.error("Error creating secret:", error);
    res.status(500).json({ error: "Failed to create secret" });
  }
});

/**
 * GET /api/projects/:id/secrets
 * List secrets (no values)
 */
router.get("/:id/secrets", authenticate, async (req, res) => {
  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return res.status(404).json({ error: "Not found" });

    const userId = req.user!.id;
    if (!isProjectMember(project, userId)) {
      return res.status(403).json({ error: "No access" });
    }

    const secrets = await (prisma as any).projectSecret.findMany({
      where: { projectId: req.params.id },
    });

    const safeSecrets = secrets.map((s: any) => ({
      id: s.id,
      name: s.name,
      createdBy: s.createdBy,
      lastUsedAt: s.lastUsedAt,
      lastUsedBy: s.lastUsedBy,
      permissions: s.permissions,
      createdAt: s.createdAt,
    }));

    res.json(safeSecrets);
  } catch (error) {
    logger.error("Error fetching secrets:", error);
    res.status(500).json({ error: "Failed to fetch secrets" });
  }
});

/**
 * PUT /api/projects/:id/secrets/:secretId
 * Update secret (owner only)
 */
router.put("/:id/secrets/:secretId", authenticate, async (req, res) => {
  try {
    const { name, value, permissions } = req.body;
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return res.status(404).json({ error: "Not found" });
    if (project.ownerId !== req.user!.id)
      return res.status(403).json({ error: "Owner only" });

    const secret = await (prisma as any).projectSecret.findUnique({
      where: { id: req.params.secretId },
    });

    if (!secret) return res.status(404).json({ error: "Secret not found" });
    if (secret.projectId !== req.params.id)
      return res.status(403).json({ error: "Not in this project" });

    const data: any = {};
    if (name) data.name = name.trim();
    if (value) data.encryptedValue = encryptSecret(value, req.params.id);
    if (permissions !== undefined) data.permissions = permissions;

    const updated = await (prisma as any).projectSecret.update({
      where: { id: req.params.secretId },
      data,
    });

    const { encryptedValue: _, ...safeSecret } = updated;
    logger.info(`Secret updated: ${req.params.secretId}`);
    res.json(safeSecret);
  } catch (error) {
    logger.error("Error updating secret:", error);
    res.status(500).json({ error: "Failed to update secret" });
  }
});

/**
 * DELETE /api/projects/:id/secrets/:secretId
 * Delete secret (owner only)
 */
router.delete("/:id/secrets/:secretId", authenticate, async (req, res) => {
  try {
    const project = await (prisma as any).project.findUnique({
      where: { id: req.params.id },
    });

    if (!project) return res.status(404).json({ error: "Not found" });
    if (project.ownerId !== req.user!.id)
      return res.status(403).json({ error: "Owner only" });

    const secret = await (prisma as any).projectSecret.findUnique({
      where: { id: req.params.secretId },
    });

    if (!secret) return res.status(404).json({ error: "Secret not found" });
    if (secret.projectId !== req.params.id)
      return res.status(403).json({ error: "Not in this project" });

    await (prisma as any).projectSecret.delete({
      where: { id: req.params.secretId },
    });

    logger.info(`Secret deleted: ${req.params.secretId}`);
    res.json({ success: true });
  } catch (error) {
    logger.error("Error deleting secret:", error);
    res.status(500).json({ error: "Failed to delete secret" });
  }
});

/**
 * PUT /api/projects/:id/secrets/:secretId/permissions
 * Update secret permissions (owner only)
 */
router.put(
  "/:id/secrets/:secretId/permissions",
  authenticate,
  async (req, res) => {
    try {
      const { permissions } = req.body;
      const project = await (prisma as any).project.findUnique({
        where: { id: req.params.id },
      });

      if (!project) return res.status(404).json({ error: "Not found" });
      if (project.ownerId !== req.user!.id)
        return res.status(403).json({ error: "Owner only" });

      const secret = await (prisma as any).projectSecret.findUnique({
        where: { id: req.params.secretId },
      });

      if (!secret) return res.status(404).json({ error: "Secret not found" });

      const updated = await (prisma as any).projectSecret.update({
        where: { id: req.params.secretId },
        data: { permissions: permissions || {} },
      });

      const { encryptedValue: _, ...safeSecret } = updated;
      logger.info(`Secret permissions updated: ${req.params.secretId}`);
      res.json(safeSecret);
    } catch (error) {
      logger.error("Error updating permissions:", error);
      res.status(500).json({ error: "Failed to update permissions" });
    }
  },
);

export const projectRoutes = router;
