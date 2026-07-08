import React, { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  PuzzlePieceIcon,
  CubeTransparentIcon,
  MapIcon,
} from "@heroicons/react/24/outline";
import { useTheme } from "../contexts/ThemeContext";
import { useLanguage } from "../contexts/LanguageContext";
import { PageShell } from "../components/ui/PageShell";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  SectionHeader,
  Select,
} from "../components/ui/primitives";
import { usePluginStore } from "../stores/pluginStore";
import { apiClient } from "../lib/apiClient";
import { authFileUrl } from "../lib/fileUrl";

interface SalesProjectSummary {
  id: string;
  name: string;
  status: string;
  roomId?: string | null;
}

interface ScreeningProjectAttachment {
  id: string;
  filename: string;
  mimeType?: string | null;
  size?: number | null;
  createdAt: string;
  url: string;
}

interface SalesModuleInstance {
  id: string;
  pluginId: string;
  moduleKey: string;
  projectId: string;
  roomId: string;
  createdAt: string;
  updatedAt: string;
}

interface SalesModuleRun {
  id: string;
  status: "started" | "completed" | "failed" | string;
  startedAt: string;
  completedAt?: string | null;
  errorText?: string | null;
  runInput?: {
    title?: string;
  };
  usedMemoryIds?: string[];
  runOutput?: {
    taskCount?: number;
    createdCount?: number;
    reusedCount?: number;
    screeningSignals?: {
      totalTasks?: number;
      totalProjectAttachments?: number;
      totalTaskAttachments?: number;
      totalAttachments?: number;
      parsedAttachments?: number;
      unsupportedAttachments?: number;
      missingFiles?: number;
      mustRequirementHits?: number;
      riskSignalHits?: number;
      resourceSignalHits?: number;
      roomMessageSignals?: number;
      deadlineCandidates?: string[];
    };
    goNoGo?: {
      recommendation?: "go" | "conditional-go" | "no-go" | string;
      score?: number;
      confidence?: number;
      blockers?: string[];
      missingEvidence?: string[];
      reasons?: string[];
    };
    memory?: {
      consideredEntries?: number;
      writtenEntries?: number;
      warning?: string;
    };
    findings?: string[];
  };
}

interface AgentMemoryEntry {
  id: string;
  memoryType: string;
  confidence: number;
  createdAt: string;
  expiresAt?: string | null;
  preview?: string;
}

const SALES_PLUGIN_ID = "sales-workbench";

function parseChecklist(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function parseMemoryTags(value: string): string[] {
  const tags: string[] = [];
  for (const raw of value.split(/,|\n/)) {
    const tag = raw.trim().toLowerCase();
    if (!tag) continue;
    if (tags.includes(tag)) continue;
    tags.push(tag.slice(0, 48));
    if (tags.length >= 8) break;
  }
  return tags;
}

function getStatusVariant(
  status: string,
): "neutral" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "started") return "warning";
  return "neutral";
}

