import React, { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { useAuthStore } from "../stores/authStore";
import { InvitePopup } from "../components/chat/InvitePopup";
import { SecretManager } from "../components/projects/SecretManager";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
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
import {
  projectStatusBadgeVariant,
  taskPriorityBadgeVariant,
  taskStatusBadgeVariant,
} from "../utils/statusBadges";

interface TeamMember {
  id: string;
  username: string;
  displayName: string;
  email?: string | null;
  userType: "HUMAN" | "AI_AGENT" | "AI_ICE" | "AI_LAVA" | "AI_OTHER";
}

interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  ownerId: string;
  roomId?: string | null;
  teamMemberIds: string[];
  teamMembers?: TeamMember[];
  attachments?: ProjectAttachment[];
  workflowConfig?: WorkflowConfig;
  projectContext?: ProjectContext;
  createdAt: string;
  updatedAt: string;
}

interface ProjectAttachment {
  id: string;
  filename: string;
  url: string;
  mimeType?: string | null;
  size?: number | null;
  type?: string | null;
  uploadedBy?: string | null;
  sourcePluginId?: string | null;
  createdAt: string;
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

interface WorkflowConfig {
  enabledStatuses: string[];
  instructions: Record<string, string>;
}

interface TaskAttachment {
  id: string;
  taskId: string;
  filename: string;
  url: string;
  mimeType?: string | null;
  size?: number | null;
  type:
    | "IMAGE"
    | "DOCUMENT"
    | "CODE_SNIPPET"
    | "RESEARCH_DATA"
    | "MEMORY_EXPORT";
  uploadedBy: string;
  createdAt: string;
}

interface TaskReviewer {
  id: string;
  username: string;
  displayName: string;
  userType: TeamMember["userType"];
}

interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: string;
  assignedTo: string;
  reviewedBy: string | null;
  reviewer: TaskReviewer | null;
  priority?: string;
  dueDate?: string;
  usedMemoryIds?: string[];
  attachments?: TaskAttachment[];
  createdAt: string;
  updatedAt: string;
}

interface ProjectPluginEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  workspaceEnabled: boolean;
  userEnabled: boolean;
  enabled: boolean;
  linked: boolean;
  canManage: boolean;
}

const CORE_TASK_STATUSES = ["todo", "in_progress", "done"];
const TASK_STATUS_ORDER = [
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
];
const PRIORITIES = ["low", "medium", "high"];
type ProjectViewTab = "tasks" | "team" | "secrets";

const normalizeProjectTab = (value: string | null): ProjectViewTab => {
  if (value === "team" || value === "secrets" || value === "tasks")
    return value;
  return "tasks";
};

const defaultWorkflowConfig = (): WorkflowConfig => ({
  enabledStatuses: [...CORE_TASK_STATUSES],
  instructions: TASK_STATUS_ORDER.reduce<Record<string, string>>(
    (acc, status) => {
      acc[status] = "";
      return acc;
    },
    {},
  ),
});

const normalizeWorkflowConfig = (
  raw?: Partial<WorkflowConfig> | null,
): WorkflowConfig => {
  const defaults = defaultWorkflowConfig();
  const enabledSet = new Set<string>(CORE_TASK_STATUSES);
  for (const status of raw?.enabledStatuses || []) {
    if (TASK_STATUS_ORDER.includes(status)) {
      enabledSet.add(status);
    }
  }

  const instructions = { ...defaults.instructions };
  if (raw?.instructions) {
    for (const status of TASK_STATUS_ORDER) {
      const value = raw.instructions[status];
      if (typeof value === "string") instructions[status] = value;
    }
  }

  return {
    enabledStatuses: TASK_STATUS_ORDER.filter((status) =>
      enabledSet.has(status),
    ),
    instructions,
  };
};

const defaultProjectContext = (): ProjectContext => ({
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
});

const normalizeProjectContext = (
  raw?: Partial<ProjectContext> | null,
): ProjectContext => {
  const defaults = defaultProjectContext();
  const definitionOfDone = Array.isArray(raw?.definitionOfDone)
    ? raw.definitionOfDone
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .slice(0, 40)
    : defaults.definitionOfDone;
  const decisionLog = Array.isArray(raw?.decisionLog)
    ? raw.decisionLog
        .map((entry, index): DecisionLogEntry | null => {
          if (!entry || typeof entry !== "object") return null;
          const id =
            typeof entry.id === "string" && entry.id.trim()
              ? entry.id.trim()
              : `decision-${index + 1}`;
          const date =
            typeof entry.date === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(entry.date.trim())
              ? entry.date.trim()
              : "";
          const title =
            typeof entry.title === "string" ? entry.title.trim() : "";
          const decision =
            typeof entry.decision === "string" ? entry.decision.trim() : "";
          const rationale =
            typeof entry.rationale === "string" ? entry.rationale.trim() : "";
          if (!date && !title && !decision && !rationale) return null;
          return { id, date, title, decision, rationale };
        })
        .filter((entry): entry is DecisionLogEntry => Boolean(entry))
        .slice(0, 100)
    : defaults.decisionLog;
  const milestones = Array.isArray(raw?.milestones)
    ? raw.milestones
        .map((entry, index): MilestoneEntry | null => {
          if (!entry || typeof entry !== "object") return null;
          const id =
            typeof entry.id === "string" && entry.id.trim()
              ? entry.id.trim()
              : `milestone-${index + 1}`;
          const title =
            typeof entry.title === "string" ? entry.title.trim() : "";
          const dueDate =
            typeof entry.dueDate === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(entry.dueDate.trim())
              ? entry.dueDate.trim()
              : "";
          const status: MilestoneStatus =
            entry.status === "in_progress" || entry.status === "done"
              ? entry.status
              : "planned";
          const notes =
            typeof entry.notes === "string" ? entry.notes.trim() : "";
          if (!title && !dueDate && !notes) return null;
          return { id, title, dueDate, status, notes };
        })
        .filter((entry): entry is MilestoneEntry => Boolean(entry))
        .slice(0, 100)
    : defaults.milestones;
  const brief: Partial<ProjectBrief> =
    raw?.brief && typeof raw.brief === "object"
      ? (raw.brief as Partial<ProjectBrief>)
      : {};
  const runbook: Partial<ProjectRunbook> =
    raw?.runbook && typeof raw.runbook === "object"
      ? (raw.runbook as Partial<ProjectRunbook>)
      : {};

  const normalize = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";

  return {
    definitionOfDone,
    decisionLog,
    milestones,
    brief: {
      goal: normalize(brief.goal) || defaults.brief.goal,
      scope: normalize(brief.scope) || defaults.brief.scope,
      outOfScope: normalize(brief.outOfScope) || defaults.brief.outOfScope,
      successCriteria:
        normalize(brief.successCriteria) || defaults.brief.successCriteria,
    },
    runbook: {
      preferredLanguage:
        normalize(runbook.preferredLanguage) ||
        defaults.runbook.preferredLanguage,
      responseStyle:
        normalize(runbook.responseStyle) || defaults.runbook.responseStyle,
      constraints:
        normalize(runbook.constraints) || defaults.runbook.constraints,
      escalationPath:
        normalize(runbook.escalationPath) || defaults.runbook.escalationPath,
    },
  };
};

