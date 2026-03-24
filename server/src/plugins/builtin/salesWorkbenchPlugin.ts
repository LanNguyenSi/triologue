import { Router } from "express";
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import multer from "multer";
import crypto from "crypto";
import { authenticate } from "../../middleware/auth";
import { PluginEventPayloads, TriologuePlugin } from "../types";
import prisma from "../../lib/prisma";
import { requirePluginCapabilities } from "../security";
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
const MEMORY_ENTRY_LIMIT = 24;
const MEMORY_TYPE_GO_NO_GO = "sales.go-no-go.decision";
const MEMORY_TYPE_RISK_SUMMARY = "sales.risk.summary";
const MEMORY_TYPE_RESOURCE_SUMMARY = "sales.resource.summary";
const MEMORY_TYPE_SCREENING_CONTEXT = "sales.screening.context";
const MEMORY_TYPE_MANUAL_NOTE = "sales.manual.note";
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
  resourceHits: number;
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
  resourceSignalHits: number;
  roomMessageSignals: number;
  evidence: ScreeningEvidenceItem[];
}

interface AgentMemorySnapshotItem {
  id: string;
  memoryType: string;
  payload: Record<string, any>;
  confidence: number;
  sourceRunId?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  freshnessStatus?: "fresh" | "stale" | "unknown";
}

type GoNoGoRecommendation = "go" | "conditional-go" | "no-go";

interface GoNoGoDecision {
  recommendation: GoNoGoRecommendation;
  score: number;
  confidence: number;
  reasons: string[];
  blockers: string[];
  missingEvidence: string[];
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

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const item of value) {
    const tag = typeof item === "string" ? item.trim().toLowerCase() : "";
    if (!tag) continue;
    if (tags.includes(tag)) continue;
    tags.push(tag.slice(0, 48));
    if (tags.length >= 8) break;
  }
  return tags;
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeConfidence(value: unknown, fallback = 0.5): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return clampNumber(value, 0, 1);
}

function daysFromNow(days: number): Date {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value;
}

function hasResourceKeyword(text: string): boolean {
  return /\b(resource|resources|ressource|ressourcen|capacity|kapazit(ae|ä)t|team|staff|fte|verf(ue|ü)gbarkeit)\b/i.test(
    text,
  );
}

