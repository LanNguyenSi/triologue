import { Router } from "express";
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import multer from "multer";
import crypto from "crypto";
import { authenticate } from "../../middleware/auth";
import { PluginEventPayloads, TriologuePlugin } from "../types";
import prisma from "../../lib/prisma";
import { requirePluginCapabilities, requireProjectPluginLink } from "../security";
import {
  completeModuleRun,
  createModuleRun,
  createOrReuseSyncedTask,
  ensureModuleInstance,
  failModuleRun,
  postModuleRunCard,
} from "../moduleRuntimeService";

const router = Router();
const PLUGIN_ID = "sales-workbench";
const SCREENING_MODULE_KEY = "bid-screening";
const UPLOAD_DIR = path.resolve(__dirname, "../../../uploads");
const SUPPORTED_TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);
const MAX_PARSED_ATTACHMENTS = 10;
const MAX_ATTACHMENT_READ_BYTES = 120_000;
const MAX_EVIDENCE_ITEMS = 6;
const MAX_ATTACHMENT_SIZE = 12 * 1024 * 1024;
const SYSTEM_SENDER_ID = "gateway-system";
const ALLOWED_ATTACHMENT_MIME_TYPES: Record<string, "IMAGE" | "DOCUMENT"> = {
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

if (!fsSync.existsSync(UPLOAD_DIR)) {
  fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const attachmentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const attachmentUpload = multer({
  storage: attachmentStorage,
  limits: { fileSize: MAX_ATTACHMENT_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_ATTACHMENT_MIME_TYPES[file.mimetype]) {
      cb(null, true);
      return;
    }
    cb(new Error(`File type ${file.mimetype} is not allowed`));
  },
});

interface ScreeningEvidenceItem {
  source: string;
  excerpt: string;
  deadlineHits: number;
  mustHits: number;
  riskHits: number;
}

interface ScreeningDataset {
  totalTasks: number;
  totalProjectAttachments: number;
  totalTaskAttachments: number;
  totalAttachments: number;
  parsedAttachments: number;
  unsupportedAttachments: number;
  missingFiles: number;
  deadlineCandidates: string[];
  mustRequirementHits: number;
  riskSignalHits: number;
  roomMessageSignals: number;
  evidence: ScreeningEvidenceItem[];
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeChecklist(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, 12);
}

function compactText(input: string, maxLength: number): string {
  return input.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function countKeywordHits(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => {
    const matches = text.match(pattern);
    return sum + (matches ? matches.length : 0);
  }, 0);
}

function extractDeadlines(text: string): string[] {
  const candidates = [
    ...(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []),
    ...(text.match(/\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g) || []),
  ];

  const unique: string[] = [];
  for (const candidate of candidates) {
    if (!unique.includes(candidate)) unique.push(candidate);
    if (unique.length >= 10) break;
  }
  return unique;
}

function resolveUploadPath(url: string): string | null {
  if (!url?.startsWith("/uploads/")) return null;
  const filename = path.basename(url.replace("/uploads/", ""));
  if (!filename) return null;
  return path.join(UPLOAD_DIR, filename);
}

async function readAttachmentText(
  attachment: { url: string; mimeType?: string | null },
): Promise<{ text: string | null; unsupported: boolean; missing: boolean }> {
  const mimeType = String(attachment.mimeType || "").toLowerCase();
  if (!SUPPORTED_TEXT_MIME_TYPES.has(mimeType)) {
    return { text: null, unsupported: true, missing: false };
  }

  const filePath = resolveUploadPath(attachment.url);
  if (!filePath) {
    return { text: null, unsupported: false, missing: true };
  }

  try {
    const fileHandle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(MAX_ATTACHMENT_READ_BYTES);
      const { bytesRead } = await fileHandle.read(
        buffer,
        0,
        MAX_ATTACHMENT_READ_BYTES,
        0,
      );
      if (bytesRead <= 0) return { text: null, unsupported: false, missing: false };
      return {
        text: buffer.toString("utf8", 0, bytesRead),
        unsupported: false,
        missing: false,
      };
    } finally {
      await fileHandle.close();
    }
  } catch {
    return { text: null, unsupported: false, missing: true };
  }
}

