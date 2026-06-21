import { useState } from "react";
import toast from "react-hot-toast";
import { apiClient } from "../lib/apiClient";
import { useLanguage } from "../contexts/LanguageContext";
import type { Project, Task, ProjectAttachment } from "../projects/projectDomainTypes";

const api = (path: string, opts?: RequestInit) => apiClient(path, opts);

export interface EditTaskFields {
  title: string;
  description: string;
  priority: string;
  assignedTo: string;
  reviewedBy: string | null;
  usedMemoryIds: string[];
}

interface UseTaskManagementArgs {
  projectId: string | undefined;
  setProject: React.Dispatch<React.SetStateAction<Project | null>>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
}

export function useTaskManagement({
  projectId,
  setProject,
  setTasks,
}: UseTaskManagementArgs) {
  const { t } = useLanguage();

  // Modal open state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [attachmentsTaskId, setAttachmentsTaskId] = useState<string | null>(null);
  const [showProjectAttachmentsModal, setShowProjectAttachmentsModal] = useState(false);

  // Task edit save state
  const [savingTaskEdit, setSavingTaskEdit] = useState(false);

  // Task delete state
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);

  // Attachment operation state
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

  const startEditTask = (task: Task) => {
    setEditingTaskId(task.id);
  };

  const cancelEditTask = () => {
    if (savingTaskEdit) return;
    setEditingTaskId(null);
  };

  const saveTaskEdit = async (taskId: string, fields: EditTaskFields) => {
    if (!projectId) return;
    setSavingTaskEdit(true);
    try {
      const res = await api(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: "PUT",
        body: JSON.stringify({
          title: fields.title,
          description: fields.description || null,
          priority: fields.priority,
          assignedTo: fields.assignedTo,
          reviewedBy: fields.reviewedBy || null,
          usedMemoryIds: fields.usedMemoryIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t("projects.task.update.failed"));
        return;
      }
      setTasks((prev) =>
        prev.map((task) => (task.id === taskId ? (data as Task) : task)),
      );
      setEditingTaskId(null);
    } catch (err) {
      console.error(err);
      toast.error(t("projects.task.update.failed"));
    } finally {
      setSavingTaskEdit(false);
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
        prev.map((task) => (task.id === taskId ? (data as Task) : task)),
      );
    } catch (err) {
      console.error(err);
      toast.error(t("projects.task.update.failed"));
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
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t("projects.task.delete.failed"));
        return;
      }
      setTasks((prev) => prev.filter((task) => task.id !== deleteTaskId));
      if (editingTaskId === deleteTaskId) {
        setEditingTaskId(null);
      }
      setDeleteTaskId(null);
    } catch (err) {
      console.error(err);
      toast.error(t("projects.task.delete.failed"));
    } finally {
      setDeletingTask(false);
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
          { method: "POST", body: formData },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          failedUploads += 1;
          continue;
        }
        if (data?.task) {
          latestTask = data.task as Task;
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
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t("projects.task.attachment.deleteFailed"));
        return;
      }

      if (data?.task) {
        setTasks((prev) =>
          prev.map((task) => (task.id === taskId ? (data.task as Task) : task)),
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
          uploaded.push(data.attachment as ProjectAttachment);
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
        { method: "DELETE" },
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

  return {
    // Modal open state
    editingTaskId,
    setEditingTaskId,
    attachmentsTaskId,
    setAttachmentsTaskId,
    showProjectAttachmentsModal,
    setShowProjectAttachmentsModal,
    // Task edit
    savingTaskEdit,
    startEditTask,
    cancelEditTask,
    saveTaskEdit,
    // Task delete
    deleteTaskId,
    setDeleteTaskId,
    deletingTask,
    requestDeleteTask,
    confirmDeleteTask,
    // Attachment state
    uploadingTaskAttachments,
    deletingTaskAttachments,
    uploadingProjectAttachments,
    deletingProjectAttachments,
    // Attachment handlers
    handleUpdateTaskStatus,
    handleTaskAttachmentUpload,
    handleTaskAttachmentDelete,
    handleProjectAttachmentUpload,
    handleProjectAttachmentDelete,
  };
}