function summarizeMemoryPayload(
  memoryType: string,
  payload: Record<string, any>,
): string {
  if (memoryType === MEMORY_TYPE_GO_NO_GO) {
    const recommendation = String(payload?.recommendation || "unknown");
    const score = Number(payload?.score || 0);
    return `Go/No-Go: ${recommendation} (score ${score})`;
  }
  if (memoryType === MEMORY_TYPE_RESOURCE_SUMMARY) {
    const status = String(payload?.status || "unknown");
    const hits = Number(payload?.resourceSignalHits || 0);
    return `Ressourcenlage: ${status} (${hits} Signale)`;
  }
  if (memoryType === MEMORY_TYPE_RISK_SUMMARY) {
    const hits = Number(payload?.riskSignalHits || 0);
    const unsupported = Number(payload?.unsupportedAttachments || 0);
    return `Risiko-Signale: ${hits}, nicht lesbare Anhänge: ${unsupported}`;
  }
  if (memoryType === MEMORY_TYPE_MANUAL_NOTE) {
    const note = String(payload?.note || payload?.summary || "").trim();
    if (note) return note.slice(0, 160);
    return "Manuelle Memory-Notiz";
  }
  const text = String(payload?.successCriteria || payload?.summary || "").trim();
  return text ? text.slice(0, 120) : "Kontext-Snapshot";
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

async function ensureProjectPluginLinkedForRuntime(params: {
  projectId: string;
  ownerId: string;
  userId: string;
  userIsAdmin?: boolean;
}) {
  const existingLink = await (prisma as any).projectPluginLink.findUnique({
    where: {
      projectId_pluginId: {
        projectId: params.projectId,
        pluginId: PLUGIN_ID,
      },
    },
    select: { id: true },
  });

  if (existingLink) {
    return;
  }

  const canManageProject =
    params.ownerId === params.userId || Boolean(params.userIsAdmin);
  if (!canManageProject) {
    const error = new Error(
      "Plugin is not linked to this project. Ask the project owner or an admin to link Sales Workbench in the project settings.",
    );
    (error as any).statusCode = 409;
    throw error;
  }

  await (prisma as any).projectPluginLink.upsert({
    where: {
      projectId_pluginId: {
        projectId: params.projectId,
        pluginId: PLUGIN_ID,
      },
    },
    create: {
      projectId: params.projectId,
      pluginId: PLUGIN_ID,
      linkedBy: params.userId,
    },
    update: {
      linkedBy: params.userId,
    },
  });
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
  const resourceHits = countKeywordHits(normalized, [
    /\bresource(s)?\b/g,
    /\bressource(n)?\b/g,
    /\bcapacity\b/g,
    /\bkapazitaet\b/g,
    /\bkapazität\b/g,
    /\bteam\b/g,
    /\bstaff\b/g,
    /\bfte\b/g,
    /\bverfuegbarkeit\b/g,
    /\bverfügbarkeit\b/g,
  ]);
  const deadlines = extractDeadlines(text);
  return { deadlineHits, mustHits, riskHits, resourceHits, deadlines };
}

function deriveGoNoGoDecision(input: {
  dataset: ScreeningDataset;
  checklist: string[];
  successCriteria: string;
  projectContext: any;
  memorySnapshot: AgentMemorySnapshotItem[];
}): GoNoGoDecision {
  const { dataset, checklist, successCriteria, projectContext, memorySnapshot } = input;
  const blockers: string[] = [];
  const reasons: string[] = [];
  const missingEvidence: string[] = [];
  let score = 70;

  const parsedRatio =
    dataset.totalAttachments > 0
      ? dataset.parsedAttachments / dataset.totalAttachments
      : 0;
  score -= Math.min(24, dataset.unsupportedAttachments * 6);
  score -= Math.min(14, dataset.riskSignalHits * 3);
  score -= Math.min(12, dataset.roomMessageSignals);
  score -= Math.min(10, dataset.missingFiles * 4);

  if (dataset.mustRequirementHits === 0) {
    blockers.push("Keine belastbaren Muss-Anforderungen extrahiert.");
    score -= 18;
  } else {
    score += Math.min(10, Math.floor(dataset.mustRequirementHits / 2));
    reasons.push(`${dataset.mustRequirementHits} Muss-Signale erkannt.`);
  }

  if (dataset.deadlineCandidates.length === 0) {
    missingEvidence.push("Keine verlässlichen Fristangaben gefunden.");
    score -= 12;
  } else {
    score += Math.min(8, dataset.deadlineCandidates.length * 2);
    reasons.push(`${dataset.deadlineCandidates.length} Fristsignale erkannt.`);
  }

  const resourceCriteriaCount = checklist.filter(hasResourceKeyword).length;
  const successCriteriaHasResourceHint = hasResourceKeyword(successCriteria);
  if (dataset.resourceSignalHits === 0 && (resourceCriteriaCount > 0 || successCriteriaHasResourceHint)) {
    missingEvidence.push("Ressourcenlage nicht ausreichend belegt.");
    score -= 10;
  } else if (dataset.resourceSignalHits > 0) {
    reasons.push(`${dataset.resourceSignalHits} Ressourcen-Signale erkannt.`);
    score += Math.min(7, dataset.resourceSignalHits);
  }

  const runbookConstraints = String(projectContext?.runbook?.constraints || "").toLowerCase();
  if (
    /\b(no-go|kein angebot|nicht bieten|ausschluss)\b/.test(runbookConstraints)
  ) {
    blockers.push("Projekt-Runbook enthält explizites No-Go/Ausschlusskriterium.");
    score -= 18;
  }

  if (!String(projectContext?.brief?.successCriteria || "").trim()) {
    missingEvidence.push("Projektkontext enthält keine Success Criteria.");
    score -= 4;
  }

  const previousNoGo = memorySnapshot.find(
    (entry) =>
      entry.memoryType === MEMORY_TYPE_GO_NO_GO &&
      String(entry.payload?.recommendation || "") === "no-go" &&
      entry.confidence >= 0.75,
  );
  if (previousNoGo) {
    blockers.push("Vorherige Memory-Entscheidung war No-Go mit hoher Sicherheit.");
    score -= 15;
  }

  const previousResourceIssue = memorySnapshot.find(
    (entry) =>
      entry.memoryType === MEMORY_TYPE_RESOURCE_SUMMARY &&
      String(entry.payload?.status || "") === "insufficient" &&
      entry.confidence >= 0.7,
  );
  if (previousResourceIssue) {
    reasons.push("Historisch offene Ressourcenlücke aus Agent Memory erkannt.");
    score -= 8;
  }

  if (dataset.riskSignalHits >= 10) {
    blockers.push("Hohe Dichte an Risiko-/Ausschlusssignalen.");
  }
  if (dataset.unsupportedAttachments >= 4) {
    missingEvidence.push("Mehrere Anhänge nicht automatisch auswertbar.");
  }

  score = clampNumber(Math.round(score), 0, 100);

  let recommendation: GoNoGoRecommendation = "go";
  if (blockers.length > 0 || score < 45) {
    recommendation = "no-go";
  } else if (score < 68 || missingEvidence.length > 1) {
    recommendation = "conditional-go";
  }

  let confidence = 0.4;
  confidence += parsedRatio * 0.35;
  confidence += dataset.mustRequirementHits > 0 ? 0.1 : 0;
  confidence += dataset.deadlineCandidates.length > 0 ? 0.08 : 0;
  confidence += memorySnapshot.length > 0 ? 0.07 : 0;
  confidence -= missingEvidence.length > 1 ? 0.08 : 0;
  confidence = clampNumber(Number(confidence.toFixed(2)), 0.25, 0.95);

  if (recommendation === "no-go") {
    reasons.push("No-Go empfohlen bis Blocker/Evidenzlücken geschlossen sind.");
  } else if (recommendation === "conditional-go") {
    reasons.push("Conditional-Go mit verpflichtender Nachschärfung offener Punkte.");
  } else {
    reasons.push("Go möglich bei aktueller Evidenzlage.");
  }

  return {
    recommendation,
    score,
    confidence,
    reasons: reasons.slice(0, 6),
    blockers: blockers.slice(0, 5),
    missingEvidence: missingEvidence.slice(0, 5),
  };
}

function deriveFindings(dataset: ScreeningDataset, decision: GoNoGoDecision): string[] {
  const findings: string[] = [
    `Go/No-Go Empfehlung: ${decision.recommendation.toUpperCase()} (Score ${decision.score}, Confidence ${Math.round(
      decision.confidence * 100,
    )}%).`,
  ];

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
  if (dataset.resourceSignalHits === 0) {
    findings.push("Keine belastbaren Ressourcensignale erkannt; Verfügbarkeit/Kapazität verifizieren.");
  }
  if (dataset.roomMessageSignals > 0) {
    findings.push(`Raumkommunikation enthält ${dataset.roomMessageSignals} Frist-/Risikohinweise.`);
  }
  if (decision.blockers.length > 0) {
    findings.push(`Go/No-Go Blocker: ${decision.blockers[0]}`);
  }

  return findings.slice(0, 6);
}

async function loadActiveMemorySnapshot(
  projectId: string,
  limit = MEMORY_ENTRY_LIMIT,
): Promise<AgentMemorySnapshotItem[]> {
  const now = new Date();
  const rows = await (prisma as any).agentMemoryEntry.findMany({
    where: {
      AND: [
        {
          OR: [{ scope: "GLOBAL" }, { scope: "PROJECT", projectId }],
        },
        { archivedAt: null },
      ],
    },
    orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
    take: Math.max(limit * 3, limit),
    select: {
      id: true,
      memoryType: true,
      payload: true,
      confidence: true,
      sourceRunId: true,
      createdAt: true,
      expiresAt: true,
      updatedAt: true,
      isPinned: true,
    },
  });

  const ranked = rows
    .map((row: any) => {
      const expiresAtDate = row.expiresAt ? new Date(row.expiresAt) : null;
      const validUntilPayloadRaw = row.payload?.validUntil;
      const validUntilPayload = validUntilPayloadRaw ? new Date(String(validUntilPayloadRaw)) : null;
      const validUntil =
        expiresAtDate && !Number.isNaN(expiresAtDate.getTime())
          ? expiresAtDate
          : validUntilPayload && !Number.isNaN(validUntilPayload.getTime())
            ? validUntilPayload
            : null;
      const isStale = Boolean(validUntil && validUntil.getTime() <= now.getTime());
      const confidence = normalizeConfidence(row.confidence);
      const updatedAtTs = new Date(row.updatedAt).getTime();
      const hoursSinceUpdate = Math.max(0, (Date.now() - updatedAtTs) / (1000 * 60 * 60));
      const recencyBoost = Math.max(0, 24 - Math.min(24, hoursSinceUpdate)) * 0.4;
      const score =
        (row.isPinned ? 30 : 0) +
        confidence * 100 +
        recencyBoost -
        (isStale ? 40 : 0);

      return {
        row,
        score,
        freshnessStatus: isStale ? "stale" : validUntil ? "fresh" : "unknown",
      };
    })
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, limit);

  return ranked.map(({ row, freshnessStatus }: any) => ({
    id: row.id,
    memoryType: String(row.memoryType || ""),
    payload: row.payload && typeof row.payload === "object" ? row.payload : {},
    confidence: normalizeConfidence(row.confidence),
    sourceRunId: row.sourceRunId || null,
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    freshnessStatus,
  }));
}