function removeUploadedFile(filePath: string) {
  try {
    fsSync.unlinkSync(filePath);
  } catch {
    // Best effort cleanup.
  }
}

async function ensureProjectPluginLinked(projectId: string) {
  const link = await (prisma as any).projectPluginLink.findUnique({
    where: {
      projectId_pluginId: {
        projectId,
        pluginId: PLUGIN_ID,
      },
    },
    select: { id: true },
  });

  if (!link) {
    const error = new Error("Plugin is not linked to this project");
    (error as any).statusCode = 409;
    throw error;
  }
}

async function resolveSystemSenderId(fallbackUserId: string): Promise<string> {
  const systemUser = await prisma.user.findUnique({
    where: { id: SYSTEM_SENDER_ID },
    select: { id: true },
  });
  return systemUser?.id || fallbackUserId;
}

async function postScreeningHandoffMessage(params: {
  io: any;
  roomId: string;
  projectId: string;
  releasedBy: string;
  openTaskCount: number;
  suggestedPrompt: string;
  note?: string;
}) {
  const senderId = await resolveSystemSenderId(params.releasedBy);
  const noteText = params.note ? `\n\nHinweis: ${params.note}` : "";
  const content = `📌 Screening-Handoff bereit. ${params.openTaskCount} Aufgaben warten auf Bearbeitung.${noteText}\n\n${params.suggestedPrompt}`;

  const message = await prisma.message.create({
    data: {
      content,
      roomId: params.roomId,
      senderId,
      messageType: "SYSTEM",
      aiContext: {
        version: 1,
        type: "module.handoff.release",
        pluginId: PLUGIN_ID,
        moduleKey: SCREENING_MODULE_KEY,
        projectId: params.projectId,
        releasedBy: params.releasedBy,
        openTaskCount: params.openTaskCount,
        suggestedPrompt: params.suggestedPrompt,
        note: params.note || null,
        timestamp: new Date().toISOString(),
      },
    },
    include: {
      sender: {
        select: {
          id: true,
          username: true,
          displayName: true,
          userType: true,
          avatar: true,
        },
      },
      reactions: true,
      attachments: true,
    },
  });

  if (params.io) {
    params.io.to(params.roomId).emit("message:new", message);
  }

  return message;
}

function extractSignals(text: string) {
  const normalized = text.toLowerCase();
  const deadlineHits = countKeywordHits(normalized, [
    /\bdeadline\b/g,
    /\bfrist\b/g,
    /\bdue date\b/g,
    /\beinreichung\b/g,
    /\babgabe\b/g,
  ]);
  const mustHits = countKeywordHits(normalized, [
    /\bmust\b/g,
    /\bshall\b/g,
    /\bmuss\b/g,
    /\bzwingend\b/g,
    /\bmandatory\b/g,
    /\bpflicht\b/g,
  ]);
  const riskHits = countKeywordHits(normalized, [
    /\brisk\b/g,
    /\brisiko\b/g,
    /\bpenalt(y|ies)\b/g,
    /\bausschluss\b/g,
    /\bliability\b/g,
    /\bhaftung\b/g,
  ]);
  const deadlines = extractDeadlines(text);
  return { deadlineHits, mustHits, riskHits, deadlines };
}

