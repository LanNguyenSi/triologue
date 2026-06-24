import React, { useState, useEffect, useMemo } from "react";
import toast from "react-hot-toast";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useLanguage } from "../contexts/LanguageContext";
import { useTheme } from "../contexts/ThemeContext";
import { useAuthStore } from "../stores/authStore";
import { apiClient } from "../lib/apiClient";
import { SecretManager } from "../components/projects/SecretManager";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { PageShell } from "../components/ui/PageShell";
import {
  Button,
  Card,
  EmptyState,
  SectionHeader,
} from "../components/ui/primitives";
import { authFileUrl } from "../lib/fileUrl";
import { formatFileSize } from "../lib/projectUtils";
import {
  TASK_STATUS_ORDER,
  normalizeWorkflowConfig,
  normalizeProjectContext,
} from "../projects/projectNormalize";
import type {
  ProjectPluginEntry,
  TeamMember,
} from "../projects/projectDomainTypes";
import { useProjectData } from "../hooks/useProjectData";
import { useTaskManagement } from "../hooks/useTaskManagement";
import { ProjectAttachmentsModal } from "../components/projects/ProjectAttachmentsModal";
import { TaskAttachmentsModal } from "../components/projects/TaskAttachmentsModal";
import { EditTaskModal } from "../components/projects/EditTaskModal";
import { ProjectKanbanBoard } from "../components/projects/ProjectKanbanBoard";
import { ProjectOverviewCard } from "../components/projects/ProjectOverviewCard";
import { ProjectPluginsCard } from "../components/projects/ProjectPluginsCard";
import { ProjectContextCard } from "../components/projects/ProjectContextCard";
import { CreateTaskForm } from "../components/projects/CreateTaskForm";
import type { CreateTaskFields } from "../components/projects/CreateTaskForm";
import { ProjectTeamTab } from "../components/projects/ProjectTeamTab";

type ProjectViewTab = "tasks" | "team" | "secrets";

const normalizeProjectTab = (value: string | null): ProjectViewTab => {
  if (value === "team" || value === "secrets" || value === "tasks")
    return value;
  return "tasks";
};

const api = (path: string, opts?: RequestInit) => apiClient(path, opts);