const normalizeUsedMemoryIds = (value: string): string[] =>
  Array.from(
    new Set(
      String(value || "")
        .split(/,|\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 40);

const authFileUrl = (url: string) => {
  if (!url?.startsWith("/uploads/")) return url;
  const filename = url.replace("/uploads/", "");
  const token = localStorage.getItem("triologue_token");
  return `/api/files/${filename}${token ? `?token=${token}` : ""}`;
};

const formatFileSize = (size?: number | null) => {
  if (!size || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const api = (path: string, opts?: RequestInit) => {
  const token = localStorage.getItem("triologue_token");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...((opts?.headers as Record<string, string>) || {}),
  };
  if (!(opts?.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(path, {
    ...opts,
    headers,
  });
};

export const ProjectDetailPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const { t } = useLanguage();
  const { theme } = useTheme();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const isDark = theme === "dark";

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectPlugins, setProjectPlugins] = useState<ProjectPluginEntry[]>(
    [],
  );
  const [loadingProjectPlugins, setLoadingProjectPlugins] = useState(false);
  const [updatingProjectPluginId, setUpdatingProjectPluginId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingProject, setDeletingProject] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [exportingProject, setExportingProject] = useState(false);

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState("medium");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");
  const [newTaskReviewer, setNewTaskReviewer] = useState("");
  const [newTaskFiles, setNewTaskFiles] = useState<File[]>([]);
  const [creatingTask, setCreatingTask] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [attachmentsTaskId, setAttachmentsTaskId] = useState<string | null>(
    null,
  );
  const [editTaskTitle, setEditTaskTitle] = useState("");
  const [editTaskDesc, setEditTaskDesc] = useState("");
  const [editTaskPriority, setEditTaskPriority] = useState("medium");
  const [editTaskAssignee, setEditTaskAssignee] = useState("");
  const [editTaskReviewer, setEditTaskReviewer] = useState("");
  const [editTaskMemoryIds, setEditTaskMemoryIds] = useState("");
  const [savingTaskEdit, setSavingTaskEdit] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [uploadingTaskAttachments, setUploadingTaskAttachments] = useState<
    Record<string, boolean>
  >({});
  const [deletingTaskAttachments, setDeletingTaskAttachments] = useState<
    Record<string, boolean>
  >({});
  const [uploadingProjectAttachments, setUploadingProjectAttachments] =
    useState(false);
  const [deletingProjectAttachments, setDeletingProjectAttachments] = useState<
    Record<string, boolean>
  >({});
  const [showProjectAttachmentsModal, setShowProjectAttachmentsModal] =
    useState(false);

  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");
  const [inviting, setInviting] = useState(false);

  const [activeTab, setActiveTab] = useState<ProjectViewTab>(() =>
    normalizeProjectTab(tabParam),
  );

  const isOwner = Boolean(project && user && project.ownerId === user.id);
  const isTeamMember = Boolean(
    project && user && project.teamMemberIds.includes(user.id),
  );
  const projectContext = useMemo(
    () => normalizeProjectContext(project?.projectContext),
    [project?.projectContext],
  );
  const workflowConfig = useMemo(
    () => normalizeWorkflowConfig(project?.workflowConfig),
    [project?.workflowConfig],
  );
  const activeTaskStatuses = useMemo(
    () =>
      TASK_STATUS_ORDER.filter((status) =>
        workflowConfig.enabledStatuses.includes(status),
      ),
    [workflowConfig.enabledStatuses],
  );

  const teamMembers = useMemo(() => {
    if (!project) return [];
    return project.teamMembers || [];
  }, [project]);

  const teamMemberLookup = useMemo(() => {
    const map = new Map<string, TeamMember>();
    teamMembers.forEach((m) => map.set(m.id, m));
    return map;
  }, [teamMembers]);

  const getUserTypeLabel = (
    userType?: TeamMember["userType"] | string | null,
  ) => {
    if (!userType) return "";
    switch (userType) {
      case "HUMAN":
        return t("projects.userType.human");
      case "AI_AGENT":
        return t("projects.userType.ai_agent");
      case "AI_ICE":
        return t("projects.userType.ai_ice");
      case "AI_LAVA":
        return t("projects.userType.ai_lava");
      case "AI_OTHER":
        return t("projects.userType.ai_other");
      default:
        return userType;
    }
  };

  useEffect(() => {
    if (projectId) loadProject();
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void loadProjectPlugins();
  }, [projectId]);

  useEffect(() => {
    const nextTab = normalizeProjectTab(tabParam);
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [tabParam]);

  useEffect(() => {
    if (!project || !user) return;
    if (newTaskAssignee) return;
    if (project.teamMemberIds.includes(user.id)) {
      setNewTaskAssignee(user.id);
      return;
    }
    if (project.teamMemberIds.length > 0) {
      setNewTaskAssignee(project.teamMemberIds[0]);
    }
  }, [project, user, newTaskAssignee]);

  const loadProject = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProject({
          ...data,
          workflowConfig: normalizeWorkflowConfig(data.workflowConfig),
          projectContext: normalizeProjectContext(data.projectContext),
        });
        setTasks(data.tasks || []);
        setError("");
      } else {
        setError(t("projects.detail.notFound"));
      }
    } catch (err) {
      setError(t("projects.detail.loadError"));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadProjectPlugins = async () => {
    if (!projectId) return;
    setLoadingProjectPlugins(true);
    try {
      const res = await api(`/api/plugins/projects/${projectId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProjectPlugins([]);
        return;
      }

      const plugins = Array.isArray(data?.plugins) ? data.plugins : [];
      const normalized: ProjectPluginEntry[] = plugins.map((entry: any) => ({
        id: String(entry?.id || ""),
        name: String(
          entry?.name || entry?.id || t("projects.plugins.fallbackName"),
        ),
        version: String(entry?.version || "0.0.0"),
        description:
          typeof entry?.description === "string" ? entry.description : "",
        workspaceEnabled: entry?.workspaceEnabled !== false,
        userEnabled: entry?.userEnabled !== false,
        enabled: entry?.enabled !== false,
        linked: Boolean(entry?.linked),
        canManage: Boolean(entry?.canManage),
      }));
      setProjectPlugins(normalized);
    } catch (error) {
      setProjectPlugins([]);
    } finally {
      setLoadingProjectPlugins(false);
    }
  };

  const toggleProjectPluginLink = async (pluginId: string, linked: boolean) => {
    if (!projectId) return;
    setUpdatingProjectPluginId(pluginId);
    try {
      const res = await api(`/api/plugins/projects/${projectId}/${pluginId}`, {
        method: "PATCH",
        body: JSON.stringify({ linked }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || t("projects.detail.loadError"));
        return;
      }

      setProjectPlugins((prev) =>
        prev.map((plugin) =>
          plugin.id === pluginId ? { ...plugin, linked } : plugin,
        ),
      );
      toast.success(
        linked
          ? t("projects.plugins.toastLinked")
          : t("projects.plugins.toastUnlinked"),
      );
    } catch (error) {
      toast.error(t("projects.detail.loadError"));
    } finally {
      setUpdatingProjectPluginId(null);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !projectId || !newTaskAssignee) return;
    setCreatingTask(true);
    try {
      const res = await api(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: newTaskTitle,
          description: newTaskDesc,
          priority: newTaskPriority,
          assignedTo: newTaskAssignee,
          reviewedBy: newTaskReviewer || null,
        }),
      });

      const createdTaskData = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(createdTaskData.error || t("projects.task.create.failed"));
        return;
      }

      let latestTask = createdTaskData;
      let failedUploads = 0;

      if (newTaskFiles.length > 0) {
        for (const file of newTaskFiles) {
          const formData = new FormData();
          formData.append("file", file);

          const uploadRes = await api(
            `/api/projects/${projectId}/tasks/${createdTaskData.id}/attachments`,
            {
              method: "POST",
              body: formData,
            },
          );
          const uploadData = await uploadRes.json().catch(() => ({}));

          if (!uploadRes.ok) {
            failedUploads += 1;
            continue;
          }

          if (uploadData?.task) {
            latestTask = uploadData.task;
          }
        }
      }

      if (failedUploads > 0) {
        toast.error(t("projects.task.attachment.uploadPartialFailed"));
      }

      setTasks((prev) => [...prev, latestTask]);
      setNewTaskTitle("");
      setNewTaskDesc("");
      setNewTaskPriority("medium");
      setNewTaskReviewer("");
      setNewTaskFiles([]);
      if (user?.id && project?.teamMemberIds.includes(user.id)) {
        setNewTaskAssignee(user.id);
      }
      setShowCreateTask(false);
    } catch (err) {
      console.error(err);
      toast.error(t("projects.task.create.failed"));
    } finally {
      setCreatingTask(false);
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, newStatus: string) => {
    if (!projectId) return;
    try {
      const res = await api(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t("projects.task.update.failed"));
        return;
      }
      setTasks((prev) =>
        prev.map((task) => (task.id === taskId ? data : task)),
      );
    } catch (err) {
      console.error(err);
      toast.error(t("projects.task.update.failed"));
    }
  };

  const handleTaskAttachmentUpload = async (taskId: string, files: File[]) => {
    if (!projectId || files.length === 0) return;

    setUploadingTaskAttachments((prev) => ({ ...prev, [taskId]: true }));
    let latestTask: Task | null = null;
    let failedUploads = 0;

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await api(
          `/api/projects/${projectId}/tasks/${taskId}/attachments`,
          {
            method: "POST",
            body: formData,
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          failedUploads += 1;
          continue;
        }
        if (data?.task) {
          latestTask = data.task;
        }
      }

      if (latestTask) {
        setTasks((prev) =>
          prev.map((task) => (task.id === taskId ? latestTask! : task)),
        );
      }

      if (failedUploads > 0) {
        toast.error(
          failedUploads === files.length
            ? t("projects.task.attachment.uploadFailed")
            : t("projects.task.attachment.uploadPartialFailed"),
        );
      }
    } catch (err) {
      console.error(err);
      toast.error(t("projects.task.attachment.uploadFailed"));
    } finally {
      setUploadingTaskAttachments((prev) => ({ ...prev, [taskId]: false }));
    }
  };

  const handleTaskAttachmentDelete = async (
    taskId: string,
    attachmentId: string,
  ) => {
    if (!projectId) return;

    const key = `${taskId}:${attachmentId}`;
    setDeletingTaskAttachments((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await api(
        `/api/projects/${projectId}/tasks/${taskId}/attachments/${attachmentId}`,
        {
          method: "DELETE",
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t("projects.task.attachment.deleteFailed"));
        return;
      }

      if (data?.task) {
        setTasks((prev) =>
          prev.map((task) => (task.id === taskId ? data.task : task)),
        );
      }
    } catch (err) {
      console.error(err);
      toast.error(t("projects.task.attachment.deleteFailed"));
    } finally {
      setDeletingTaskAttachments((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleProjectAttachmentUpload = async (files: File[]) => {
    if (!projectId || files.length === 0) return;

    setUploadingProjectAttachments(true);
    const uploaded: ProjectAttachment[] = [];
    let failedUploads = 0;

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);

        const res = await api(`/api/projects/${projectId}/attachments`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          failedUploads += 1;
          continue;
        }
        if (data?.attachment) {
          uploaded.push(data.attachment);
        }
      }

      if (uploaded.length > 0) {
        setProject((prev) =>
          prev
            ? {
                ...prev,
                attachments: [...uploaded, ...(prev.attachments || [])],
              }
            : prev,
        );
      }

      if (failedUploads > 0) {
        toast.error(
          failedUploads === files.length
            ? t("projects.attachments.uploadFailed")
            : t("projects.attachments.uploadPartialFailed"),
        );
      }
    } catch (err) {
      console.error(err);
      toast.error(t("projects.attachments.uploadFailed"));
    } finally {
      setUploadingProjectAttachments(false);
    }
  };

  const handleProjectAttachmentDelete = async (attachmentId: string) => {
    if (!projectId) return;

    setDeletingProjectAttachments((prev) => ({
      ...prev,
      [attachmentId]: true,
    }));
    try {
      const res = await api(
        `/api/projects/${projectId}/attachments/${attachmentId}`,
        {
          method: "DELETE",
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t("projects.attachments.deleteFailed"));
        return;
      }

      setProject((prev) =>
        prev
          ? {
              ...prev,
              attachments: (prev.attachments || []).filter(
                (attachment) => attachment.id !== attachmentId,
              ),
            }
          : prev,
      );
    } catch (err) {
      console.error(err);
      toast.error(t("projects.attachments.deleteFailed"));
    } finally {
      setDeletingProjectAttachments((prev) => ({
        ...prev,
        [attachmentId]: false,
      }));
    }
  };

  const startEditTask = (task: Task) => {
    setEditingTaskId(task.id);
    setEditTaskTitle(task.title || "");
    setEditTaskDesc(task.description || "");
    setEditTaskPriority(task.priority || "medium");
    setEditTaskAssignee(task.assignedTo || "");
    setEditTaskReviewer(task.reviewedBy || "");
    setEditTaskMemoryIds(
      Array.isArray(task.usedMemoryIds) ? task.usedMemoryIds.join(", ") : "",
    );
  };

  const cancelEditTask = () => {
    if (savingTaskEdit) return;
    setEditingTaskId(null);
    setEditTaskTitle("");
    setEditTaskDesc("");
    setEditTaskPriority("medium");
    setEditTaskAssignee("");
    setEditTaskReviewer("");
    setEditTaskMemoryIds("");
  };

  const saveTaskEdit = async (taskId: string) => {
    if (!projectId || !editTaskTitle.trim() || !editTaskAssignee) return;
    setSavingTaskEdit(true);
    try {
      const res = await api(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: "PUT",
        body: JSON.stringify({
          title: editTaskTitle.trim(),
          description: editTaskDesc.trim() || null,
          priority: editTaskPriority,
          assignedTo: editTaskAssignee,
          reviewedBy: editTaskReviewer || null,
          usedMemoryIds: normalizeUsedMemoryIds(editTaskMemoryIds),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t("projects.task.update.failed"));
        return;
      }
      setTasks((prev) =>
        prev.map((task) => (task.id === taskId ? data : task)),
      );
      setEditingTaskId(null);
      setEditTaskTitle("");
      setEditTaskDesc("");
      setEditTaskPriority("medium");
      setEditTaskAssignee("");
      setEditTaskReviewer("");
      setEditTaskMemoryIds("");
    } catch (err) {
      console.error(err);
      toast.error(t("projects.task.update.failed"));
    } finally {
      setSavingTaskEdit(false);
    }
  };

  const requestDeleteTask = (taskId: string) => {
    setDeleteTaskId(taskId);
  };

  const confirmDeleteTask = async () => {
    if (!projectId || !deleteTaskId) return;
    setDeletingTask(true);
    try {
      const res = await api(
        `/api/projects/${projectId}/tasks/${deleteTaskId}`,
        {
          method: "DELETE",
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t("projects.task.delete.failed"));
        return;
      }
      setTasks((prev) => prev.filter((task) => task.id !== deleteTaskId));
      if (editingTaskId === deleteTaskId) {
        cancelEditTask();
      }
      setDeleteTaskId(null);
    } catch (err) {
      console.error(err);
      toast.error(t("projects.task.delete.failed"));
    } finally {
      setDeletingTask(false);
    }
  };

  const handleDeleteProject = () => {
    if (!projectId || !project) return;
    setShowDeleteDialog(true);
  };

  const confirmDeleteProject = async () => {
    if (!projectId || !project) return;
    const failedText = t("projects.delete.failed");

    setDeletingProject(true);
    try {
      const res = await api(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      navigate("/projects");
    } catch (err) {
      console.error(err);
      toast.error(failedText);
    } finally {
      setDeletingProject(false);
    }
  };

  const handleExportProject = async () => {
    if (!projectId || exportingProject) return;
    setExportingProject(true);

    try {
      const res = await api(`/api/projects/${projectId}/export`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Export failed");
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition") || "";
      const fileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
      const fileName = fileNameMatch?.[1] || `project-${projectId}-export.md`;

      const fileUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = fileUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(fileUrl);
    } catch (err) {
      console.error(err);
      toast.error(t("projects.export.failed"));
    } finally {
      setExportingProject(false);
    }
  };

  const handleInvite = async (payload: { username: string }) => {
    if (!projectId) return;
    setInviteStatus("");
    setInviting(true);
    try {
      const res = await api(`/api/projects/${projectId}/team/invite`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteStatus(data.error || t("projects.team.invite.failed"));
        return;
      }

      setInviteStatus(t("projects.team.invite.success"));
      setInviteUsername("");
      await loadProject();
    } catch (err) {
      console.error(err);
      setInviteStatus(t("projects.team.invite.networkError"));
    } finally {
      setInviting(false);
    }
  };

  const getTasksByStatus = (status: string) =>
    tasks.filter((task) => task.status === status);
  const editingTask = useMemo(
    () => tasks.find((task) => task.id === editingTaskId) || null,
    [tasks, editingTaskId],
  );
  const attachmentsTask = useMemo(
    () => tasks.find((task) => task.id === attachmentsTaskId) || null,
    [tasks, attachmentsTaskId],
  );
  const projectAttachments = useMemo(
    () => project?.attachments || [],
    [project],
  );
  const taskToDelete = useMemo(
    () => tasks.find((task) => task.id === deleteTaskId) || null,
    [tasks, deleteTaskId],
  );

  useEffect(() => {
    if (!attachmentsTaskId) return;
    if (!tasks.some((task) => task.id === attachmentsTaskId)) {
      setAttachmentsTaskId(null);
    }
  }, [attachmentsTaskId, tasks]);

  const textAreaCls = `w-full rounded-lg border px-3 py-2 text-sm ${
    isDark
      ? "border-gray-600/50 bg-gray-700 text-white placeholder-gray-400"
      : "border-gray-300/60 bg-white"
  } outline-none focus:ring-2 focus:ring-blue-500`;

  const tabLabels: Record<string, string> = {
    tasks: t("projects.tab.tasks"),
    team: t("projects.tab.team"),
    secrets: t("projects.tab.secrets"),
  };

  const handleTabChange = (tab: ProjectViewTab) => {
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams);
    if (tab === "tasks") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", tab);
    }
    setSearchParams(nextParams, { replace: true });
  };

  if (loading) {
    return (
      <PageShell maxWidth="6xl">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      </PageShell>
    );
  }

  if (error || !project) {
    return (
      <PageShell maxWidth="6xl">
        <EmptyState
          icon="⚠️"
          title={error || t("projects.detail.notFound")}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => navigate("/projects")}
            >
              {t("projects.detail.backToList")}
            </Button>
          }
        />
      </PageShell>
    );
  }

  return (
    <>
      <PageShell
        maxWidth="6xl"
        title={
          <span className="inline-flex items-center gap-2">
            📋 {project.name}
          </span>
        }
        subtitle={project.description || t("projects.description")}
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => navigate("/projects")}
              className="h-8 px-3 whitespace-nowrap"
            >
              {t("projects.detail.backToList")}
            </Button>
            {(isOwner || isTeamMember) && (
              <Button
                type="button"
                onClick={handleExportProject}
                variant="secondary"
                size="sm"
                disabled={exportingProject}
                className="h-8 min-w-[92px] justify-center whitespace-nowrap"
              >
                {exportingProject
                  ? t("projects.actions.exporting")
                  : t("projects.actions.export")}
              </Button>
            )}
            {isOwner && (
              <>
                <Button
                  type="button"
                  onClick={() => navigate(`/projects/${project.id}/edit`)}
                  variant="secondary"
                  size="sm"
                  className="h-8 min-w-[92px] justify-center whitespace-nowrap"
                >
                  {t("projects.actions.edit")}
                </Button>
                <Button
                  type="button"
                  onClick={handleDeleteProject}
                  disabled={deletingProject}
                  variant="danger"
                  size="sm"
                  className="h-8 min-w-[92px] justify-center whitespace-nowrap"
                >
                  {deletingProject
                    ? t("projects.actions.deleting")
                    : t("projects.actions.delete")}
                </Button>
              </>
            )}
          </>
        }
      >
        <div className="space-y-4 sm:space-y-5">
          <Card className="p-4 sm:p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide">
              {t("projects.detail.status")}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div
                className={`rounded-lg border px-3 py-2 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-white"}`}
              >
                <div
                  className={`text-[11px] uppercase tracking-wide ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("projects.detail.status")}
                </div>
                <div className="mt-1">
                  <Badge variant={projectStatusBadgeVariant(project.status)}>
                    {t(`projects.status.${project.status}`) || project.status}
                  </Badge>
                </div>
              </div>
              <div
                className={`rounded-lg border px-3 py-2 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-white"}`}
              >
                <div
                  className={`text-[11px] uppercase tracking-wide ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("projects.detail.created")}
                </div>
                <div
                  className={`mt-1 text-sm ${isDark ? "text-gray-200" : "text-gray-800"}`}
                >
                  {new Date(project.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div
                className={`rounded-lg border px-3 py-2 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-white"}`}
              >
                <div
                  className={`text-[11px] uppercase tracking-wide ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("projects.room.linked")}
                </div>
                {project.roomId ? (
                  <div className="mt-1 space-y-1">
                    <div
                      className="break-all font-mono text-xs sm:text-sm text-blue-400"
                      title={project.roomId}
                    >
                      {project.roomId}
                    </div>
                    <Link
                      to={`/room/${project.roomId}`}
                      className={`inline-flex text-xs font-medium ${isDark ? "text-blue-300 hover:text-blue-200" : "text-blue-700 hover:text-blue-600"}`}
                      aria-label={t("projects.a11y.openRoom").replace(
                        "{name}",
                        project.roomId,
                      )}
                    >
                      {t("projects.actions.room")}
                    </Link>
                  </div>
                ) : (
                  <div
                    className={`mt-1 text-sm ${isDark ? "text-gray-300" : "text-gray-600"}`}
                  >
                    {t("projects.room.none")}
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <SectionHeader
              title={t("projects.plugins.title")}
              actions={<Badge variant="neutral">{projectPlugins.length}</Badge>}
              className="mb-3"
            />
            {loadingProjectPlugins ? (
              <div
                className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                {t("common.loading")}
              </div>
            ) : projectPlugins.length === 0 ? (
              <div
                className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
              >
                {t("projects.plugins.empty")}
              </div>
            ) : (
              <div className="space-y-2">
                {projectPlugins.map((plugin) => {
                  const canOpen = plugin.linked && plugin.enabled;
                  const isToggling = updatingProjectPluginId === plugin.id;
                  return (
                    <div
                      key={plugin.id}
                      className={`rounded border px-3 py-2 ${isDark ? "border-gray-700/50 bg-gray-800/60" : "border-gray-200/60 bg-gray-50"}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-sm font-medium ${isDark ? "text-gray-100" : "text-gray-800"}`}
                        >
                          {plugin.name}
                        </span>
                        <Badge variant={plugin.linked ? "success" : "neutral"}>
                          {plugin.linked
                            ? t("projects.plugins.linked")
                            : t("projects.plugins.unlinked")}
                        </Badge>
                        {!plugin.workspaceEnabled && (
                          <Badge variant="warning">
                            {t("projects.plugins.globallyDisabled")}
                          </Badge>
                        )}
                        {plugin.workspaceEnabled && !plugin.userEnabled && (
                          <Badge variant="warning">
                            {t("projects.plugins.disabledForYou")}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {canOpen && (
                          <Link
                            to={`/plugins/${plugin.id}?projectId=${project.id}`}
                            className={`inline-flex text-xs font-medium ${
                              isDark
                                ? "text-emerald-300 hover:text-emerald-200"
                                : "text-emerald-700 hover:text-emerald-600"
                            }`}
                          >
                            {t("projects.plugins.openModule")}
                          </Link>
                        )}
                        {plugin.canManage && (
                          <Button
                            type="button"
                            size="sm"
                            variant={plugin.linked ? "secondary" : "primary"}
                            disabled={isToggling}
                            onClick={() =>
                              void toggleProjectPluginLink(
                                plugin.id,
                                !plugin.linked,
                              )
                            }
                            className="h-7 px-2.5 text-xs"
                          >
                            {isToggling
                              ? t("common.loading")
                              : plugin.linked
                                ? t("projects.plugins.disconnect")
                                : t("projects.plugins.connect")}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <SectionHeader
              title={t("projects.attachments.title")}
              className="mb-3"
              actions={
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowProjectAttachmentsModal(true)}
                >
                  {t("projects.attachments.manage")}
                </Button>
              }
            />
            <div className="space-y-2">
              {projectAttachments.length === 0 ? (
                <div
                  className={`text-sm ${isDark ? "text-gray-300" : "text-gray-600"}`}
                >
                  {t("projects.attachments.empty")}
                </div>
              ) : (
                <>
                  {projectAttachments.slice(0, 4).map((attachment) => (
                    <a
                      key={attachment.id}
                      href={authFileUrl(attachment.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`block rounded border px-2 py-1.5 text-xs transition-all duration-200 ${
                        isDark
                          ? "border-gray-700/50 bg-gray-800 hover:bg-gray-700 text-blue-300"
                          : "border-gray-200/60 bg-white hover:bg-gray-50 text-blue-600"
                      }`}
                      title={attachment.filename}
                    >
                      <div className="truncate">{attachment.filename}</div>
                      <div
                        className={isDark ? "text-gray-400" : "text-gray-500"}
                      >
                        {formatFileSize(attachment.size)}
                      </div>
                    </a>
                  ))}
                  {projectAttachments.length > 4 && (
                    <div
                      className={`text-[11px] ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {t("projects.attachments.more").replace(
                        "{count}",
                        String(projectAttachments.length - 4),
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>

          <Card className="p-4 sm:p-5">
            <SectionHeader
              title={t("projects.context.title")}
              className="mb-3"
              actions={
                isOwner ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => navigate(`/projects/${project.id}/edit`)}
                  >
                    {t("projects.actions.edit")}
                  </Button>
                ) : undefined
              }
            />
            <div className="space-y-3">
              <div
                className={`rounded-lg border px-3 py-3 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-white"}`}
              >
                <div
                  className={`mb-2 text-[11px] uppercase tracking-wide ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  {t("projects.context.dod.title")}
                </div>
                {projectContext.definitionOfDone.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {projectContext.definitionOfDone.map((item, index) => (
                      <li
                        key={`${item}-${index}`}
                        className={isDark ? "text-gray-100" : "text-gray-800"}
                      >
                        - {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div
                    className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
                  >
                    {t("projects.context.empty")}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div
                  className={`rounded-lg border px-3 py-3 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-white"}`}
                >
                  <div
                    className={`mb-2 text-[11px] uppercase tracking-wide ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {t("projects.context.decision.title")}
                  </div>
                  {projectContext.decisionLog.length > 0 ? (
                    <div className="space-y-2">
                      {projectContext.decisionLog.map((entry) => (
                        <div
                          key={entry.id}
                          className={`rounded border px-2 py-2 text-xs ${isDark ? "border-gray-700/50 bg-gray-800" : "border-gray-200/60 bg-gray-50"}`}
                        >
                          <div
                            className={`font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}
                          >
                            {entry.date || t("projects.context.empty")} -{" "}
                            {entry.title || t("projects.context.empty")}
                          </div>
                          <div
                            className={`${isDark ? "text-gray-300" : "text-gray-700"}`}
                          >
                            {entry.decision || t("projects.context.empty")}
                          </div>
                          <div
                            className={
                              isDark ? "text-gray-400" : "text-gray-600"
                            }
                          >
                            {entry.rationale || t("projects.context.empty")}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
                    >
                      {t("projects.context.empty")}
                    </div>
                  )}
                </div>

                <div
                  className={`rounded-lg border px-3 py-3 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-white"}`}
                >
                  <div
                    className={`mb-2 text-[11px] uppercase tracking-wide ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {t("projects.context.milestones.title")}
                  </div>
                  {projectContext.milestones.length > 0 ? (
                    <div className="space-y-2">
                      {projectContext.milestones.map((entry) => (
                        <div
                          key={entry.id}
                          className={`rounded border px-2 py-2 text-xs ${isDark ? "border-gray-700/50 bg-gray-800" : "border-gray-200/60 bg-gray-50"}`}
                        >
                          <div
                            className={`font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}
                          >
                            {entry.title || t("projects.context.empty")}
                          </div>
                          <div
                            className={
                              isDark ? "text-gray-300" : "text-gray-700"
                            }
                          >
                            {entry.dueDate || t("projects.context.empty")} -{" "}
                            {t(
                              `projects.context.milestones.status.${entry.status}`,
                            )}
                          </div>
                          <div
                            className={
                              isDark ? "text-gray-400" : "text-gray-600"
                            }
                          >
                            {entry.notes || t("projects.context.empty")}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      className={`text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}
                    >
                      {t("projects.context.empty")}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div
                  className={`rounded-lg border px-3 py-3 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-white"}`}
                >
                  <div
                    className={`mb-2 text-[11px] uppercase tracking-wide ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {t("projects.context.brief.title")}
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <div
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {t("projects.context.brief.goal")}
                      </div>
                      <div
                        className={isDark ? "text-gray-100" : "text-gray-800"}
                      >
                        {projectContext.brief.goal ||
                          t("projects.context.empty")}
                      </div>
                    </div>
                    <div>
                      <div
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {t("projects.context.brief.scope")}
                      </div>
                      <div
                        className={isDark ? "text-gray-100" : "text-gray-800"}
                      >
                        {projectContext.brief.scope ||
                          t("projects.context.empty")}
                      </div>
                    </div>
                    <div>
                      <div
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {t("projects.context.brief.outOfScope")}
                      </div>
                      <div
                        className={isDark ? "text-gray-100" : "text-gray-800"}
                      >
                        {projectContext.brief.outOfScope ||
                          t("projects.context.empty")}
                      </div>
                    </div>
                    <div>
                      <div
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {t("projects.context.brief.successCriteria")}
                      </div>
                      <div
                        className={isDark ? "text-gray-100" : "text-gray-800"}
                      >
                        {projectContext.brief.successCriteria ||
                          t("projects.context.empty")}
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className={`rounded-lg border px-3 py-3 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-white"}`}
                >
                  <div
                    className={`mb-2 text-[11px] uppercase tracking-wide ${isDark ? "text-gray-400" : "text-gray-500"}`}
                  >
                    {t("projects.context.runbook.title")}
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <div
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {t("projects.context.runbook.preferredLanguage")}
                      </div>
                      <div
                        className={isDark ? "text-gray-100" : "text-gray-800"}
                      >
                        {projectContext.runbook.preferredLanguage ||
                          t("projects.context.empty")}
                      </div>
                    </div>
                    <div>
                      <div
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {t("projects.context.runbook.responseStyle")}
                      </div>
                      <div
                        className={isDark ? "text-gray-100" : "text-gray-800"}
                      >
                        {projectContext.runbook.responseStyle ||
                          t("projects.context.empty")}
                      </div>
                    </div>
                    <div>
                      <div
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {t("projects.context.runbook.constraints")}
                      </div>
                      <div
                        className={isDark ? "text-gray-100" : "text-gray-800"}
                      >
                        {projectContext.runbook.constraints ||
                          t("projects.context.empty")}
                      </div>
                    </div>
                    <div>
                      <div
                        className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {t("projects.context.runbook.escalationPath")}
                      </div>
                      <div
                        className={isDark ? "text-gray-100" : "text-gray-800"}
                      >
                        {projectContext.runbook.escalationPath ||
                          t("projects.context.empty")}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
        <Card className="mt-4 sm:mt-5 p-1.5 sm:p-2">
          <div
            role="tablist"
            aria-label={t("projects.title")}
            className={`flex flex-wrap gap-1 border-b px-1 ${isDark ? "border-gray-700/50" : "border-gray-200/60"}`}
          >
            {(["tasks", "team", "secrets"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => handleTabChange(tab)}
                className={`rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-all duration-200 ${
                  activeTab === tab
                    ? isDark
                      ? "border-blue-400 text-blue-300 bg-gray-800"
                      : "border-blue-600 text-blue-700 bg-white"
                    : isDark
                      ? "border-transparent text-gray-300 hover:text-white hover:bg-gray-800/70"
                      : "border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                {tabLabels[tab]}
              </button>
            ))}
            <Link
              to={`/projects/${project.id}/activity`}
              className={`rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-all duration-200 border-transparent ${
                isDark
                  ? "text-gray-300 hover:text-white hover:bg-gray-800/70"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              Aktivität
            </Link>
          </div>
        </Card>

        <div className="mt-4 sm:mt-5">
          {activeTab === "tasks" && (
            <Card className="p-4 sm:p-6 space-y-5">
              {!showCreateTask && (
                <div className="mb-4 sm:mb-6 flex flex-wrap gap-2">
                  {isTeamMember && (
                    <Button
                      onClick={() => setShowCreateTask(true)}
                      className="h-9 whitespace-nowrap"
                    >
                      {t("projects.task.add")}
                    </Button>
                  )}
                  {isOwner && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-9 whitespace-nowrap"
                      onClick={() => navigate(`/projects/${project.id}/edit`)}
                    >
                      {t("projects.actions.edit")}
                    </Button>
                  )}
                </div>
              )}

              {showCreateTask && isTeamMember && (
                <form
                  onSubmit={handleCreateTask}
                  className={`mb-6 rounded-lg border-l-4 border-blue-500 p-3 sm:p-4 ${isDark ? "bg-gray-800" : "bg-blue-50"}`}
                >
                  <label
                    className={`mb-1 block text-xs font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
                  >
                    {t("projects.task.title.placeholder")}{" "}
                    <span className="text-red-400">*</span>
                  </label>
                  <Input
                    type="text"
                    placeholder={t("projects.task.title.placeholder")}
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    className="mb-3"
                    autoFocus
                    required
                  />
                  <textarea
                    placeholder={t("projects.task.description.placeholder")}
                    value={newTaskDesc}
                    onChange={(e) => setNewTaskDesc(e.target.value)}
                    className={`${textAreaCls} mb-3`}
                    rows={3}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                    <Select
                      value={newTaskPriority}
                      onChange={(value) => setNewTaskPriority(value)}
                      options={PRIORITIES.map((priority) => ({
                        value: priority,
                        label: t(`projects.priority.${priority}`),
                      }))}
                    />

                    <Select
                      value={newTaskAssignee}
                      onChange={(value) => setNewTaskAssignee(value)}
                      options={project.teamMemberIds.map((memberId) => {
                        const member = teamMemberLookup.get(memberId);
                        const label = member
                          ? `${member.displayName} (@${member.username})`
                          : memberId;
                        return {
                          value: memberId,
                          label,
                        };
                      })}
                    />

                    <Select
                      value={newTaskReviewer}
                      onChange={(value) => setNewTaskReviewer(value)}
                      options={[
                        { value: "", label: "No reviewer" },
                        ...project.teamMemberIds.map((memberId) => {
                          const member = teamMemberLookup.get(memberId);
                          const label = member
                            ? `${member.displayName} (@${member.username})`
                            : memberId;
                          return {
                            value: memberId,
                            label,
                          };
                        }),
                      ]}
                    />
                  </div>

                  <div className="mb-4">
                    <div
                      className={`mb-1 text-xs font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
                    >
                      {t("projects.task.attachments")}
                    </div>
                    <label
                      className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs ${
                        isDark
                          ? "border-gray-600/50 bg-gray-800 text-gray-200 hover:bg-gray-700"
                          : "border-gray-300/60 bg-white text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const selected = Array.from(e.target.files || []);
                          if (selected.length > 0) {
                            setNewTaskFiles((prev) => {
                              const next = [...prev];
                              for (const file of selected) {
                                const exists = prev.some(
                                  (existing) =>
                                    existing.name === file.name &&
                                    existing.size === file.size &&
                                    existing.lastModified === file.lastModified,
                                );
                                if (!exists) next.push(file);
                              }
                              return next;
                            });
                          }
                          e.currentTarget.value = "";
                        }}
                      />
                      {t("projects.task.attachment.add")}
                    </label>
                    <div
                      className={`mt-1 text-[11px] ${isDark ? "text-gray-400" : "text-gray-500"}`}
                    >
                      {t("projects.task.attachment.createHint")}
                    </div>
                    {newTaskFiles.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {newTaskFiles.map((file, index) => (
                          <div
                            key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                            className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs ${
                              isDark
                                ? "border-gray-700/50 bg-gray-900 text-gray-200"
                                : "border-gray-200/60 bg-white text-gray-700"
                            }`}
                          >
                            <span className="truncate">{file.name}</span>
                            <button
                              type="button"
                              className={
                                isDark
                                  ? "text-red-300 hover:text-red-200"
                                  : "text-red-600 hover:text-red-500"
                              }
                              onClick={() => {
                                setNewTaskFiles((prev) =>
                                  prev.filter(
                                    (_, fileIndex) => fileIndex !== index,
                                  ),
                                );
                              }}
                            >
                              {t("projects.task.attachment.removeSelected")}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button type="submit" disabled={creatingTask}>
                      {creatingTask
                        ? t("projects.task.creating")
                        : t("projects.create")}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        if (creatingTask) return;
                        setShowCreateTask(false);
                        setNewTaskReviewer("");
                        setNewTaskFiles([]);
                      }}
                      variant="secondary"
                      disabled={creatingTask}
                    >
                      {t("projects.cancel")}
                    </Button>
                  </div>
                </form>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4">
                {activeTaskStatuses.map((status) => {
                  const statusTasks = getTasksByStatus(status);
                  return (
                    <Card
                      key={status}
                      tone="muted"
                      className="p-4 min-h-[240px]"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const taskId = e.dataTransfer.getData("taskId");
                        if (taskId) handleUpdateTaskStatus(taskId, status);
                      }}
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-xs uppercase tracking-wide">
                          {t(`projects.status.${status}`) ||
                            status.replace("_", " ")}
                        </h3>
                        <Badge variant="neutral">{statusTasks.length}</Badge>
                      </div>
                      {workflowConfig.instructions[status]?.trim() && (
                        <div
                          className={`mb-3 rounded border px-2 py-1 text-[11px] leading-4 break-words [overflow-wrap:anywhere] ${isDark ? "border-gray-700/50 text-gray-400" : "border-gray-200/60 text-gray-600"}`}
                        >
                          {workflowConfig.instructions[status]}
                        </div>
                      )}
                      {statusTasks.length === 0 ? (
                        <div
                          className={`rounded-lg border border-dashed px-3 py-5 text-center text-xs ${isDark ? "border-gray-700/50 text-gray-500" : "border-gray-300/60 text-gray-400"}`}
                        >
                          {t("projects.task.emptyColumn")}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {statusTasks.map((task) => {
                            const assignedMember = teamMemberLookup.get(
                              task.assignedTo,
                            );
                            const reviewerMember =
                              task.reviewer ||
                              (task.reviewedBy
                                ? teamMemberLookup.get(task.reviewedBy)
                                : null);
                            const canDrag = user?.id === task.assignedTo;
                            const canEditTask = Boolean(
                              isOwner || user?.id === task.assignedTo,
                            );

                            return (
                              <Card
                                key={task.id}
                                className={`p-3 overflow-hidden ${
                                  canDrag
                                    ? isDark
                                      ? "cursor-move hover:bg-gray-700"
                                      : "cursor-move hover:shadow-sm"
                                    : "cursor-not-allowed opacity-90"
                                } transition-all`}
                                draggable={canDrag}
                                onDragStart={(e) => {
                                  if (!canDrag) return;
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("taskId", task.id);
                                }}
                              >
                                <div className="font-medium text-sm leading-5 break-words [overflow-wrap:anywhere]">
                                  {task.title}
                                </div>
                                {task.description && (
                                  <div
                                    className={`text-xs mt-1.5 break-words [overflow-wrap:anywhere] overflow-hidden line-clamp-3 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                                  >
                                    {task.description}
                                  </div>
                                )}

                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                  <div
                                    className={`text-xs ${isDark ? "text-gray-300" : "text-gray-600"}`}
                                  >
                                    📎 {task.attachments?.length || 0}{" "}
                                    {t("projects.task.attachments")}
                                  </div>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="h-8 whitespace-nowrap"
                                    onClick={() =>
                                      setAttachmentsTaskId(task.id)
                                    }
                                  >
                                    {t("projects.task.attachment.manage")}
                                  </Button>
                                </div>

                                <div
                                  className={`text-xs mt-2 break-words [overflow-wrap:anywhere] ${isDark ? "text-gray-300" : "text-gray-600"}`}
                                >
                                  {t("projects.task.assignee")}:{" "}
                                  {assignedMember
                                    ? `${assignedMember.displayName} (@${assignedMember.username})`
                                    : task.assignedTo}
                                </div>
                                <div
                                  className={`text-xs mt-1 break-words [overflow-wrap:anywhere] ${isDark ? "text-gray-300" : "text-gray-600"}`}
                                >
                                  Reviewer:{" "}
                                  {reviewerMember
                                    ? `${reviewerMember.displayName} (@${reviewerMember.username})`
                                    : task.reviewedBy || "Unassigned"}
                                </div>
                                {Array.isArray(task.usedMemoryIds) &&
                                  task.usedMemoryIds.length > 0 && (
                                    <div className="mt-2">
                                      <div
                                        className={`text-[11px] mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                                      >
                                        Memory
                                      </div>
                                      <div className="flex flex-wrap gap-1">
                                        {task.usedMemoryIds
                                          .slice(0, 4)
                                          .map((memoryId) => (
                                            <Badge
                                              key={`${task.id}:${memoryId}`}
                                              variant="neutral"
                                            >
                                              <span
                                                className="truncate max-w-[120px] inline-block align-bottom"
                                                title={memoryId}
                                              >
                                                {memoryId.length > 12
                                                  ? `${memoryId.slice(0, 6)}…${memoryId.slice(-4)}`
                                                  : memoryId}
                                              </span>
                                            </Badge>
                                          ))}
                                        {task.usedMemoryIds.length > 4 && (
                                          <Badge variant="neutral">
                                            +{task.usedMemoryIds.length - 4}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                {!canDrag && (
                                  <div
                                    className={`text-[11px] mt-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                                  >
                                    {t("projects.task.drag.onlyAssignee")}
                                  </div>
                                )}

                                {task.priority && (
                                  <Badge
                                    variant={taskPriorityBadgeVariant(
                                      task.priority,
                                    )}
                                    className="mt-2"
                                  >
                                    {t(`projects.priority.${task.priority}`)}
                                  </Badge>
                                )}

                                {canEditTask && (
                                  <div className="mt-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => startEditTask(task)}
                                    >
                                      {t("projects.task.edit")}
                                    </Button>
                                  </div>
                                )}
                              </Card>
                            );
                          })}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </Card>
          )}

          {activeTab === "team" && (
            <Card className="p-4 sm:p-6 space-y-5">
              <SectionHeader
                title={t("projects.tab.team")}
                actions={
                  <Badge variant="neutral">
                    {project.teamMemberIds.length}
                  </Badge>
                }
              />

              {isOwner && (
                <Card tone="muted" className="p-3 sm:p-4">
                  <SectionHeader
                    title={t("projects.team.invite.title")}
                    className="mb-3"
                  />
                  <div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!inviteUsername.trim()) return;
                        handleInvite({ username: inviteUsername.trim() });
                      }}
                      className="space-y-2"
                    >
                      <label
                        className={`block text-xs font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
                      >
                        {t("projects.team.invite.usernameLabel")}{" "}
                        <span className="text-red-400">*</span>
                      </label>
                      <div className="relative">
                        <Input
                          value={inviteUsername}
                          onChange={(e) => {
                            setInviteUsername(e.target.value);
                            setInviteStatus("");
                          }}
                          placeholder={t(
                            "projects.team.invite.usernamePlaceholder",
                          )}
                          required
                        />
                        {project.roomId && (
                          <InvitePopup
                            roomId={project.roomId}
                            query={inviteUsername}
                            visible={
                              activeTab === "team" &&
                              inviteUsername.trim().length > 0
                            }
                            onSelect={(username) => {
                              setInviteUsername(username);
                              setInviteStatus("");
                            }}
                          />
                        )}
                      </div>
                      <div
                        className={`text-[11px] ${isDark ? "text-gray-400" : "text-gray-500"}`}
                      >
                        {t("projects.team.invite.usernameHint")}
                      </div>

                      <Button
                        type="submit"
                        disabled={inviting}
                        size="sm"
                        className="w-full sm:w-auto"
                      >
                        {t("projects.team.invite.submit")}
                      </Button>
                    </form>
                  </div>

                  {inviteStatus && (
                    <div
                      className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                        isDark
                          ? "border-blue-800/50 bg-blue-900/20 text-blue-300"
                          : "border-blue-200 bg-blue-50 text-blue-700"
                      }`}
                    >
                      {inviteStatus}
                    </div>
                  )}
                </Card>
              )}

              {project.teamMemberIds.length === 0 ? (
                <EmptyState title={t("projects.team.empty")} icon="👥" />
              ) : (
                <div className="space-y-3">
                  {project.teamMemberIds.map((memberId) => {
                    const member = teamMemberLookup.get(memberId);
                    return (
                      <Card
                        key={memberId}
                        tone="muted"
                        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-4"
                      >
                        <div>
                          <div className="text-sm font-semibold">
                            {member
                              ? `${member.displayName} (@${member.username})`
                              : memberId}
                          </div>
                          <div
                            className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
                          >
                            {member?.email ||
                              getUserTypeLabel(member?.userType) ||
                              memberId}
                          </div>
                        </div>
                        {memberId === project.ownerId && (
                          <Badge variant="info">
                            {t("projects.team.owner")}
                          </Badge>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {activeTab === "secrets" && (
            <SecretManager projectId={projectId!} isOwner={isOwner || false} />
          )}
        </div>
      </PageShell>

      {showProjectAttachmentsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowProjectAttachmentsModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-attachments-modal-title"
        >
          <Card
            className={`w-full max-w-2xl p-4 sm:p-5 max-h-[85vh] overflow-y-auto ${isDark ? "bg-gray-900 border-gray-700/50" : "bg-white border-gray-200/60"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <SectionHeader
              title={
                <span id="project-attachments-modal-title">
                  {t("projects.attachments.manage")}
                </span>
              }
              className="mb-3"
              actions={
                <>
                  <Badge variant="neutral">{projectAttachments.length}</Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowProjectAttachmentsModal(false)}
                  >
                    {t("projects.task.attachment.close")}
                  </Button>
                </>
              }
            />

            {isTeamMember && (
              <div className="mb-4">
                <label
                  className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs ${
                    isDark
                      ? "border-gray-600/50 bg-gray-800 text-gray-200 hover:bg-gray-700"
                      : "border-gray-300/60 bg-white text-gray-700 hover:bg-gray-100"
                  } ${uploadingProjectAttachments ? "pointer-events-none opacity-70" : ""}`}
                >
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    disabled={uploadingProjectAttachments}
                    onChange={(e) => {
                      const selected = Array.from(e.target.files || []);
                      if (selected.length > 0) {
                        void handleProjectAttachmentUpload(selected);
                      }
                      e.currentTarget.value = "";
                    }}
                  />
                  {uploadingProjectAttachments
                    ? t("projects.task.attachment.uploading")
                    : t("projects.task.attachment.add")}
                </label>
              </div>
            )}

            {projectAttachments.length > 0 ? (
              <div className="space-y-2">
                {projectAttachments.map((attachment) => {
                  const deleteKey = attachment.id;
                  const isDeletingAttachment =
                    deletingProjectAttachments[deleteKey];
                  const canDeleteAttachment = Boolean(
                    user && (isOwner || user.id === attachment.uploadedBy),
                  );

                  return (
                    <div
                      key={attachment.id}
                      className={`flex flex-col sm:flex-row gap-2 rounded border p-2 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-gray-50"}`}
                    >
                      <a
                        href={authFileUrl(attachment.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex-1 min-w-0 rounded border px-2 py-1 text-xs transition-all duration-200 ${
                          isDark
                            ? "border-gray-700/50 bg-gray-800 hover:bg-gray-700 text-blue-300"
                            : "border-gray-200/60 bg-white hover:bg-gray-50 text-blue-600"
                        }`}
                        title={attachment.filename}
                      >
                        <div className="truncate">{attachment.filename}</div>
                        <div
                          className={isDark ? "text-gray-400" : "text-gray-500"}
                        >
                          {formatFileSize(attachment.size)}
                        </div>
                      </a>
                      {canDeleteAttachment && (
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          className="w-full sm:w-auto shrink-0 whitespace-nowrap"
                          onClick={() =>
                            void handleProjectAttachmentDelete(attachment.id)
                          }
                          disabled={Boolean(isDeletingAttachment)}
                        >
                          {isDeletingAttachment
                            ? t("projects.task.attachment.deleting")
                            : t("projects.task.attachment.delete")}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className={`rounded border border-dashed px-3 py-6 text-center text-sm ${isDark ? "border-gray-700/50 text-gray-500" : "border-gray-300/60 text-gray-400"}`}
              >
                {t("projects.attachments.empty")}
              </div>
            )}

            <div className="mt-4">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setShowProjectAttachmentsModal(false)}
              >
                {t("projects.task.attachment.close")}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {attachmentsTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setAttachmentsTaskId(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-attachments-modal-title"
        >
          <Card
            className={`w-full max-w-2xl p-4 sm:p-5 max-h-[85vh] overflow-y-auto ${isDark ? "bg-gray-900 border-gray-700/50" : "bg-white border-gray-200/60"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <SectionHeader
              title={
                <span id="task-attachments-modal-title">
                  {t("projects.task.attachment.manage")}
                </span>
              }
              className="mb-3"
              actions={
                <>
                  <Badge variant="neutral">
                    {attachmentsTask.attachments?.length || 0}
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setAttachmentsTaskId(null)}
                  >
                    {t("projects.task.attachment.close")}
                  </Button>
                </>
              }
            />

            <div
              className={`mb-3 text-sm ${isDark ? "text-gray-200" : "text-gray-800"}`}
            >
              {attachmentsTask.title}
            </div>

            {isTeamMember && (
              <div className="mb-4">
                <label
                  className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs ${
                    isDark
                      ? "border-gray-600/50 bg-gray-800 text-gray-200 hover:bg-gray-700"
                      : "border-gray-300/60 bg-white text-gray-700 hover:bg-gray-100"
                  } ${uploadingTaskAttachments[attachmentsTask.id] ? "pointer-events-none opacity-70" : ""}`}
                >
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    disabled={uploadingTaskAttachments[attachmentsTask.id]}
                    onChange={(e) => {
                      const selected = Array.from(e.target.files || []);
                      if (selected.length > 0) {
                        handleTaskAttachmentUpload(
                          attachmentsTask.id,
                          selected,
                        );
                      }
                      e.currentTarget.value = "";
                    }}
                  />
                  {uploadingTaskAttachments[attachmentsTask.id]
                    ? t("projects.task.attachment.uploading")
                    : t("projects.task.attachment.add")}
                </label>
              </div>
            )}

            {attachmentsTask.attachments &&
            attachmentsTask.attachments.length > 0 ? (
              <div className="space-y-2">
                {attachmentsTask.attachments.map((attachment) => {
                  const deleteKey = `${attachmentsTask.id}:${attachment.id}`;
                  const isDeletingAttachment =
                    deletingTaskAttachments[deleteKey];
                  const canDeleteAttachment = Boolean(
                    user &&
                    (isOwner ||
                      user.id === attachmentsTask.assignedTo ||
                      user.id === attachment.uploadedBy),
                  );

                  return (
                    <div
                      key={attachment.id}
                      className={`flex flex-col sm:flex-row gap-2 rounded border p-2 ${isDark ? "border-gray-700/50 bg-gray-800/70" : "border-gray-200/60 bg-gray-50"}`}
                    >
                      <a
                        href={authFileUrl(attachment.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex-1 min-w-0 rounded border px-2 py-1 text-xs transition-all duration-200 ${
                          isDark
                            ? "border-gray-700/50 bg-gray-800 hover:bg-gray-700 text-blue-300"
                            : "border-gray-200/60 bg-white hover:bg-gray-50 text-blue-600"
                        }`}
                        title={attachment.filename}
                      >
                        <div className="truncate">{attachment.filename}</div>
                        <div
                          className={isDark ? "text-gray-400" : "text-gray-500"}
                        >
                          {formatFileSize(attachment.size)}
                        </div>
                      </a>
                      {canDeleteAttachment && (
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          className="w-full sm:w-auto shrink-0 whitespace-nowrap"
                          onClick={() =>
                            handleTaskAttachmentDelete(
                              attachmentsTask.id,
                              attachment.id,
                            )
                          }
                          disabled={Boolean(isDeletingAttachment)}
                        >
                          {isDeletingAttachment
                            ? t("projects.task.attachment.deleting")
                            : t("projects.task.attachment.delete")}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className={`rounded border border-dashed px-3 py-6 text-center text-sm ${isDark ? "border-gray-700/50 text-gray-500" : "border-gray-300/60 text-gray-400"}`}
              >
                {t("projects.task.attachment.empty")}
              </div>
            )}

            <div className="mt-4">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => setAttachmentsTaskId(null)}
              >
                {t("projects.task.attachment.close")}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {editingTaskId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={cancelEditTask}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-task-modal-title"
        >
          <Card
            className={`w-full max-w-lg p-4 sm:p-5 max-h-[85vh] overflow-y-auto ${isDark ? "bg-gray-900 border-gray-700/50" : "bg-white border-gray-200/60"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <SectionHeader
              title={
                <span id="edit-task-modal-title">
                  {t("projects.task.edit")}
                </span>
              }
              className="mb-3"
              actions={
                <>
                  {editingTask && (
                    <Badge variant={taskStatusBadgeVariant(editingTask.status)}>
                      {t(`projects.status.${editingTask.status}`) ||
                        editingTask.status}
                    </Badge>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={cancelEditTask}
                    disabled={savingTaskEdit}
                  >
                    {t("projects.task.cancel")}
                  </Button>
                </>
              }
            />
            <div className="space-y-3">
              <Input
                value={editTaskTitle}
                onChange={(e) => setEditTaskTitle(e.target.value)}
                placeholder={t("projects.task.title.placeholder")}
                autoFocus
              />
              <textarea
                value={editTaskDesc}
                onChange={(e) => setEditTaskDesc(e.target.value)}
                rows={3}
                className={textAreaCls}
                placeholder={t("projects.task.description.placeholder")}
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Select
                  value={editTaskPriority}
                  onChange={(value) => setEditTaskPriority(value)}
                  options={PRIORITIES.map((priority) => ({
                    value: priority,
                    label: t(`projects.priority.${priority}`),
                  }))}
                />
                <Select
                  value={editTaskAssignee}
                  onChange={(value) => setEditTaskAssignee(value)}
                  options={project.teamMemberIds.map((memberId) => {
                    const member = teamMemberLookup.get(memberId);
                    const label = member
                      ? `${member.displayName} (@${member.username})`
                      : memberId;
                    return {
                      value: memberId,
                      label,
                    };
                  })}
                />
                <Select
                  value={editTaskReviewer}
                  onChange={(value) => setEditTaskReviewer(value)}
                  options={[
                    { value: "", label: "No reviewer" },
                    ...project.teamMemberIds.map((memberId) => {
                      const member = teamMemberLookup.get(memberId);
                      const label = member
                        ? `${member.displayName} (@${member.username})`
                        : memberId;
                      return {
                        value: memberId,
                        label,
                      };
                    }),
                  ]}
                />
              </div>
              <Input
                value={editTaskMemoryIds}
                onChange={(e) => setEditTaskMemoryIds(e.target.value)}
                placeholder="usedMemoryIds (comma separated)"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <Button
                  type="button"
                  onClick={() => saveTaskEdit(editingTaskId)}
                  disabled={
                    savingTaskEdit || !editTaskTitle.trim() || !editTaskAssignee
                  }
                  className="w-full"
                >
                  {savingTaskEdit
                    ? t("projects.task.saving")
                    : t("projects.task.save")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={cancelEditTask}
                  disabled={savingTaskEdit}
                  className="w-full"
                >
                  {t("projects.task.cancel")}
                </Button>
              </div>
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="w-full"
                onClick={() => requestDeleteTask(editingTaskId)}
                disabled={savingTaskEdit || deletingTask}
              >
                {t("projects.task.delete")}
              </Button>
            </div>
          </Card>
        </div>
      )}
      <ConfirmDialog
        open={!!deleteTaskId}
        title={t("projects.task.delete.title")}
        message={t("projects.task.delete.message").replace(
          "{title}",
          taskToDelete?.title || "",
        )}
        confirmLabel={t("projects.task.delete")}
        cancelLabel={t("projects.cancel")}
        variant="danger"
        loading={deletingTask}
        onConfirm={confirmDeleteTask}
        onCancel={() => {
          if (!deletingTask) setDeleteTaskId(null);
        }}
      />
      <ConfirmDialog
        open={showDeleteDialog}
        title={t("projects.delete.title")}
        message={t("projects.delete.message").replace("{name}", project.name)}
        confirmLabel={t("projects.actions.delete")}
        cancelLabel={t("projects.cancel")}
        variant="danger"
        loading={deletingProject}
        onConfirm={confirmDeleteProject}
        onCancel={() => {
          if (!deletingProject) setShowDeleteDialog(false);
        }}
      />
    </>
  );
};