function deriveFindings(dataset: ScreeningDataset): string[] {
  const findings: string[] = [];

  if (dataset.totalAttachments === 0) {
    findings.push("Keine Projekt-/Task-Anhänge vorhanden; evidenzbasierte Bewertung ist eingeschränkt.");
  }
  if (dataset.unsupportedAttachments > 0) {
    findings.push(
      `${dataset.unsupportedAttachments} Anhänge konnten nicht automatisch gelesen werden (z. B. PDF/Bild).`,
    );
  }
  if (dataset.deadlineCandidates.length === 0) {
    findings.push("Keine belastbaren Datumsangaben erkannt; Fristencheck manuell nachschärfen.");
  }
  if (dataset.mustRequirementHits === 0) {
    findings.push("Keine klaren Muss-/Pflicht-Signale gefunden; Anforderungen verifizieren.");
  }
  if (dataset.riskSignalHits > 0) {
    findings.push(`${dataset.riskSignalHits} Risiko-/Ausschluss-Signale erkannt; priorisierte Review empfohlen.`);
  }
  if (dataset.roomMessageSignals > 0) {
    findings.push(`Raumkommunikation enthält ${dataset.roomMessageSignals} Frist-/Risikohinweise.`);
  }

  return findings.slice(0, 6);
}

async function buildScreeningDataset(
  projectId: string,
  roomId: string,
): Promise<ScreeningDataset> {
  const projectAttachments = await (prisma as any).projectAttachment.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: {
      id: true,
      filename: true,
      mimeType: true,
      url: true,
    },
  });

  const taskRows = await (prisma as any).task.findMany({
    where: { projectId },
    orderBy: [{ updatedAt: "desc" }],
    take: 80,
    select: {
      id: true,
      title: true,
      description: true,
      attachments: {
        select: {
          id: true,
          filename: true,
          mimeType: true,
          url: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const evidence: ScreeningEvidenceItem[] = [];
  const deadlineCandidates = new Set<string>();
  let parsedAttachments = 0;
  let unsupportedAttachments = 0;
  let missingFiles = 0;
  let mustRequirementHits = 0;
  let riskSignalHits = 0;

  const taskAttachmentItems = taskRows.flatMap((task: any) =>
    (task.attachments || []).map((attachment: any) => ({
      sourceLabel: `task:${task.id}:${attachment.filename || attachment.id}`,
      attachment,
    })),
  );
  const projectAttachmentItems = projectAttachments.map((attachment: any) => ({
    sourceLabel: `project:${attachment.filename || attachment.id}`,
    attachment,
  }));
  const attachments = [...projectAttachmentItems, ...taskAttachmentItems];

  for (const item of attachments.slice(0, MAX_PARSED_ATTACHMENTS)) {
    const attachment = item.attachment;
    const readResult = await readAttachmentText(attachment);
    if (readResult.unsupported) {
      unsupportedAttachments += 1;
      continue;
    }
    if (readResult.missing) {
      missingFiles += 1;
      continue;
    }
    if (!readResult.text) continue;

    parsedAttachments += 1;
    const signals = extractSignals(readResult.text);
    mustRequirementHits += signals.mustHits;
    riskSignalHits += signals.riskHits;
    for (const date of signals.deadlines) deadlineCandidates.add(date);

    if (evidence.length < MAX_EVIDENCE_ITEMS) {
      evidence.push({
        source: item.sourceLabel,
        excerpt: compactText(readResult.text, 220),
        deadlineHits: signals.deadlineHits,
        mustHits: signals.mustHits,
        riskHits: signals.riskHits,
      });
    }
  }

  for (const task of taskRows.slice(0, 20)) {
    const description = String(task.description || "").trim();
    if (!description) continue;
    const signals = extractSignals(description);
    mustRequirementHits += signals.mustHits;
    riskSignalHits += signals.riskHits;
    for (const date of signals.deadlines) deadlineCandidates.add(date);

    if (evidence.length < MAX_EVIDENCE_ITEMS) {
      evidence.push({
        source: `task:${task.id}`,
        excerpt: compactText(`${task.title}: ${description}`, 220),
        deadlineHits: signals.deadlineHits,
        mustHits: signals.mustHits,
        riskHits: signals.riskHits,
      });
    }
  }

  const recentMessages = await prisma.message.findMany({
    where: { roomId, isDeleted: false },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { content: true, messageType: true },
  });

  let roomMessageSignals = 0;
  for (const message of recentMessages) {
    if (message.messageType === "SYSTEM") continue;
    const content = String(message.content || "").trim();
    if (!content) continue;
    const signals = extractSignals(content);
    roomMessageSignals += signals.deadlineHits + signals.riskHits;
    for (const date of signals.deadlines) deadlineCandidates.add(date);
  }

  return {
    totalTasks: taskRows.length,
    totalProjectAttachments: projectAttachments.length,
    totalTaskAttachments: taskAttachmentItems.length,
    totalAttachments: attachments.length,
    parsedAttachments,
    unsupportedAttachments,
    missingFiles,
    deadlineCandidates: Array.from(deadlineCandidates).slice(0, 10),
    mustRequirementHits,
    riskSignalHits,
    roomMessageSignals,
    evidence,
  };
}

async function resolveRunContext(
  userId: string,
  projectId: string,
) {
  const project = await (prisma as any).project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      status: true,
      ownerId: true,
      teamMemberIds: true,
      roomId: true,
    },
  });

  if (!project) {
    const error = new Error("Project not found");
    (error as any).statusCode = 404;
    throw error;
  }

  if (!project.roomId) {
    const error = new Error("Project is not linked to a room");
    (error as any).statusCode = 409;
    throw error;
  }
  const roomId = project.roomId;

  const roomMembership = await prisma.roomParticipant.findUnique({
    where: { userId_roomId: { userId, roomId } },
    select: { userId: true },
  });

  if (!roomMembership) {
    const error = new Error("You are not a member of the linked project room");
    (error as any).statusCode = 403;
    throw error;
  }

  const hasProjectAccess =
    project.ownerId === userId || (project.teamMemberIds || []).includes(userId);
  if (!hasProjectAccess) {
    const error = new Error("No project access");
    (error as any).statusCode = 403;
    throw error;
  }

  if (project.status !== "active") {
    const error = new Error(
      `Project status "${project.status}" does not allow screening runs`,
    );
    (error as any).statusCode = 409;
    throw error;
  }

  return { project, roomId };
}

router.get("/health", authenticate, (_req, res) => {
  res.json({
    plugin: PLUGIN_ID,
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

router.get(
  "/templates",
  authenticate,
  requirePluginCapabilities(PLUGIN_ID, ["templates.read"]),
  (_req, res) => {
    res.json({
      items: [
        {
          id: "followup-meeting-summary",
          name: "Follow-up Meeting Summary",
          type: "followup",
        },
        {
          id: "bid-briefing-screening",
          name: "Bid Screening Briefing",
          type: "screening",
        },
        {
          id: "offer-review-checklist",
          name: "Offer Review Checklist",
          type: "review",
        },
      ],
    });
  },
);

router.get(
  "/project-attachments",
  authenticate,
  requirePluginCapabilities(PLUGIN_ID, ["projects.read"]),
  requireProjectPluginLink(PLUGIN_ID, "query"),
  async (req, res) => {
    try {
      const projectId = String(req.query.projectId || "").trim();
      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      await resolveRunContext(req.user!.id, projectId);

      const attachments = await (prisma as any).projectAttachment.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      return res.json({ attachments });
    } catch (error: any) {
      return res
        .status(error?.statusCode || 500)
        .json({ error: error?.message || "Failed to load project attachments" });
    }
  },
);

router.post(
  "/project-attachments",
  authenticate,
  requirePluginCapabilities(PLUGIN_ID, ["projects.write", "messages.write"]),
  requireProjectPluginLink(PLUGIN_ID, "query"),
  (req, res) => {
    attachmentUpload.single("file")(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large (max 12 MB)" });
        }
        return res.status(400).json({ error: err.message });
      }
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      const projectId = String(req.query.projectId || "").trim();
      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file provided" });
      }

      try {
        await ensureProjectPluginLinked(projectId);
        const { project } = await resolveRunContext(req.user!.id, projectId);

        const attachmentType =
          ALLOWED_ATTACHMENT_MIME_TYPES[file.mimetype] || "DOCUMENT";
        const fileUrl = `/uploads/${file.filename}`;

        const attachment = await (prisma as any).projectAttachment.create({
          data: {
            projectId,
            filename: file.originalname,
            url: fileUrl,
            mimeType: file.mimetype,
            size: file.size,
            type: attachmentType,
            uploadedBy: req.user!.id,
            sourcePluginId: PLUGIN_ID,
          },
        });

        return res.status(201).json({
          projectId,
          roomId: project.roomId,
          attachment,
        });
      } catch (error: any) {
        removeUploadedFile(file.path);
        return res
          .status(error?.statusCode || 500)
          .json({ error: error?.message || "Failed to upload project attachment" });
      }
    });
  },
);

router.delete(
  "/project-attachments/:attachmentId",
  authenticate,
  requirePluginCapabilities(PLUGIN_ID, ["projects.write"]),
  requireProjectPluginLink(PLUGIN_ID, "query"),
  async (req, res) => {
    try {
      const projectId = String(req.query.projectId || "").trim();
      const attachmentId = String(req.params.attachmentId || "").trim();
      if (!projectId || !attachmentId) {
        return res.status(400).json({ error: "projectId and attachmentId are required" });
      }

      const { project } = await resolveRunContext(req.user!.id, projectId);
      const attachment = await (prisma as any).projectAttachment.findUnique({
        where: { id: attachmentId },
      });

      if (!attachment || attachment.projectId !== projectId) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      const canDelete =
        project.ownerId === req.user!.id ||
        attachment.uploadedBy === req.user!.id ||
        Boolean(req.user?.isAdmin);

      if (!canDelete) {
        return res.status(403).json({ error: "No permission to delete this attachment" });
      }

      await (prisma as any).projectAttachment.delete({
        where: { id: attachmentId },
      });

      const filePath = resolveUploadPath(attachment.url);
      if (filePath) removeUploadedFile(filePath);

      return res.json({ success: true, attachmentId });
    } catch (error: any) {
      return res
        .status(error?.statusCode || 500)
        .json({ error: error?.message || "Failed to delete project attachment" });
    }
  },
);

router.post(
  "/handoff",
  authenticate,
  requirePluginCapabilities(PLUGIN_ID, ["projects.read", "messages.write"]),
  requireProjectPluginLink(PLUGIN_ID, "body"),
  async (req, res) => {
    try {
      const projectId = String(req.body?.projectId || "").trim();
      const note = String(req.body?.note || "").trim();
      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      const { roomId } = await resolveRunContext(req.user!.id, projectId);
      const io = req.app.get("io");

      const taskSyncRows = await (prisma as any).pluginTaskSync.findMany({
        where: {
          projectId,
          syncKey: {
            startsWith: `${PLUGIN_ID}:${SCREENING_MODULE_KEY}:`,
          },
        },
        include: {
          task: {
            select: { id: true, status: true, title: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      const openTasks = taskSyncRows.filter(
        (entry: any) => entry.task && entry.task.status !== "done",
      );
      const openTaskCount = openTasks.length;
      const suggestedPrompt =
        "Freigabe: Bitte bearbeitet jetzt die erstellten Screening-Aufgaben priorisiert, dokumentiert Quellenbezug pro Aufgabe und meldet Blocker sofort.";

      const message = await postScreeningHandoffMessage({
        io,
        roomId,
        projectId,
        releasedBy: req.user!.id,
        openTaskCount,
        suggestedPrompt,
        note: note || undefined,
      });

      return res.status(201).json({
        projectId,
        roomId,
        openTaskCount,
        suggestedPrompt,
        message,
      });
    } catch (error: any) {
      return res
        .status(error?.statusCode || 500)
        .json({ error: error?.message || "Failed to create handoff message" });
    }
  },
);

router.get(
  "/instances",
  authenticate,
  requirePluginCapabilities(PLUGIN_ID, ["modules.read", "projects.read"]),
  requireProjectPluginLink(PLUGIN_ID, "query"),
  async (req, res) => {
    try {
      const projectId = String(req.query.projectId || "").trim();
      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      const { roomId } = await resolveRunContext(req.user!.id, projectId);

      const instance = await (prisma as any).pluginModuleInstance.findUnique({
        where: {
          pluginId_moduleKey_projectId_roomId: {
            pluginId: PLUGIN_ID,
            moduleKey: SCREENING_MODULE_KEY,
            projectId,
            roomId,
          },
        },
      });

      if (!instance) {
        return res.json({ moduleInstance: null, runs: [] });
      }

      const runs = await (prisma as any).pluginModuleRun.findMany({
        where: { moduleInstanceId: instance.id },
        orderBy: { startedAt: "desc" },
        take: 12,
      });

      return res.json({ moduleInstance: instance, runs });
    } catch (error: any) {
      return res
        .status(error?.statusCode || 500)
        .json({ error: error?.message || "Failed to load module instance" });
    }
  },
);

router.post(
  "/runs/screening",
  authenticate,
  requirePluginCapabilities(PLUGIN_ID, [
    "projects.read",
    "projects.write",
    "tasks.write",
    "messages.write",
    "modules.write",
  ]),
  requireProjectPluginLink(PLUGIN_ID, "body"),
  async (req, res) => {
    const projectId = String(req.body?.projectId || "").trim();
    const runTitle = String(req.body?.title || "Bid screening run").trim();
    const checklist = normalizeChecklist(req.body?.checklist);
    const successCriteria = String(req.body?.successCriteria || "").trim();

    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const io = req.app.get("io");
    const services = { prisma: prisma as any, io };
    let run: any = null;
    let moduleInstance: any = null;
    let contextRoomId = "";

    try {
      const { project, roomId } = await resolveRunContext(req.user!.id, projectId);
      contextRoomId = roomId;
      const screeningDataset = await buildScreeningDataset(projectId, roomId);
      const findings = deriveFindings(screeningDataset);
      if (screeningDataset.totalProjectAttachments === 0) {
        const error = new Error(
          "Bitte zuerst mindestens eine Ausschreibungsdatei im Screening hochladen.",
        );
        (error as any).statusCode = 409;
        throw error;
      }

      moduleInstance = await ensureModuleInstance(services, {
        pluginId: PLUGIN_ID,
        moduleKey: SCREENING_MODULE_KEY,
        projectId,
        roomId,
        startedBy: req.user!.id,
        moduleConfig: {
          template: "bid-briefing-screening",
          version: 1,
        },
      });

      run = await createModuleRun(services, moduleInstance.id, {
        pluginId: PLUGIN_ID,
        moduleKey: SCREENING_MODULE_KEY,
        projectId,
        roomId,
        startedBy: req.user!.id,
        runInput: {
          title: runTitle,
          checklist,
          successCriteria,
          requestedAt: new Date().toISOString(),
        },
      });

      await postModuleRunCard(services, {
        roomId,
        startedBy: req.user!.id,
        pluginId: PLUGIN_ID,
        moduleKey: SCREENING_MODULE_KEY,
        runId: run.id,
        moduleInstanceId: moduleInstance.id,
        status: "started",
        summary: `Screening gestartet: ${runTitle}`,
      });

      const taskDefinitions = [
        {
          syncKey: `${PLUGIN_ID}:${SCREENING_MODULE_KEY}:summary`,
          title: `Ausschreibungsscreening: Summary (${project.name})`,
          description: `Fasse Ziele, Scope, zwingende Anforderungen und erste Risiken kompakt zusammen. Datengrundlage: ${screeningDataset.totalProjectAttachments} Projekt-Anhänge, ${screeningDataset.totalTasks} bestehende Tasks.`,
          priority: "medium",
        },
        {
          syncKey: `${PLUGIN_ID}:${SCREENING_MODULE_KEY}:deadline-check`,
          title: `Ausschreibungsscreening: Fristencheck (${project.name})`,
          description: `Prüfe Einreichungsfristen, Rückfragenfenster, Abhängigkeiten und notwendige Vorlaufzeiten.${screeningDataset.deadlineCandidates.length > 0 ? ` Erkannt: ${screeningDataset.deadlineCandidates.slice(0, 5).join(", ")}` : ""}`,
          priority: "high",
        },
        {
          syncKey: `${PLUGIN_ID}:${SCREENING_MODULE_KEY}:go-no-go`,
          title: `Ausschreibungsscreening: Go/No-Go Entwurf (${project.name})`,
          description: `Erstelle Entscheidungsentwurf mit Chancen, Risiken, Aufwand und Empfehlung. Risiko-Signale: ${screeningDataset.riskSignalHits}.`,
          priority: "high",
        },
      ];

      if (screeningDataset.unsupportedAttachments > 0) {
        taskDefinitions.push({
          syncKey: `${PLUGIN_ID}:${SCREENING_MODULE_KEY}:unsupported-review`,
          title: `Ausschreibungsscreening: Nicht auswertbare Anhänge (${project.name})`,
          description: `${screeningDataset.unsupportedAttachments} Anhänge (z. B. PDF/Bild) wurden erkannt und müssen manuell gegen die Muss-/Ausschlusskriterien geprüft werden.`,
          priority: "high",
        });
      }

      if (screeningDataset.mustRequirementHits > 0) {
        taskDefinitions.push({
          syncKey: `${PLUGIN_ID}:${SCREENING_MODULE_KEY}:requirement-matrix`,
          title: `Ausschreibungsscreening: Muss-Anforderungsmatrix (${project.name})`,
          description: `Leite aus den Unterlagen eine Muss-/Kann-Matrix ab und bewerte Erfüllungsgrad. Erkannte Muss-Signale: ${screeningDataset.mustRequirementHits}.`,
          priority: "high",
        });
      }

      for (const criterion of checklist.slice(0, 6)) {
        taskDefinitions.push({
          syncKey: `${PLUGIN_ID}:${SCREENING_MODULE_KEY}:criterion:${toSlug(criterion)}`,
          title: `Screening-Kriterium: ${criterion}`,
          description:
            "Bewerte dieses Kriterium mit Quellenbezug (Anhänge/Anforderungstext) und Ampelstatus.",
          priority: "medium",
        });
      }

      const syncedTasks = [];
      for (const item of taskDefinitions) {
        const result = await createOrReuseSyncedTask(services, {
          projectId,
          roomId,
          moduleRunId: run.id,
          syncKey: item.syncKey,
          title: item.title,
          description: item.description,
          assignedTo: req.user!.id,
          priority: item.priority || "medium",
          status: "todo",
        });
        syncedTasks.push({ taskId: result.task.id, title: result.task.title, reused: result.reused });
      }

      const createdCount = syncedTasks.filter((entry) => !entry.reused).length;
      const reusedCount = syncedTasks.length - createdCount;
      const summary = `Screening abgeschlossen: ${createdCount} neue Tasks, ${reusedCount} wiederverwendet, ${screeningDataset.parsedAttachments}/${screeningDataset.totalAttachments} Anhänge ausgewertet.`;

      const output = {
        runTitle,
        projectName: project.name,
        taskCount: syncedTasks.length,
        createdCount,
        reusedCount,
        syncedTasks,
        screeningSignals: {
          totalTasks: screeningDataset.totalTasks,
          totalProjectAttachments: screeningDataset.totalProjectAttachments,
          totalTaskAttachments: screeningDataset.totalTaskAttachments,
          totalAttachments: screeningDataset.totalAttachments,
          parsedAttachments: screeningDataset.parsedAttachments,
          unsupportedAttachments: screeningDataset.unsupportedAttachments,
          missingFiles: screeningDataset.missingFiles,
          mustRequirementHits: screeningDataset.mustRequirementHits,
          riskSignalHits: screeningDataset.riskSignalHits,
          roomMessageSignals: screeningDataset.roomMessageSignals,
          deadlineCandidates: screeningDataset.deadlineCandidates,
        },
        findings,
        evidence: screeningDataset.evidence,
      };

      await completeModuleRun(services, run, output, summary);

      await postModuleRunCard(services, {
        roomId,
        startedBy: req.user!.id,
        pluginId: PLUGIN_ID,
        moduleKey: SCREENING_MODULE_KEY,
        runId: run.id,
        moduleInstanceId: moduleInstance.id,
        status: "completed",
        summary,
        details: output,
      });

      return res.status(201).json({
        moduleInstanceId: moduleInstance.id,
        runId: run.id,
        roomId,
        status: "completed",
        output,
      });
    } catch (error: any) {
      const roomId = run?.roomId || contextRoomId;
      if (run && moduleInstance && roomId) {
        await failModuleRun(services, run, error);
        await postModuleRunCard(services, {
          roomId,
          startedBy: req.user!.id,
          pluginId: PLUGIN_ID,
          moduleKey: SCREENING_MODULE_KEY,
          runId: run.id,
          moduleInstanceId: moduleInstance.id,
          status: "failed",
          summary: error?.message || "Screening fehlgeschlagen",
          details: { error: error?.message || "Unknown error" },
        });
      }
      return res
        .status(error?.statusCode || 500)
        .json({ error: error?.message || "Screening run failed" });
    }
  },
);

router.get(
  "/runs",
  authenticate,
  requirePluginCapabilities(PLUGIN_ID, ["modules.read", "projects.read"]),
  requireProjectPluginLink(PLUGIN_ID, "query"),
  async (req, res) => {
    try {
      const projectId = String(req.query.projectId || "").trim();
      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      const { roomId } = await resolveRunContext(req.user!.id, projectId);

      const runs = await (prisma as any).pluginModuleRun.findMany({
        where: {
          pluginId: PLUGIN_ID,
          moduleKey: SCREENING_MODULE_KEY,
          projectId,
          roomId,
        },
        orderBy: { startedAt: "desc" },
        take: 30,
      });

      return res.json({ runs });
    } catch (error: any) {
      return res
        .status(error?.statusCode || 500)
        .json({ error: error?.message || "Failed to load runs" });
    }
  },
);

export const salesWorkbenchPlugin: TriologuePlugin = {
  manifest: {
    id: PLUGIN_ID,
    name: "Sales Workbench",
    version: "0.2.0",
    description:
      "Ausschreibungs-Screening mit room-nativer Orchestrierung, Modul-Run-Karten und task-basiertem Follow-up.",
    enabledByDefault: true,
    capabilities: [
      "messages.read",
      "messages.write",
      "projects.read",
      "projects.write",
      "tasks.write",
      "templates.read",
      "modules.read",
      "modules.write",
    ],
    ui: {
      navItems: [
        {
          to: "/plugins/sales-workbench",
          label: "Sales Workbench",
          icon: "🧩",
          match: "prefix",
        },
      ],
    },
  },
  registerRoutes: () => [
    {
      basePath: "/api/plugin-modules/sales-workbench",
      router,
    },
  ],
  onEvent: async (event, payload, ctx) => {
    if (event === "message.created") {
      const messagePayload = payload as PluginEventPayloads["message.created"];
      ctx.logger.info(
        `[sales-workbench] observed message ${messagePayload.messageId} from ${messagePayload.source} in room ${messagePayload.roomId}`,
      );
      return;
    }

    if (event === "module.run.completed") {
      const completedPayload =
        payload as PluginEventPayloads["module.run.completed"];
      if (
        completedPayload.pluginId === PLUGIN_ID &&
        completedPayload.moduleKey === SCREENING_MODULE_KEY
      ) {
        ctx.logger.info(
          `[sales-workbench] run completed ${completedPayload.runId} (${completedPayload.summary || "no summary"})`,
        );
      }
    }
  },
};