async function persistScreeningMemoryEntries(params: {
  projectId: string;
  roomId: string;
  runId: string;
  createdBy: string;
  runTitle: string;
  projectName: string;
  checklist: string[];
  successCriteria: string;
  dataset: ScreeningDataset;
  decision: GoNoGoDecision;
  projectContext: any;
}): Promise<number> {
  const resourceCriteriaCount = params.checklist.filter(hasResourceKeyword).length;
  const resourceStatus =
    params.dataset.resourceSignalHits > 0 ? "covered" : "insufficient";

  const entries: Array<{
    title: string;
    tags: string[];
    memoryType: string;
    confidence: number;
    expiresAt: Date;
    payload: Record<string, any>;
  }> = [
    {
      title: compactText(`Go/No-Go Entscheidung ${params.projectName}`, 160),
      tags: ["screening", "go-no-go", params.decision.recommendation],
      memoryType: MEMORY_TYPE_GO_NO_GO,
      confidence: params.decision.confidence,
      expiresAt: daysFromNow(120),
      payload: {
        recommendation: params.decision.recommendation,
        score: params.decision.score,
        confidence: params.decision.confidence,
        blockers: params.decision.blockers,
        missingEvidence: params.decision.missingEvidence,
        reasons: params.decision.reasons,
        runTitle: params.runTitle,
        projectName: params.projectName,
      },
    },
    {
      title: compactText(`Risiko-Snapshot ${params.projectName}`, 160),
      tags: ["screening", "risk"],
      memoryType: MEMORY_TYPE_RISK_SUMMARY,
      confidence: normalizeConfidence(
        0.55 + Math.min(0.35, params.dataset.riskSignalHits * 0.03),
      ),
      expiresAt: daysFromNow(60),
      payload: {
        riskSignalHits: params.dataset.riskSignalHits,
        unsupportedAttachments: params.dataset.unsupportedAttachments,
        missingFiles: params.dataset.missingFiles,
        roomMessageSignals: params.dataset.roomMessageSignals,
      },
    },
    {
      title: compactText(`Ressourcen-Snapshot ${params.projectName}`, 160),
      tags: ["screening", "resources", resourceStatus],
      memoryType: MEMORY_TYPE_RESOURCE_SUMMARY,
      confidence: normalizeConfidence(resourceStatus === "covered" ? 0.72 : 0.64),
      expiresAt: daysFromNow(60),
      payload: {
        status: resourceStatus,
        resourceSignalHits: params.dataset.resourceSignalHits,
        resourceCriteriaCount,
        successCriteria: params.successCriteria,
      },
    },
    {
      title: compactText(`Screening-Kontext ${params.projectName}`, 160),
      tags: ["screening", "context"],
      memoryType: MEMORY_TYPE_SCREENING_CONTEXT,
      confidence: 0.58,
      expiresAt: daysFromNow(90),
      payload: {
        checklist: params.checklist.slice(0, 12),
        successCriteria: params.successCriteria,
        runbookConstraints: String(
          params.projectContext?.runbook?.constraints || "",
        ).slice(0, 800),
      },
    },
  ];

  let written = 0;
  for (const entry of entries) {
    await (prisma as any).agentMemoryEntry.create({
      data: {
        projectId: params.projectId,
        roomId: params.roomId,
        scope: "PROJECT",
        pluginId: PLUGIN_ID,
        moduleKey: SCREENING_MODULE_KEY,
        title: entry.title,
        tags: entry.tags,
        memoryType: entry.memoryType,
        payload: entry.payload,
        confidence: normalizeConfidence(entry.confidence),
        sourceRunId: params.runId,
        expiresAt: entry.expiresAt,
        createdBy: params.createdBy,
        updatedBy: params.createdBy,
      },
    });
    written += 1;
  }

  return written;
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
  let resourceSignalHits = 0;

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
    resourceSignalHits += signals.resourceHits;
    for (const date of signals.deadlines) deadlineCandidates.add(date);

    if (evidence.length < MAX_EVIDENCE_ITEMS) {
      evidence.push({
        source: item.sourceLabel,
        excerpt: compactText(readResult.text, 220),
        deadlineHits: signals.deadlineHits,
        mustHits: signals.mustHits,
        riskHits: signals.riskHits,
        resourceHits: signals.resourceHits,
      });
    }
  }

  for (const task of taskRows.slice(0, 20)) {
    const description = String(task.description || "").trim();
    if (!description) continue;
    const signals = extractSignals(description);
    mustRequirementHits += signals.mustHits;
    riskSignalHits += signals.riskHits;
    resourceSignalHits += signals.resourceHits;
    for (const date of signals.deadlines) deadlineCandidates.add(date);

    if (evidence.length < MAX_EVIDENCE_ITEMS) {
      evidence.push({
        source: `task:${task.id}`,
        excerpt: compactText(`${task.title}: ${description}`, 220),
        deadlineHits: signals.deadlineHits,
        mustHits: signals.mustHits,
        riskHits: signals.riskHits,
        resourceHits: signals.resourceHits,
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
    resourceSignalHits,
    roomMessageSignals,
    evidence,
  };
}

async function resolveRunContext(
  userId: string,
  projectId: string,
  userIsAdmin = false,
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
      projectContext: true,
    },
  });

  if (!project) {
    const error = new Error("Project not found");
    (error as any).statusCode = 404;
    throw error;
  }

  await ensureProjectPluginLinkedForRuntime({
    projectId,
    ownerId: project.ownerId,
    userId,
    userIsAdmin,
  });

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
  async (req, res) => {
    try {
      const projectId = String(req.query.projectId || "").trim();
      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      await resolveRunContext(
        req.user!.id,
        projectId,
        Boolean(req.user?.isAdmin),
      );

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
        const { project } = await resolveRunContext(
          req.user!.id,
          projectId,
          Boolean(req.user?.isAdmin),
        );

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
  async (req, res) => {
    try {
      const projectId = String(req.query.projectId || "").trim();
      const attachmentId = String(req.params.attachmentId || "").trim();
      if (!projectId || !attachmentId) {
        return res.status(400).json({ error: "projectId and attachmentId are required" });
      }

      const { project } = await resolveRunContext(
        req.user!.id,
        projectId,
        Boolean(req.user?.isAdmin),
      );
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
  async (req, res) => {
    try {
      const projectId = String(req.body?.projectId || "").trim();
      const note = String(req.body?.note || "").trim();
      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      const { roomId } = await resolveRunContext(
        req.user!.id,
        projectId,
        Boolean(req.user?.isAdmin),
      );
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
  "/memory",
  authenticate,
  requirePluginCapabilities(PLUGIN_ID, ["modules.read", "projects.read"]),
  async (req, res) => {
    try {
      const projectId = String(req.query.projectId || "").trim();
      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      await resolveRunContext(
        req.user!.id,
        projectId,
        Boolean(req.user?.isAdmin),
      );
      const items = await loadActiveMemorySnapshot(projectId, MEMORY_ENTRY_LIMIT);
      const withPreview = items.map((entry) => ({
        ...entry,
        preview: summarizeMemoryPayload(entry.memoryType, entry.payload),
      }));

      return res.json({
        projectId,
        count: withPreview.length,
        items: withPreview,
      });
    } catch (error: any) {
      return res
        .status(error?.statusCode || 500)
        .json({ error: error?.message || "Failed to load memory snapshot" });
    }
  },
);

router.post(
  "/memory",
  authenticate,
  requirePluginCapabilities(PLUGIN_ID, ["projects.read", "modules.write"]),
  async (req, res) => {
    try {
      const projectId = String(req.body?.projectId || "").trim();
      const note = String(req.body?.note || "").trim().slice(0, 2000);
      const titleInput = String(req.body?.title || "").trim();
      const tags = normalizeTags(req.body?.tags);
      const confidence = normalizeConfidence(req.body?.confidence, 0.78);
      const expiresInDaysRaw = Number(req.body?.expiresInDays);

      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }
      if (!note) {
        return res.status(400).json({ error: "note is required" });
      }

      const { roomId } = await resolveRunContext(
        req.user!.id,
        projectId,
        Boolean(req.user?.isAdmin),
      );

      let expiresAt: Date | null = null;
      if (!Number.isNaN(expiresInDaysRaw) && Number.isFinite(expiresInDaysRaw)) {
        if (expiresInDaysRaw > 0) {
          const clampedDays = clampNumber(Math.round(expiresInDaysRaw), 1, 365);
          expiresAt = daysFromNow(clampedDays);
        }
      } else {
        expiresAt = daysFromNow(180);
      }

      const entry = await (prisma as any).agentMemoryEntry.create({
        data: {
          projectId,
          roomId,
          scope: "PROJECT",
          pluginId: PLUGIN_ID,
          moduleKey: SCREENING_MODULE_KEY,
          title: compactText(titleInput || note, 160),
          tags,
          memoryType: MEMORY_TYPE_MANUAL_NOTE,
          payload: {
            note,
            summary: compactText(note, 180),
            tags,
            source: "manual",
          },
          confidence,
          sourceRunId: null,
          expiresAt,
          createdBy: req.user!.id,
          updatedBy: req.user!.id,
        },
        select: {
          id: true,
          memoryType: true,
          payload: true,
          confidence: true,
          sourceRunId: true,
          createdAt: true,
          expiresAt: true,
        },
      });

      const item = {
        id: entry.id,
        memoryType: String(entry.memoryType || ""),
        payload: entry.payload && typeof entry.payload === "object" ? entry.payload : {},
        confidence: normalizeConfidence(entry.confidence),
        sourceRunId: entry.sourceRunId || null,
        createdAt: new Date(entry.createdAt).toISOString(),
        expiresAt: entry.expiresAt ? new Date(entry.expiresAt).toISOString() : null,
        preview: summarizeMemoryPayload(
          String(entry.memoryType || ""),
          entry.payload && typeof entry.payload === "object" ? entry.payload : {},
        ),
      };

      return res.status(201).json({ projectId, item });
    } catch (error: any) {
      return res
        .status(error?.statusCode || 500)
        .json({ error: error?.message || "Failed to write memory note" });
    }
  },
);

router.get(
  "/instances",
  authenticate,
  requirePluginCapabilities(PLUGIN_ID, ["modules.read", "projects.read"]),
  async (req, res) => {
    try {
      const projectId = String(req.query.projectId || "").trim();
      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      const { roomId } = await resolveRunContext(
        req.user!.id,
        projectId,
        Boolean(req.user?.isAdmin),
      );

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
      const { project, roomId } = await resolveRunContext(
        req.user!.id,
        projectId,
        Boolean(req.user?.isAdmin),
      );
      contextRoomId = roomId;
      const screeningDataset = await buildScreeningDataset(projectId, roomId);
      const memorySnapshot = await loadActiveMemorySnapshot(projectId, MEMORY_ENTRY_LIMIT);
      const usedMemoryIds = memorySnapshot.map((entry) => entry.id).slice(0, 80);
      const goNoGoDecision = deriveGoNoGoDecision({
        dataset: screeningDataset,
        checklist,
        successCriteria,
        projectContext: (project as any).projectContext,
        memorySnapshot,
      });
      const findings = deriveFindings(screeningDataset, goNoGoDecision);
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
          usedMemoryIds,
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

      // Build context hints for the Go/No-Go description
      const contextHints: string[] = [];
      contextHints.push(`Datengrundlage: ${screeningDataset.totalProjectAttachments} Projekt-Anhänge, ${screeningDataset.totalTasks} bestehende Tasks.`);
      if (screeningDataset.deadlineCandidates.length > 0) {
        contextHints.push(`Erkannte Fristen: ${screeningDataset.deadlineCandidates.slice(0, 5).join(", ")}.`);
      }
      if (screeningDataset.mustRequirementHits > 0) {
        contextHints.push(`Muss-Anforderungssignale: ${screeningDataset.mustRequirementHits}.`);
      }
      if (screeningDataset.unsupportedAttachments > 0) {
        contextHints.push(`Hinweis: ${screeningDataset.unsupportedAttachments} Anhänge konnten nicht automatisch ausgewertet werden und müssen manuell geprüft werden.`);
      }

      const taskDefinitions = [
        {
          syncKey: `${PLUGIN_ID}:${SCREENING_MODULE_KEY}:go-no-go:${run.id}`,
          title: `Ausschreibungsscreening: Go/No-Go Entwurf (${project.name})`,
          description: `Erstelle Entscheidungsentwurf mit Chancen, Risiken, Aufwand und Empfehlung. Risiko-Signale: ${screeningDataset.riskSignalHits}. ${contextHints.join(" ")}`,
          priority: "high",
        },
      ];

      for (const criterion of checklist.slice(0, 12)) {
        taskDefinitions.push({
          syncKey: `${PLUGIN_ID}:${SCREENING_MODULE_KEY}:criterion:${toSlug(criterion)}:${run.id}`,
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
          usedMemoryIds,
        });
        syncedTasks.push({ taskId: result.task.id, title: result.task.title, reused: result.reused });
      }

      const createdCount = syncedTasks.filter((entry) => !entry.reused).length;
      const reusedCount = syncedTasks.length - createdCount;
      let memoryWriteCount = 0;
      let memoryWriteWarning = "";
      try {
        memoryWriteCount = await persistScreeningMemoryEntries({
          projectId,
          roomId,
          runId: run.id,
          createdBy: req.user!.id,
          runTitle,
          projectName: project.name,
          checklist,
          successCriteria,
          dataset: screeningDataset,
          decision: goNoGoDecision,
          projectContext: (project as any).projectContext,
        });
      } catch {
        memoryWriteWarning = "Agent Memory konnte nicht vollständig geschrieben werden.";
      }

      const unsupportedNote = screeningDataset.unsupportedAttachments > 0
        ? ` ⚠️ ${screeningDataset.unsupportedAttachments} Anhänge konnten nicht automatisch ausgewertet werden.`
        : "";
      const summary = `Screening abgeschlossen: ${createdCount} neue Tasks, ${reusedCount} wiederverwendet, ${screeningDataset.parsedAttachments}/${screeningDataset.totalAttachments} Anhänge ausgewertet, Memory-Einträge: ${memoryWriteCount}.${unsupportedNote}`;

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
          resourceSignalHits: screeningDataset.resourceSignalHits,
          roomMessageSignals: screeningDataset.roomMessageSignals,
          deadlineCandidates: screeningDataset.deadlineCandidates,
        },
        goNoGo: goNoGoDecision,
        memory: {
          consideredEntries: memorySnapshot.length,
          writtenEntries: memoryWriteCount,
          usedMemoryIds,
          warning: memoryWriteWarning || undefined,
          recent: memorySnapshot.slice(0, 8).map((entry) => ({
            id: entry.id,
            memoryType: entry.memoryType,
            confidence: entry.confidence,
            createdAt: entry.createdAt,
            expiresAt: entry.expiresAt || null,
            freshnessStatus: entry.freshnessStatus || "unknown",
            preview: summarizeMemoryPayload(entry.memoryType, entry.payload),
          })),
        },
        usedMemoryIds,
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
  async (req, res) => {
    try {
      const projectId = String(req.query.projectId || "").trim();
      if (!projectId) {
        return res.status(400).json({ error: "projectId is required" });
      }

      const { roomId } = await resolveRunContext(
        req.user!.id,
        projectId,
        Boolean(req.user?.isAdmin),
      );

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
    version: "0.3.0",
    description:
      "Ausschreibungs-Screening mit room-nativer Orchestrierung, task-basiertem Follow-up und Agent-Memory-gestützter Go/No-Go Bewertung.",
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
          icon: undefined,
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