function getRecommendationVariant(
  recommendation?: string,
): "neutral" | "success" | "warning" | "danger" {
  if (recommendation === "go") return "success";
  if (recommendation === "no-go") return "danger";
  if (recommendation === "conditional-go") return "warning";
  return "neutral";
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatFileSize(size?: number | null): string {
  if (!size || size <= 0) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}


export const PluginWorkspacePage: React.FC = () => {
  const { pluginId } = useParams<{ pluginId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const { plugins, isLoading, loadPlugins } = usePluginStore();
  const defaultRunTitle = t("plugins.screening.defaultRunTitle");
  const defaultChecklistInput = t("plugins.screening.defaultChecklist");
  const defaultSuccessCriteria = t("plugins.screening.defaultSuccessCriteria");

  const [projects, setProjects] = useState<SalesProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [runError, setRunError] = useState("");

  const initialProjectId = searchParams.get("projectId") || "";
  const [projectId, setProjectId] = useState(initialProjectId);
  const [hasExplicitProjectSelection, setHasExplicitProjectSelection] =
    useState(Boolean(initialProjectId));
  const [runTitle, setRunTitle] = useState(defaultRunTitle);
  const [checklistItems, setChecklistItems] = useState<string[]>(() =>
    parseChecklist(defaultChecklistInput),
  );
  const [checklistDraft, setChecklistDraft] = useState("");
  const [successCriteria, setSuccessCriteria] = useState(
    defaultSuccessCriteria,
  );

  const [moduleInstance, setModuleInstance] =
    useState<SalesModuleInstance | null>(null);
  const [runs, setRuns] = useState<SalesModuleRun[]>([]);
  const [projectAttachments, setProjectAttachments] = useState<
    ScreeningProjectAttachment[]
  >([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [handoffNote, setHandoffNote] = useState("");
  const [memoryNoteDraft, setMemoryNoteDraft] = useState("");
  const [memoryTagsDraft, setMemoryTagsDraft] = useState("");
  const [savingMemoryNote, setSavingMemoryNote] = useState(false);
  const [lastOutput, setLastOutput] = useState<{
    taskCount?: number;
    createdCount?: number;
    reusedCount?: number;
    screeningSignals?: {
      totalProjectAttachments?: number;
      totalTaskAttachments?: number;
      totalAttachments?: number;
      parsedAttachments?: number;
      unsupportedAttachments?: number;
      resourceSignalHits?: number;
      deadlineCandidates?: string[];
    };
    goNoGo?: {
      recommendation?: "go" | "conditional-go" | "no-go" | string;
      score?: number;
      confidence?: number;
      blockers?: string[];
      missingEvidence?: string[];
      reasons?: string[];
    };
    memory?: {
      consideredEntries?: number;
      writtenEntries?: number;
      warning?: string;
      recent?: Array<{
        id: string;
        memoryType: string;
        confidence: number;
        createdAt: string;
        expiresAt?: string | null;
        preview?: string;
      }>;
    };
    findings?: string[];
  } | null>(null);
  const [memoryEntries, setMemoryEntries] = useState<AgentMemoryEntry[]>([]);
  const [loadingMemory, setLoadingMemory] = useState(false);

  const isDark = theme === "dark";

  useEffect(() => {
    if (!pluginId) return;
    void loadPlugins();
  }, [pluginId, loadPlugins]);

  const plugin = useMemo(
    () => plugins.find((entry) => entry.id === pluginId),
    [plugins, pluginId],
  );
  const isSalesWorkbench = pluginId === SALES_PLUGIN_ID;
  const selectedProject = useMemo(
    () => projects.find((entry) => entry.id === projectId) || null,
    [projects, projectId],
  );
  const roomId = selectedProject?.roomId || null;
  const canRun = Boolean(
    isSalesWorkbench &&
    hasExplicitProjectSelection &&
    selectedProject &&
    selectedProject.roomId,
  );
  const hasProjectAttachments = projectAttachments.length > 0;
  const suggestedPrompt = useMemo(() => {
    const taskCountLabel =
      typeof lastOutput?.taskCount === "number" && lastOutput.taskCount > 0
        ? t("plugins.screening.prompt.taskCountLabel").replace(
            "{count}",
            String(lastOutput.taskCount),
          )
        : t("plugins.screening.prompt.taskCountFallback");
    const projectLabel = selectedProject?.name
      ? t("plugins.screening.prompt.projectLabelWithName").replace(
          "{name}",
          selectedProject.name,
        )
      : t("plugins.screening.prompt.projectLabelFallback");
    const note = handoffNote.trim();
    const noteLine = note
      ? `\n${t("plugins.screening.prompt.contextPrefix")}: ${note}`
      : "";

    return (
      [
        t("plugins.screening.prompt.line1").replace(
          "{projectLabel}",
          projectLabel,
        ),
        t("plugins.screening.prompt.line2").replace(
          "{taskCountLabel}",
          taskCountLabel,
        ),
        t("plugins.screening.prompt.line3"),
      ].join("\n") + noteLine
    );
  }, [handoffNote, lastOutput?.taskCount, selectedProject?.name, t]);

  const loadProjects = useCallback(async () => {
    if (!isSalesWorkbench) return;
    setLoadingProjects(true);
    try {
      const response = await apiClient(
        "/api/projects?legacy=true&status=active&limit=100",
      );

      if (!response.ok) {
        throw new Error(`Projects request failed (${response.status})`);
      }

      const data = await response.json();
      const items = Array.isArray(data) ? data : [];
      const normalized: SalesProjectSummary[] = items
        .map((entry: Record<string, unknown>) => ({
          id: String(entry?.id || ""),
          name: String(entry?.name || t("plugins.screening.untitledProject")),
          status: String(entry?.status || ""),
          roomId: entry?.roomId ? String(entry.roomId) : null,
        }))
        .filter((entry) => entry.id && entry.roomId);

      setProjects(normalized);
    } catch (error) {
      console.error("Failed to load projects for sales workbench", error);
    } finally {
      setLoadingProjects(false);
    }
  }, [isSalesWorkbench, t]);

  const loadProjectAttachments = useCallback(async () => {
    if (!isSalesWorkbench || !projectId || !hasExplicitProjectSelection) {
      setProjectAttachments([]);
      return;
    }

    setLoadingAttachments(true);
    try {
      const query = new URLSearchParams({ projectId });
      const response = await apiClient(
        `/api/plugin-modules/sales-workbench/project-attachments?${query.toString()}`,
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          String(
            data?.error || `Failed to load attachments (${response.status})`,
          ),
        );
      }

      const attachments = Array.isArray(data?.attachments)
        ? data.attachments
        : [];
      setProjectAttachments(attachments);
    } catch (error) {
      setRunError(
        error instanceof Error ? error.message : t("plugins.screening.error.attachmentsLoad"),
      );
      setProjectAttachments([]);
    } finally {
      setLoadingAttachments(false);
    }
  }, [isSalesWorkbench, projectId, hasExplicitProjectSelection, t]);

  const loadRuns = useCallback(async () => {
    if (!isSalesWorkbench || !projectId || !hasExplicitProjectSelection) {
      setModuleInstance(null);
      setRuns([]);
      return;
    }

    setLoadingRuns(true);
    setRunError("");

    try {
      const query = new URLSearchParams({ projectId });
      const response = await apiClient(
        `/api/plugin-modules/sales-workbench/instances?${query.toString()}`,
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          String(data?.error || `Failed to load runs (${response.status})`),
        );
      }

      setModuleInstance(data?.moduleInstance || null);
      setRuns(Array.isArray(data?.runs) ? data.runs : []);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : t("plugins.screening.error.moduleLoad"));
      setModuleInstance(null);
      setRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  }, [isSalesWorkbench, projectId, hasExplicitProjectSelection, t]);

  const loadMemorySnapshot = useCallback(async () => {
    if (!isSalesWorkbench || !projectId || !hasExplicitProjectSelection) {
      setMemoryEntries([]);
      return;
    }

    setLoadingMemory(true);
    try {
      const query = new URLSearchParams({ projectId });
      const response = await apiClient(
        `/api/plugin-modules/sales-workbench/memory?${query.toString()}`,
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          String(data?.error || `Failed to load memory (${response.status})`),
        );
      }

      const items = Array.isArray(data?.items) ? data.items : [];
      const normalized: AgentMemoryEntry[] = items.map((entry: Record<string, unknown>) => ({
        id: String(entry?.id || ""),
        memoryType: String(entry?.memoryType || ""),
        confidence:
          typeof entry?.confidence === "number" ? entry.confidence : 0,
        createdAt: String(entry?.createdAt || ""),
        expiresAt: entry?.expiresAt ? String(entry.expiresAt) : null,
        preview: entry?.preview ? String(entry.preview) : "",
      }));
      setMemoryEntries(normalized.filter((entry) => entry.id));
    } catch (error) {
      setRunError(error instanceof Error ? error.message : t("plugins.screening.error.memoryLoad"));
      setMemoryEntries([]);
    } finally {
      setLoadingMemory(false);
    }
  }, [isSalesWorkbench, projectId, hasExplicitProjectSelection, t]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!isSalesWorkbench) return;

    const nextParams = new URLSearchParams();
    if (projectId) nextParams.set("projectId", projectId);

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [isSalesWorkbench, projectId, searchParams, setSearchParams]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    void loadProjectAttachments();
  }, [loadProjectAttachments]);

  useEffect(() => {
    void loadMemorySnapshot();
  }, [loadMemorySnapshot]);

  const handleProjectChange = (value: string) => {
    setProjectId(value);
    setHasExplicitProjectSelection(Boolean(value));
    setRunError("");
    setSelectedFile(null);
  };

  const handleUploadAttachment = async (fileOverride?: File | null) => {
    const fileToUpload = fileOverride ?? selectedFile;
    if (!projectId || !hasExplicitProjectSelection) {
      setRunError(t("plugins.screening.error.selectProjectFirst"));
      return;
    }
    if (!fileToUpload) {
      setRunError(t("plugins.screening.error.selectFileFirst"));
      return;
    }

    setUploadingAttachment(true);
    setRunError("");
    try {
      const formData = new FormData();
      formData.append("file", fileToUpload);

      const query = new URLSearchParams({ projectId });
      const response = await apiClient(
        `/api/plugin-modules/sales-workbench/project-attachments?${query.toString()}`,
        {
          method: "POST",
          body: formData,
        },
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          String(data?.error || `Upload failed (${response.status})`),
        );
      }

      const attachment = data?.attachment;
      if (attachment?.id) {
        setProjectAttachments((prev) => [attachment, ...prev]);
      }
      // Always reload from server to ensure consistency
      await loadProjectAttachments();
      setSelectedFile(null);
      toast.success(t("plugins.screening.toast.uploaded"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("plugins.screening.error.upload");
      setRunError(message);
      toast.error(message);
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleAddChecklistItems = () => {
    const nextEntries = parseChecklist(checklistDraft);
    if (nextEntries.length === 0) return;

    setChecklistItems((prev) => {
      const merged = [...prev];
      for (const entry of nextEntries) {
        if (merged.length >= 12) break;
        const exists = merged.some(
          (item) =>
            item.localeCompare(entry, undefined, { sensitivity: "base" }) === 0,
        );
        if (!exists) merged.push(entry);
      }
      return merged;
    });
    setChecklistDraft("");
  };

  const handleRemoveChecklistItem = (index: number) => {
    setChecklistItems((prev) =>
      prev.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!projectId) return;
    try {
      const query = new URLSearchParams({ projectId });
      const response = await apiClient(
        `/api/plugin-modules/sales-workbench/project-attachments/${attachmentId}?${query.toString()}`,
        { method: "DELETE" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          String(data?.error || `Delete failed (${response.status})`),
        );
      }
      setProjectAttachments((prev) =>
        prev.filter((attachment) => attachment.id !== attachmentId),
      );
      toast.success(t("plugins.screening.toast.removed"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("plugins.screening.error.remove"));
    }
  };

  const persistMemoryNote = useCallback(
    async (options?: { silentSuccess?: boolean; clearDraft?: boolean }) => {
      if (!projectId || !hasExplicitProjectSelection || !canRun) {
        setRunError(t("plugins.screening.error.selectProjectActive"));
        return false;
      }

      const note = memoryNoteDraft.trim();
      if (!note) {
        const message = t("plugins.screening.error.memoryNoteRequired");
        setRunError(message);
        toast.error(message);
        return false;
      }

      setSavingMemoryNote(true);
      setRunError("");
      try {
        const response = await apiClient(
          "/api/plugin-modules/sales-workbench/memory",
          {
            method: "POST",
            body: JSON.stringify({
              projectId,
              note,
              tags: parseMemoryTags(memoryTagsDraft),
            }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            String(data?.error || `Memory write failed (${response.status})`),
          );
        }

        if (options?.clearDraft !== false) {
          setMemoryNoteDraft("");
          setMemoryTagsDraft("");
        }
        if (!options?.silentSuccess) {
          toast.success(t("plugins.screening.toast.memoryNoteSaved"));
        }
        await loadMemorySnapshot();
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("plugins.screening.error.memoryNoteSave");
        setRunError(message);
        toast.error(message);
        return false;
      } finally {
        setSavingMemoryNote(false);
      }
    },
    [
      projectId,
      hasExplicitProjectSelection,
      canRun,
      memoryNoteDraft,
      memoryTagsDraft,
      loadMemorySnapshot,
      t,
    ],
  );

  const handleStartRun = async () => {
    if (!projectId || !hasExplicitProjectSelection) {
      setRunError(t("plugins.screening.error.selectProjectActive"));
      return;
    }

    if (!selectedProject?.roomId) {
      setRunError(t("plugins.screening.error.roomMissing"));
      return;
    }
    if (!hasProjectAttachments) {
      setRunError(t("plugins.screening.error.uploadRequired"));
      return;
    }

    const checklist = checklistItems
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(0, 12);
    if (checklist.length === 0) {
      setRunError(t("plugins.screening.error.checklistRequired"));
      return;
    }

    setStartingRun(true);
    setRunError("");

    try {
      if (memoryNoteDraft.trim()) {
        const persisted = await persistMemoryNote({
          silentSuccess: true,
          clearDraft: true,
        });
        if (!persisted) return;
      }

      const response = await apiClient(
        "/api/plugin-modules/sales-workbench/runs/screening",
        {
          method: "POST",
          body: JSON.stringify({
            projectId,
            title: runTitle.trim() || defaultRunTitle,
            checklist,
            successCriteria: successCriteria.trim(),
          }),
        },
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          String(data?.error || `Run request failed (${response.status})`),
        );
      }

      setLastOutput(data?.output || null);
      toast.success(t("plugins.screening.toast.tasksCreated"));
      await loadRuns();
      await loadProjectAttachments();
      await loadMemorySnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("plugins.screening.error.runFailed");
      setRunError(message);
      toast.error(message);
    } finally {
      setStartingRun(false);
    }
  };

  const handleSaveMemoryNote = async () => {
    await persistMemoryNote({ silentSuccess: false, clearDraft: true });
  };

  const handleCopyPrompt = async () => {
    if (!canRun) return;
    try {
      await navigator.clipboard.writeText(suggestedPrompt);
      toast.success(t("plugins.screening.toast.promptCopied"));
    } catch {
      toast.error(t("plugins.screening.error.promptCopy"));
    }
  };

  if (!pluginId) {
    return (
      <PageShell title={t("plugins.title")} subtitle={t("plugins.subtitle")}>
        <EmptyState title={t("plugins.notFound")} icon={<PuzzlePieceIcon className="w-8 h-8" />} />
      </PageShell>
    );
  }

  if (isLoading && !plugin) {
    return (
      <PageShell title={t("plugins.title")} subtitle={t("plugins.subtitle")}>
        <div
          className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
        >
          {t("plugins.loading")}
        </div>
      </PageShell>
    );
  }

  if (!plugin) {
    return (
      <PageShell title={t("plugins.title")} subtitle={t("plugins.subtitle")}>
        <EmptyState title={t("plugins.notFound")} icon={<PuzzlePieceIcon className="w-8 h-8" />} />
      </PageShell>
    );
  }

  const navItems = plugin.ui?.navItems ?? [];
  const capabilities = plugin.capabilities ?? [];

  return (
    <PageShell
      title={`${plugin.name} ${t("plugins.workspace")}`}
      subtitle={plugin.description || t("plugins.noDescription")}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <Card tone="muted" className="p-4 lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <PuzzlePieceIcon className="w-5 h-5" />
            <h2 className="text-base font-semibold">{t("plugins.details")}</h2>
          </div>
          <div
            className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}
          >
            <div>
              {t("plugins.meta.id")}: <code>{plugin.id}</code>
            </div>
            <div>
              {t("plugins.meta.version")}: <code>{plugin.version}</code>
            </div>
          </div>
        </Card>

        <Card tone="muted" className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <CubeTransparentIcon className="w-5 h-5" />
            <h2 className="text-base font-semibold">
              {t("plugins.capabilities")}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {capabilities.length === 0 && (
              <span
                className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                {t("plugins.none")}
              </span>
            )}
            {capabilities.map((capability) => (
              <Badge key={capability} variant="neutral">
                {capability}
              </Badge>
            ))}
          </div>
        </Card>

        {isSalesWorkbench && (
          <>
            <Card tone="accent" className="p-4 lg:col-span-3">
              <SectionHeader
                title={t("plugins.screening.moduleTitle")}
                className="mb-3"
                actions={
                  roomId ? (
                    <Link
                      to={`/room/${roomId}`}
                      className={`text-xs font-medium ${
                        isDark
                          ? "text-blue-300 hover:text-blue-200"
                          : "text-blue-600 hover:text-blue-500"
                      }`}
                    >
                      {t("plugins.screening.openProjectRoom")}
                    </Link>
                  ) : undefined
                }
              />

              <div
                className={`mt-3 rounded-lg border p-3 ${isDark ? "border-gray-700/50 bg-gray-800/60" : "border-gray-200/60 bg-white"}`}
              >
                <h3 className="text-sm font-semibold">
                  {t("plugins.screening.step1Title")}
                </h3>
                <div className="grid gap-3 mt-2 lg:grid-cols-2">
                  <div>
                    <label
                      className={`mb-1 block text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}
                    >
                      {t("plugins.screening.project")}
                    </label>
                    <Select
                      value={projectId}
                      onChange={(value) => handleProjectChange(value)}
                      disabled={loadingProjects || projects.length === 0}
                      placeholder={t("plugins.screening.projectSelectPlaceholder")}
                      options={projects.map((entry) => ({
                        value: entry.id,
                        label: entry.name,
                      }))}
                    />
                  </div>

                  <div>
                    <label
                      className={`mb-1 block text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}
                    >
                      {t("plugins.screening.linkedRoom")}
                    </label>
                    <div
                      className={`min-h-[38px] rounded-lg border px-3 py-2 text-sm ${isDark ? "border-gray-700/50 bg-gray-800 text-gray-200" : "border-gray-300/60 bg-gray-50 text-gray-800"}`}
                    >
                      {roomId || "-"}
                    </div>
                  </div>
                </div>

                {!hasExplicitProjectSelection && (
                  <div
                    className={`mt-3 rounded-lg border border-dashed px-3 py-2 text-sm ${isDark ? "border-amber-800/60 text-amber-300 bg-amber-900/10" : "border-amber-300 text-amber-700 bg-amber-50"}`}
                  >
                    {t("plugins.screening.selectProjectWarning")}
                  </div>
                )}
              </div>

              <div
                className={`mt-3 rounded-lg border p-3 ${isDark ? "border-gray-700/50 bg-gray-800/60" : "border-gray-200/60 bg-white"}`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold">
                    {t("plugins.screening.step2Title")}
                  </h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void loadProjectAttachments()}
                    disabled={loadingAttachments || !canRun}
                  >
                    {loadingAttachments
                      ? t("common.loading")
                      : t("plugins.screening.refreshAttachments")}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs ${
                      isDark
                        ? "border-gray-600/50 bg-gray-800 text-gray-200 hover:bg-gray-700"
                        : "border-gray-300/60 bg-white text-gray-700 hover:bg-gray-100"
                    } ${!canRun || uploadingAttachment ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <input
                      type="file"
                      className="hidden"
                      disabled={!canRun || uploadingAttachment}
                      onChange={(event) => {
                        const nextFile = event.target.files?.[0] || null;
                        setSelectedFile(nextFile);
                        event.currentTarget.value = "";
                        if (nextFile) {
                          void handleUploadAttachment(nextFile);
                        }
                      }}
                    />
                    {t("plugins.screening.selectFile")}
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleUploadAttachment()}
                    disabled={uploadingAttachment || !canRun || !selectedFile}
                  >
                    {uploadingAttachment
                      ? t("plugins.screening.uploading")
                      : t("plugins.screening.attachFile")}
                  </Button>
                </div>
                <div
                  className={`mt-1 text-[11px] ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("plugins.screening.uploadHint")}
                </div>
                {selectedFile && (
                  <div
                    className={`mt-2 flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs ${
                      isDark
                        ? "border-gray-700/50 bg-gray-900 text-gray-200"
                        : "border-gray-200/60 bg-white text-gray-700"
                    }`}
                  >
                    <div className="min-w-0 truncate">
                      <strong>{selectedFile.name}</strong> (
                      {formatFileSize(selectedFile.size)})
                    </div>
                    <button
                      type="button"
                      className={
                        isDark
                          ? "text-red-300 hover:text-red-200"
                          : "text-red-600 hover:text-red-500"
                      }
                      onClick={() => setSelectedFile(null)}
                    >
                      {t("projects.task.attachment.removeSelected")}
                    </button>
                  </div>
                )}
                <div className="mt-2 space-y-1">
                  {projectAttachments.length === 0 && !loadingAttachments ? (
                    <div
                      className={`rounded border border-dashed px-3 py-4 text-center text-sm ${isDark ? "border-gray-700/50 text-gray-500" : "border-gray-300/60 text-gray-500"}`}
                    >
                      {t("plugins.screening.noProjectAttachments")}
                    </div>
                  ) : (
                    projectAttachments.slice(0, 8).map((attachment) => (
                      <div
                        key={attachment.id}
                        className={`flex flex-col sm:flex-row gap-2 rounded border p-2 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-gray-50"}`}
                      >
                        <a
                          href={authFileUrl(attachment.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex-1 min-w-0 rounded border px-2 py-1 text-xs transition-colors duration-200 ${
                            isDark
                              ? "border-gray-700/50 bg-gray-800 hover:bg-gray-700 text-blue-300"
                              : "border-gray-200/60 bg-white hover:bg-gray-50 text-blue-600"
                          }`}
                          title={attachment.filename}
                        >
                          <div className="truncate font-medium">
                            {attachment.filename}
                          </div>
                          <div
                            className={
                              isDark ? "text-gray-400" : "text-gray-500"
                            }
                          >
                            {formatFileSize(attachment.size)} •{" "}
                            {formatDateTime(attachment.createdAt)}
                          </div>
                        </a>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="danger"
                            className="w-full sm:w-auto shrink-0 whitespace-nowrap"
                            onClick={() =>
                              void handleDeleteAttachment(attachment.id)
                            }
                          >
                            {t("projects.task.attachment.removeSelected")}
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div
                  className={`mt-3 rounded border border-dashed px-3 py-3 ${isDark ? "border-gray-700/50 bg-gray-900/30" : "border-gray-200/60 bg-gray-50"}`}
                >
                  <div className="mb-1 text-xs font-medium">
                    {t("plugins.screening.memoryNoteTitle")}
                  </div>
                  <textarea
                    value={memoryNoteDraft}
                    onChange={(event) => setMemoryNoteDraft(event.target.value)}
                    placeholder={t("plugins.screening.memoryNotePlaceholder")}
                    className={`w-full min-h-[72px] resize-y rounded border px-2 py-1 text-xs ${
                      isDark
                        ? "border-gray-700/50 bg-gray-900 text-gray-100 placeholder:text-gray-500"
                        : "border-gray-200/60 bg-white text-gray-900 placeholder:text-gray-400"
                    }`}
                    disabled={!canRun}
                  />
                  <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={memoryTagsDraft}
                      onChange={(event) =>
                        setMemoryTagsDraft(event.target.value)
                      }
                      placeholder={t(
                        "plugins.screening.memoryNoteTagsPlaceholder",
                      )}
                      disabled={!canRun}
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSaveMemoryNote}
                      disabled={
                        savingMemoryNote ||
                        !canRun ||
                        memoryNoteDraft.trim().length === 0
                      }
                    >
                      {savingMemoryNote
                        ? t("common.loading")
                        : t("plugins.screening.memoryNoteSave")}
                    </Button>
                  </div>
                  <div
                    className={`mt-1 text-[11px] ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {t("plugins.screening.memoryNoteTagsLabel")}
                  </div>
                  <div
                    className={`mt-1 text-[11px] ${isDark ? "text-blue-300" : "text-blue-700"}`}
                  >
                    {t("plugins.screening.memoryNoteStep2Hint")}
                  </div>
                </div>
              </div>

              <div
                className={`mt-3 rounded-lg border p-3 ${isDark ? "border-gray-700/50 bg-gray-800/60" : "border-gray-200/60 bg-white"}`}
              >
                <h3 className="text-sm font-semibold">
                  {t("plugins.screening.step3Title")}
                </h3>
                <div className="grid gap-3 mt-2 lg:grid-cols-2">
                  <div>
                    <label
                      className={`mb-1 block text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}
                    >
                      {t("plugins.screening.runTitleLabel")}
                    </label>
                    <Input
                      value={runTitle}
                      onChange={(event) => setRunTitle(event.target.value)}
                      placeholder={defaultRunTitle}
                    />
                  </div>
                  <div>
                    <label
                      className={`mb-1 block text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}
                    >
                      {t("plugins.screening.expectedResult")}
                    </label>
                    <Input
                      value={successCriteria}
                      onChange={(event) =>
                        setSuccessCriteria(event.target.value)
                      }
                      placeholder={t("plugins.screening.expectedResult")}
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label
                      className={`block text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}
                    >
                      {t("plugins.screening.checklistLabel")}
                    </label>
                    <Badge variant="neutral">{checklistItems.length}/12</Badge>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      value={checklistDraft}
                      onChange={(event) =>
                        setChecklistDraft(event.target.value)
                      }
                      placeholder={t("plugins.screening.checklistPlaceholder")}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        handleAddChecklistItems();
                      }}
                      disabled={checklistItems.length >= 12}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={handleAddChecklistItems}
                      disabled={
                        checklistItems.length >= 12 ||
                        checklistDraft.trim().length === 0
                      }
                    >
                      {t("plugins.screening.checklistAdd")}
                    </Button>
                  </div>
                  <div
                    className={`mt-1 text-[11px] ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {t("plugins.screening.checklistHint")}
                  </div>
                </div>

                <div className="mt-2 space-y-1">
                  {checklistItems.length === 0 ? (
                    <div
                      className={`rounded border border-dashed px-3 py-4 text-center text-sm ${isDark ? "border-gray-700/50 text-gray-500" : "border-gray-300/60 text-gray-500"}`}
                    >
                      {t("plugins.screening.checklistEmpty")}
                    </div>
                  ) : (
                    checklistItems.map((item, index) => (
                      <div
                        key={`${item}-${index}`}
                        className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs ${
                          isDark
                            ? "border-gray-700/50 bg-gray-900 text-gray-200"
                            : "border-gray-200/60 bg-white text-gray-700"
                        }`}
                      >
                        <span className="truncate">{item}</span>
                        <Button
                          type="button"
                          size="xs"
                          variant="danger"
                          className="shrink-0"
                          onClick={() => handleRemoveChecklistItem(index)}
                        >
                          {t("projects.task.attachment.removeSelected")}
                        </Button>
                      </div>
                    ))
                  )}
                </div>

                {runError && (
                  <div className={`mt-3 text-sm ${isDark ? "text-red-400" : "text-red-600"}`}>{runError}</div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={handleStartRun}
                    disabled={
                      startingRun ||
                      loadingProjects ||
                      !canRun ||
                      !hasProjectAttachments
                    }
                  >
                    {startingRun
                      ? t("plugins.screening.creating")
                      : t("plugins.screening.createTasks")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void loadRuns()}
                    disabled={loadingRuns || !canRun}
                  >
                    {loadingRuns
                      ? t("common.loading")
                      : t("plugins.screening.refreshRuns")}
                  </Button>
                </div>
              </div>

              <div
                className={`mt-3 rounded-lg border p-3 ${isDark ? "border-gray-700/50 bg-gray-800/60" : "border-gray-200/60 bg-white"}`}
              >
                <h3 className="text-sm font-semibold mb-2">
                  {t("plugins.screening.step4Title")}
                </h3>
                <div
                  className={`text-xs mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  {t("plugins.screening.step4Hint")}
                </div>
                <Input
                  value={handoffNote}
                  onChange={(event) => setHandoffNote(event.target.value)}
                  placeholder={t("plugins.screening.handoffNotePlaceholder")}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => void handleCopyPrompt()}
                    disabled={!canRun}
                  >
                    {t("plugins.screening.copyPrompt")}
                  </Button>
                  {projectId && (
                    <Link
                      to={`/projects/${projectId}`}
                      className={`text-xs font-medium ${
                        isDark
                          ? "text-emerald-300 hover:text-emerald-200"
                          : "text-emerald-700 hover:text-emerald-600"
                      }`}
                    >
                      {t("plugins.screening.checkAssignees")}
                    </Link>
                  )}
                  {roomId && (
                    <Link
                      to={`/room/${roomId}`}
                      className={`text-xs font-medium ${
                        isDark
                          ? "text-blue-300 hover:text-blue-200"
                          : "text-blue-600 hover:text-blue-500"
                      }`}
                    >
                      {t("plugins.screening.openRoom")}
                    </Link>
                  )}
                </div>
                <div
                  className={`mt-2 rounded border px-2 py-2 text-xs whitespace-pre-line ${isDark ? "border-gray-700/50 bg-gray-900/50 text-gray-200" : "border-gray-200/60 bg-gray-50 text-gray-700"}`}
                >
                  {t("plugins.screening.promptSuggestion")}:{"\n"}
                  {suggestedPrompt}
                </div>
              </div>
            </Card>

            <Card tone="muted" className="p-4 lg:col-span-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold">
                    {t("plugins.screening.statusTitle")}
                  </h2>
                  {moduleInstance && (
                    <Badge variant="info">
                      {t("plugins.screening.instanceActive")}
                    </Badge>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void loadMemorySnapshot()}
                  disabled={!canRun || loadingMemory}
                >
                  {loadingMemory
                    ? t("common.loading")
                    : t("plugins.screening.refreshMemory")}
                </Button>
              </div>
              {!hasExplicitProjectSelection && !loadingRuns && (
                <div
                  className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
                >
                  {t("plugins.screening.statusSelectProjectHint")}
                </div>
              )}
              {!moduleInstance &&
                !loadingRuns &&
                hasExplicitProjectSelection && (
                  <div
                    className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
                  >
                    {t("plugins.screening.statusNoInstanceHint")}
                  </div>
                )}
              {moduleInstance && (
                <div
                  className={`text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}
                >
                  <div>
                    {t("plugins.screening.instanceLabel")}:{" "}
                    <code>{moduleInstance.id}</code>
                  </div>
                  <div>
                    {t("plugins.screening.updatedAt")}:{" "}
                    <strong>{formatDateTime(moduleInstance.updatedAt)}</strong>
                  </div>
                </div>
              )}

              {lastOutput && (
                <div
                  className={`mt-3 rounded-lg border px-3 py-2 text-sm ${isDark ? "border-gray-700/50 bg-gray-800" : "border-gray-200/60 bg-white"}`}
                >
                  <div>
                    {t("plugins.screening.metrics.tasksTotal")}:{" "}
                    <strong>{lastOutput.taskCount ?? 0}</strong>
                  </div>
                  <div>
                    {t("plugins.screening.metrics.created")}:{" "}
                    <strong>{lastOutput.createdCount ?? 0}</strong>
                  </div>
                  <div>
                    {t("plugins.screening.metrics.reused")}:{" "}
                    <strong>{lastOutput.reusedCount ?? 0}</strong>
                  </div>
                  <div>
                    {t("plugins.screening.metrics.attachmentsParsed")}:{" "}
                    <strong>
                      {lastOutput.screeningSignals?.parsedAttachments ?? 0}
                    </strong>{" "}
                    /{" "}
                    <strong>
                      {lastOutput.screeningSignals?.totalAttachments ?? 0}
                    </strong>
                  </div>
                  {typeof lastOutput.screeningSignals?.resourceSignalHits ===
                    "number" && (
                    <div>
                      {t("plugins.screening.metrics.resourceSignals")}:{" "}
                      <strong>
                        {lastOutput.screeningSignals.resourceSignalHits}
                      </strong>
                    </div>
                  )}
                  {typeof lastOutput.screeningSignals
                    ?.unsupportedAttachments === "number" &&
                    lastOutput.screeningSignals.unsupportedAttachments > 0 && (
                      <div>
                        {t("plugins.screening.metrics.unsupported")}:{" "}
                        <strong>
                          {lastOutput.screeningSignals.unsupportedAttachments}
                        </strong>
                      </div>
                    )}
                  {Array.isArray(
                    lastOutput.screeningSignals?.deadlineCandidates,
                  ) &&
                    lastOutput.screeningSignals.deadlineCandidates.length >
                      0 && (
                      <div>
                        {t("plugins.screening.metrics.deadlineSignals")}:{" "}
                        <strong>
                          {lastOutput.screeningSignals.deadlineCandidates
                            .slice(0, 3)
                            .join(", ")}
                        </strong>
                      </div>
                    )}
                  {typeof lastOutput.memory?.writtenEntries === "number" && (
                    <div>
                      {t("plugins.screening.metrics.memoryWritten")}:{" "}
                      <strong>{lastOutput.memory.writtenEntries}</strong>
                    </div>
                  )}
                </div>
              )}

              {lastOutput?.goNoGo && (
                <div
                  className={`mt-2 rounded-lg border px-3 py-2 text-sm ${isDark ? "border-gray-700/50 bg-gray-800/80 text-gray-200" : "border-gray-200/60 bg-gray-50 text-gray-700"}`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <strong>{t("plugins.screening.goNoGo.title")}</strong>
                    <Badge
                      variant={getRecommendationVariant(
                        lastOutput.goNoGo.recommendation,
                      )}
                    >
                      {(
                        lastOutput.goNoGo.recommendation || "unknown"
                      ).toUpperCase()}
                    </Badge>
                  </div>
                  <div>
                    {t("plugins.screening.goNoGo.score")}:{" "}
                    <strong>{lastOutput.goNoGo.score ?? "-"}</strong>
                  </div>
                  <div>
                    {t("plugins.screening.goNoGo.confidence")}:{" "}
                    <strong>
                      {Math.round((lastOutput.goNoGo.confidence ?? 0) * 100)}%
                    </strong>
                  </div>
                  {Array.isArray(lastOutput.goNoGo.blockers) &&
                    lastOutput.goNoGo.blockers.length > 0 && (
                      <div className="mt-1">
                        {t("plugins.screening.goNoGo.blockers")}:{" "}
                        <strong>{lastOutput.goNoGo.blockers[0]}</strong>
                      </div>
                    )}
                  {Array.isArray(lastOutput.goNoGo.missingEvidence) &&
                    lastOutput.goNoGo.missingEvidence.length > 0 && (
                      <div className="mt-1">
                        {t("plugins.screening.goNoGo.missingEvidence")}:{" "}
                        <strong>{lastOutput.goNoGo.missingEvidence[0]}</strong>
                      </div>
                    )}
                  {lastOutput.memory?.warning && (
                    <div className="mt-1 text-amber-300">
                      {lastOutput.memory.warning}
                    </div>
                  )}
                </div>
              )}

              {Array.isArray(lastOutput?.findings) &&
                lastOutput.findings.length > 0 && (
                  <div
                    className={`mt-2 rounded-lg border px-3 py-2 text-sm ${isDark ? "border-gray-700/50 bg-gray-800/70 text-gray-200" : "border-gray-200/60 bg-gray-50 text-gray-700"}`}
                  >
                    {lastOutput.findings.slice(0, 3).map((finding, index) => (
                      <div key={`${finding}-${index}`}>- {finding}</div>
                    ))}
                  </div>
                )}

              <div
                className={`mt-3 rounded-lg border px-3 py-2 ${isDark ? "border-gray-700/50 bg-gray-800/60" : "border-gray-200/60 bg-white"}`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {t("plugins.screening.memorySnapshotTitle")}
                  </h3>
                  <Badge variant="neutral">{memoryEntries.length}</Badge>
                </div>
                {loadingMemory ? (
                  <div
                    className={`text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}
                  >
                    {t("common.loading")}
                  </div>
                ) : memoryEntries.length === 0 ? (
                  <div
                    className={`text-xs ${isDark ? "text-gray-400" : "text-gray-600"}`}
                  >
                    {t("plugins.screening.memorySnapshotEmpty")}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {memoryEntries.slice(0, 8).map((entry) => (
                      <div
                        key={entry.id}
                        className={`rounded border px-2 py-1 text-xs ${isDark ? "border-gray-700/50 bg-gray-900 text-gray-200" : "border-gray-200/60 bg-gray-50 text-gray-700"}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">
                            {entry.memoryType}
                          </span>
                          <span>
                            {Math.round((entry.confidence || 0) * 100)}% •{" "}
                            {formatDateTime(entry.createdAt)}
                          </span>
                        </div>
                        <div
                          className={isDark ? "text-gray-300" : "text-gray-600"}
                        >
                          {entry.preview || "-"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2">
                {runs.length === 0 &&
                  !loadingRuns &&
                  hasExplicitProjectSelection && (
                    <div
                      className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
                    >
                      {t("plugins.screening.noRuns")}
                    </div>
                  )}
                {runs.map((run) => {
                  const runStatusLabel =
                    run.status === "started"
                      ? t("plugins.screening.runStatus.started")
                      : run.status === "completed"
                        ? t("plugins.screening.runStatus.completed")
                        : run.status === "failed"
                          ? t("plugins.screening.runStatus.failed")
                          : run.status;

                  return (
                    <div
                      key={run.id}
                      className={`rounded-lg border px-3 py-2 ${
                        isDark
                          ? "border-gray-700/50 bg-gray-800/70"
                          : "border-gray-200/60 bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium">
                          {run.runInput?.title ||
                            t("plugins.screening.runFallback")}
                        </div>
                        <Badge variant={getStatusVariant(run.status)}>
                          {runStatusLabel}
                        </Badge>
                      </div>
                      <div
                        className={`mt-1 text-xs ${isDark ? "text-gray-300" : "text-gray-700"}`}
                      >
                        <div>
                          {t("plugins.screening.runStarted")}:{" "}
                          <strong>{formatDateTime(run.startedAt)}</strong>
                        </div>
                        <div>
                          {t("plugins.screening.runCompleted")}:{" "}
                          <strong>{formatDateTime(run.completedAt)}</strong>
                        </div>
                        {typeof run.runOutput?.taskCount === "number" && (
                          <div>
                            {t("plugins.screening.metrics.tasksTotal")}:{" "}
                            <strong>{run.runOutput.taskCount}</strong>
                          </div>
                        )}
                        {typeof run.runOutput?.screeningSignals
                          ?.parsedAttachments === "number" && (
                          <div>
                            {t("plugins.screening.metrics.attachments")}:{" "}
                            <strong>
                              {run.runOutput.screeningSignals.parsedAttachments}
                              /
                              {run.runOutput.screeningSignals
                                .totalAttachments ?? 0}
                            </strong>
                          </div>
                        )}
                        {run.runOutput?.goNoGo?.recommendation && (
                          <div>
                            {t("plugins.screening.goNoGo.title")}:{" "}
                            <strong>
                              {String(
                                run.runOutput.goNoGo.recommendation,
                              ).toUpperCase()}
                            </strong>
                          </div>
                        )}
                        {Array.isArray(run.runOutput?.findings) &&
                          run.runOutput.findings.length > 0 && (
                            <div>
                              {t("plugins.screening.hint")}:{" "}
                              <strong>{run.runOutput.findings[0]}</strong>
                            </div>
                          )}
                        {Array.isArray(run.usedMemoryIds) &&
                          run.usedMemoryIds.length > 0 && (
                            <div>
                              Memory IDs:{" "}
                              <strong>{run.usedMemoryIds.length}</strong>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {run.usedMemoryIds
                                  .slice(0, 4)
                                  .map((memoryId) => (
                                    <Badge
                                      key={`${run.id}:${memoryId}`}
                                      variant="neutral"
                                    >
                                      {memoryId}
                                    </Badge>
                                  ))}
                                {run.usedMemoryIds.length > 4 && (
                                  <Badge variant="neutral">
                                    +{run.usedMemoryIds.length - 4}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )}
                        {run.errorText && (
                          <div className={isDark ? "text-red-400" : "text-red-600"}>
                            {t("plugins.screening.errorLabel")}: {run.errorText}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        )}

        <Card tone="muted" className="p-4 lg:col-span-3">
          <div className="flex items-center gap-2 mb-3">
            <MapIcon className="w-5 h-5" />
            <h2 className="text-base font-semibold">
              {t("plugins.navigation")}
            </h2>
          </div>
          {navItems.length === 0 ? (
            <div
              className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
            >
              {t("plugins.none")}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {navItems.map((item) => (
                <Link
                  key={`${item.to}-${item.label}`}
                  to={item.to}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm ${
                    isDark
                      ? "bg-gray-800 text-gray-200 hover:bg-gray-700"
                      : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                  }`}
                >
                  <span>{item.icon || <PuzzlePieceIcon className="w-4 h-4" />}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
};