export const ProjectDetailPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const { t } = useLanguage();
  const { theme } = useTheme();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const isDark = theme === "dark";

  // Project + tasks data and load state (lifted to hook).
  const { project, setProject, tasks, setTasks, loading, error, loadProject } =
    useProjectData(projectId);

  // Task management: CRUD, modal-open state, attachment handlers (lifted to hook).
  const {
    editingTaskId,
    attachmentsTaskId,
    setAttachmentsTaskId,
    showProjectAttachmentsModal,
    setShowProjectAttachmentsModal,
    savingTaskEdit,
    startEditTask,
    cancelEditTask,
    saveTaskEdit,
    deleteTaskId,
    setDeleteTaskId,
    deletingTask,
    requestDeleteTask,
    confirmDeleteTask,
    uploadingTaskAttachments,
    deletingTaskAttachments,
    uploadingProjectAttachments,
    deletingProjectAttachments,
    handleUpdateTaskStatus,
    handleTaskAttachmentUpload,
    handleTaskAttachmentDelete,
    handleProjectAttachmentUpload,
    handleProjectAttachmentDelete,
  } = useTaskManagement({ projectId, setProject, setTasks });

  // Plugin state.
  const [projectPlugins, setProjectPlugins] = useState<ProjectPluginEntry[]>(
    [],
  );
  const [loadingProjectPlugins, setLoadingProjectPlugins] = useState(false);
  const [updatingProjectPluginId, setUpdatingProjectPluginId] = useState<
    string | null
  >(null);

  // Project-level operations.
  const [deletingProject, setDeletingProject] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [exportingProject, setExportingProject] = useState(false);

  // Inline create-task toggle (form state lives in CreateTaskForm).
  const [showCreateTask, setShowCreateTask] = useState(false);

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

  const editingTask = useMemo(
    () => tasks.find((task) => task.id === editingTaskId) ?? null,
    [tasks, editingTaskId],
  );
  const attachmentsTask = useMemo(
    () => tasks.find((task) => task.id === attachmentsTaskId) ?? null,
    [tasks, attachmentsTaskId],
  );
  const projectAttachments = useMemo(
    () => project?.attachments || [],
    [project],
  );
  const taskToDelete = useMemo(
    () => tasks.find((task) => task.id === deleteTaskId) ?? null,
    [tasks, deleteTaskId],
  );

  // Default assignee for the create-task form: current user if they are a
  // member, otherwise the first team member, otherwise empty.
  const defaultAssigneeId = useMemo(() => {
    if (!project) return "";
    if (user && project.teamMemberIds.includes(user.id)) return user.id;
    return project.teamMemberIds[0] ?? "";
  }, [project, user]);

  useEffect(() => {
    if (!projectId) return;
    void loadProjectPlugins();
  }, [projectId]);

  useEffect(() => {
    const nextTab = normalizeProjectTab(tabParam);
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [tabParam]);

  // Close attachments panel if the referenced task no longer exists.
  useEffect(() => {
    if (!attachmentsTaskId) return;
    if (!tasks.some((task) => task.id === attachmentsTaskId)) {
      setAttachmentsTaskId(null);
    }
  }, [attachmentsTaskId, tasks, setAttachmentsTaskId]);

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
      const normalized: ProjectPluginEntry[] = plugins.map(
        (entry: Record<string, unknown>) => ({
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
        }),
      );
      setProjectPlugins(normalized);
    } catch {
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
    } catch {
      toast.error(t("projects.detail.loadError"));
    } finally {
      setUpdatingProjectPluginId(null);
    }
  };

  // Handler passed to CreateTaskForm: performs the API call and file uploads,
  // updates the task list, and shows toasts. Throws on error so the form
  // re-enables the submit button.
  const handleCreateTaskSubmit = async (fields: CreateTaskFields) => {
    if (!projectId) return;
    let toastShown = false;
    try {
      const res = await api(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: fields.title,
          description: fields.description,
          priority: fields.priority,
          assignedTo: fields.assignedTo,
          reviewedBy: fields.reviewedBy,
        }),
      });

      const createdTaskData = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(createdTaskData.error || t("projects.task.create.failed"));
        toastShown = true;
        throw new Error(createdTaskData.error || "Create failed");
      }

      let latestTask = createdTaskData;
      let failedUploads = 0;

      if (fields.files.length > 0) {
        for (const file of fields.files) {
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
    } catch (err) {
      // Network/unexpected failure: surface a toast unless one was already shown
      // for an HTTP error above. Re-throw so CreateTaskForm keeps the form open.
      if (!toastShown) toast.error(t("projects.task.create.failed"));
      throw err;
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
          icon={<ExclamationTriangleIcon className="w-8 h-8" />}
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
        title={project.name}
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
          <ProjectOverviewCard project={project} />

          <ProjectPluginsCard
            projectId={project.id}
            projectPlugins={projectPlugins}
            loadingProjectPlugins={loadingProjectPlugins}
            updatingProjectPluginId={updatingProjectPluginId}
            onToggleLink={(pluginId, linked) =>
              void toggleProjectPluginLink(pluginId, linked)
            }
          />

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
                      className={`block rounded border px-2 py-1.5 text-xs transition-colors duration-200 ${
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

          <ProjectContextCard
            projectContext={projectContext}
            isOwner={isOwner}
            projectId={project.id}
          />
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
                className={`rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-200 ${
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
              className={`rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-200 border-transparent ${
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
                <CreateTaskForm
                  teamMemberIds={project.teamMemberIds}
                  teamMemberLookup={teamMemberLookup}
                  defaultAssigneeId={defaultAssigneeId}
                  onSubmit={handleCreateTaskSubmit}
                  onClose={() => setShowCreateTask(false)}
                />
              )}

              <ProjectKanbanBoard
                statuses={activeTaskStatuses}
                workflowConfig={workflowConfig}
                tasks={tasks}
                teamMemberLookup={teamMemberLookup}
                user={user}
                isOwner={isOwner}
                isDark={isDark}
                onStatusChange={handleUpdateTaskStatus}
                onEditTask={startEditTask}
                onTaskAttachments={setAttachmentsTaskId}
              />
            </Card>
          )}

          {activeTab === "team" && (
            <ProjectTeamTab
              project={project}
              teamMemberLookup={teamMemberLookup}
              isOwner={isOwner}
              loadProject={loadProject}
            />
          )}

          {activeTab === "secrets" && (
            <SecretManager projectId={projectId!} isOwner={isOwner || false} />
          )}
        </div>
      </PageShell>

      <ProjectAttachmentsModal
        open={showProjectAttachmentsModal}
        onClose={() => setShowProjectAttachmentsModal(false)}
        attachments={projectAttachments}
        isTeamMember={isTeamMember}
        isOwner={isOwner}
        user={user}
        uploading={uploadingProjectAttachments}
        deleting={deletingProjectAttachments}
        onUpload={handleProjectAttachmentUpload}
        onDelete={handleProjectAttachmentDelete}
      />

      <TaskAttachmentsModal
        open={!!attachmentsTask}
        onClose={() => setAttachmentsTaskId(null)}
        task={attachmentsTask}
        isTeamMember={isTeamMember}
        isOwner={isOwner}
        user={user}
        uploading={uploadingTaskAttachments}
        deleting={deletingTaskAttachments}
        onUpload={handleTaskAttachmentUpload}
        onDelete={handleTaskAttachmentDelete}
      />

      <EditTaskModal
        open={!!editingTask}
        task={editingTask}
        teamMemberIds={project.teamMemberIds}
        teamMemberLookup={teamMemberLookup}
        saving={savingTaskEdit}
        onClose={cancelEditTask}
        onSave={saveTaskEdit}
        onRequestDelete={requestDeleteTask}
      />

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
