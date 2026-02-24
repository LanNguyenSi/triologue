import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuthStore } from '../stores/authStore';
import { InvitePopup } from '../components/chat/InvitePopup';
import { SecretManager } from '../components/projects/SecretManager';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Badge, Button, Card, EmptyState, Input, SectionHeader, Select } from '../components/ui/primitives';

interface TeamMember {
  id: string;
  username: string;
  displayName: string;
  email?: string | null;
  userType: 'HUMAN' | 'AI_AGENT' | 'AI_ICE' | 'AI_LAVA' | 'AI_OTHER';
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
  workflowConfig?: WorkflowConfig;
  projectContext?: ProjectContext;
  createdAt: string;
  updatedAt: string;
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

type MilestoneStatus = 'planned' | 'in_progress' | 'done';

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
  type: 'IMAGE' | 'DOCUMENT' | 'CODE_SNIPPET' | 'RESEARCH_DATA' | 'MEMORY_EXPORT';
  uploadedBy: string;
  createdAt: string;
}

interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: string;
  assignedTo: string;
  priority?: string;
  dueDate?: string;
  attachments?: TaskAttachment[];
  createdAt: string;
  updatedAt: string;
}

const CORE_TASK_STATUSES = ['todo', 'in_progress', 'done'];
const OPTIONAL_TASK_STATUSES = ['in_review', 'blocked'];
const TASK_STATUS_ORDER = [...CORE_TASK_STATUSES, ...OPTIONAL_TASK_STATUSES];
const PRIORITIES = ['low', 'medium', 'high'];

const defaultWorkflowConfig = (): WorkflowConfig => ({
  enabledStatuses: [...CORE_TASK_STATUSES],
  instructions: TASK_STATUS_ORDER.reduce<Record<string, string>>((acc, status) => {
    acc[status] = '';
    return acc;
  }, {}),
});

const normalizeWorkflowConfig = (raw?: Partial<WorkflowConfig> | null): WorkflowConfig => {
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
      if (typeof value === 'string') instructions[status] = value;
    }
  }

  return {
    enabledStatuses: TASK_STATUS_ORDER.filter((status) => enabledSet.has(status)),
    instructions,
  };
};

const defaultProjectContext = (): ProjectContext => ({
  definitionOfDone: [],
  decisionLog: [],
  milestones: [],
  brief: {
    goal: '',
    scope: '',
    outOfScope: '',
    successCriteria: '',
  },
  runbook: {
    preferredLanguage: '',
    responseStyle: '',
    constraints: '',
    escalationPath: '',
  },
});

const normalizeProjectContext = (raw?: Partial<ProjectContext> | null): ProjectContext => {
  const defaults = defaultProjectContext();
  const definitionOfDone = Array.isArray(raw?.definitionOfDone)
    ? raw.definitionOfDone
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, 40)
    : defaults.definitionOfDone;
  const decisionLog = Array.isArray(raw?.decisionLog)
    ? raw.decisionLog
        .map((entry, index): DecisionLogEntry | null => {
          if (!entry || typeof entry !== 'object') return null;
          const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `decision-${index + 1}`;
          const date = typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date.trim())
            ? entry.date.trim()
            : '';
          const title = typeof entry.title === 'string' ? entry.title.trim() : '';
          const decision = typeof entry.decision === 'string' ? entry.decision.trim() : '';
          const rationale = typeof entry.rationale === 'string' ? entry.rationale.trim() : '';
          if (!date && !title && !decision && !rationale) return null;
          return { id, date, title, decision, rationale };
        })
        .filter((entry): entry is DecisionLogEntry => Boolean(entry))
        .slice(0, 100)
    : defaults.decisionLog;
  const milestones = Array.isArray(raw?.milestones)
    ? raw.milestones
        .map((entry, index): MilestoneEntry | null => {
          if (!entry || typeof entry !== 'object') return null;
          const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : `milestone-${index + 1}`;
          const title = typeof entry.title === 'string' ? entry.title.trim() : '';
          const dueDate = typeof entry.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.dueDate.trim())
            ? entry.dueDate.trim()
            : '';
          const status: MilestoneStatus = entry.status === 'in_progress' || entry.status === 'done' ? entry.status : 'planned';
          const notes = typeof entry.notes === 'string' ? entry.notes.trim() : '';
          if (!title && !dueDate && !notes) return null;
          return { id, title, dueDate, status, notes };
        })
        .filter((entry): entry is MilestoneEntry => Boolean(entry))
        .slice(0, 100)
    : defaults.milestones;
  const brief: Partial<ProjectBrief> =
    raw?.brief && typeof raw.brief === 'object' ? (raw.brief as Partial<ProjectBrief>) : {};
  const runbook: Partial<ProjectRunbook> =
    raw?.runbook && typeof raw.runbook === 'object' ? (raw.runbook as Partial<ProjectRunbook>) : {};

  const normalize = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

  return {
    definitionOfDone,
    decisionLog,
    milestones,
    brief: {
      goal: normalize(brief.goal) || defaults.brief.goal,
      scope: normalize(brief.scope) || defaults.brief.scope,
      outOfScope: normalize(brief.outOfScope) || defaults.brief.outOfScope,
      successCriteria: normalize(brief.successCriteria) || defaults.brief.successCriteria,
    },
    runbook: {
      preferredLanguage: normalize(runbook.preferredLanguage) || defaults.runbook.preferredLanguage,
      responseStyle: normalize(runbook.responseStyle) || defaults.runbook.responseStyle,
      constraints: normalize(runbook.constraints) || defaults.runbook.constraints,
      escalationPath: normalize(runbook.escalationPath) || defaults.runbook.escalationPath,
    },
  };
};

const generateContextEntryId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const authFileUrl = (url: string) => {
  if (!url?.startsWith('/uploads/')) return url;
  const filename = url.replace('/uploads/', '');
  const token = localStorage.getItem('triologue_token');
  return `/api/files/${filename}${token ? `?token=${token}` : ''}`;
};

const formatFileSize = (size?: number | null) => {
  if (!size || size <= 0) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const api = (path: string, opts?: RequestInit) => {
  const token = localStorage.getItem('triologue_token');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...((opts?.headers as Record<string, string>) || {}),
  };
  if (!(opts?.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(path, {
    ...opts,
    headers,
  });
};

export const ProjectDetailPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const isDark = theme === 'dark';

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingProject, setDeletingProject] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditProject, setShowEditProject] = useState(false);
  const [editProjectName, setEditProjectName] = useState('');
  const [editProjectDesc, setEditProjectDesc] = useState('');
  const [editProjectStatus, setEditProjectStatus] = useState('active');
  const [savingProject, setSavingProject] = useState(false);
  const [exportingProject, setExportingProject] = useState(false);

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [newTaskFiles, setNewTaskFiles] = useState<File[]>([]);
  const [creatingTask, setCreatingTask] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [attachmentsTaskId, setAttachmentsTaskId] = useState<string | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState('');
  const [editTaskDesc, setEditTaskDesc] = useState('');
  const [editTaskPriority, setEditTaskPriority] = useState('medium');
  const [editTaskAssignee, setEditTaskAssignee] = useState('');
  const [savingTaskEdit, setSavingTaskEdit] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [uploadingTaskAttachments, setUploadingTaskAttachments] = useState<Record<string, boolean>>({});
  const [deletingTaskAttachments, setDeletingTaskAttachments] = useState<Record<string, boolean>>({});

  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteStatus, setInviteStatus] = useState('');
  const [inviting, setInviting] = useState(false);

  const [activeTab, setActiveTab] = useState<'tasks' | 'team' | 'secrets'>('tasks');
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [workflowEnabledStatuses, setWorkflowEnabledStatuses] = useState<string[]>([...CORE_TASK_STATUSES]);
  const [workflowInstructions, setWorkflowInstructions] = useState<Record<string, string>>(defaultWorkflowConfig().instructions);
  const [showProjectContextModal, setShowProjectContextModal] = useState(false);
  const [savingProjectContext, setSavingProjectContext] = useState(false);
  const [projectContextDraft, setProjectContextDraft] = useState<ProjectContext>(defaultProjectContext());

  const isOwner = Boolean(project && user && project.ownerId === user.id);
  const isTeamMember = Boolean(project && user && project.teamMemberIds.includes(user.id));
  const projectContext = useMemo(
    () => normalizeProjectContext(project?.projectContext),
    [project?.projectContext],
  );
  const workflowConfig = useMemo(
    () => normalizeWorkflowConfig(project?.workflowConfig),
    [project?.workflowConfig],
  );
  const activeTaskStatuses = useMemo(
    () => TASK_STATUS_ORDER.filter((status) => workflowConfig.enabledStatuses.includes(status)),
    [workflowConfig.enabledStatuses],
  );
  const draftWorkflowStatuses = useMemo(
    () => TASK_STATUS_ORDER.filter(
      (status) => CORE_TASK_STATUSES.includes(status) || workflowEnabledStatuses.includes(status),
    ),
    [workflowEnabledStatuses],
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

  const getUserTypeLabel = (userType?: TeamMember['userType'] | string | null) => {
    if (!userType) return '';
    switch (userType) {
      case 'HUMAN':
        return t('projects.userType.human');
      case 'AI_AGENT':
        return t('projects.userType.ai_agent');
      case 'AI_ICE':
        return t('projects.userType.ai_ice');
      case 'AI_LAVA':
        return t('projects.userType.ai_lava');
      case 'AI_OTHER':
        return t('projects.userType.ai_other');
      default:
        return userType;
    }
  };

  useEffect(() => {
    if (projectId) loadProject();
  }, [projectId]);

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
        setError('');
      } else {
        setError(t('projects.detail.notFound'));
      }
    } catch (err) {
      setError(t('projects.detail.loadError'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !projectId || !newTaskAssignee) return;
    setCreatingTask(true);
    try {
      const res = await api(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: newTaskTitle,
          description: newTaskDesc,
          priority: newTaskPriority,
          assignedTo: newTaskAssignee,
        }),
      });

      const createdTaskData = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(createdTaskData.error || t('projects.task.create.failed'));
        return;
      }

      let latestTask = createdTaskData;
      let failedUploads = 0;

      if (newTaskFiles.length > 0) {
        for (const file of newTaskFiles) {
          const formData = new FormData();
          formData.append('file', file);

          const uploadRes = await api(`/api/projects/${projectId}/tasks/${createdTaskData.id}/attachments`, {
            method: 'POST',
            body: formData,
          });
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
        toast.error(t('projects.task.attachment.uploadPartialFailed'));
      }

      setTasks((prev) => [...prev, latestTask]);
      setNewTaskTitle('');
      setNewTaskDesc('');
      setNewTaskPriority('medium');
      setNewTaskFiles([]);
      if (user?.id && project?.teamMemberIds.includes(user.id)) {
        setNewTaskAssignee(user.id);
      }
      setShowCreateTask(false);
    } catch (err) {
      console.error(err);
      toast.error(t('projects.task.create.failed'));
    } finally {
      setCreatingTask(false);
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, newStatus: string) => {
    if (!projectId) return;
    try {
      const res = await api(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('projects.task.update.failed'));
        return;
      }
      setTasks((prev) => prev.map((task) => (task.id === taskId ? data : task)));
    } catch (err) {
      console.error(err);
      toast.error(t('projects.task.update.failed'));
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
        formData.append('file', file);

        const res = await api(`/api/projects/${projectId}/tasks/${taskId}/attachments`, {
          method: 'POST',
          body: formData,
        });
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
        setTasks((prev) => prev.map((task) => (task.id === taskId ? latestTask! : task)));
      }

      if (failedUploads > 0) {
        toast.error(
          failedUploads === files.length
            ? t('projects.task.attachment.uploadFailed')
            : t('projects.task.attachment.uploadPartialFailed'),
        );
      }
    } catch (err) {
      console.error(err);
      toast.error(t('projects.task.attachment.uploadFailed'));
    } finally {
      setUploadingTaskAttachments((prev) => ({ ...prev, [taskId]: false }));
    }
  };

  const handleTaskAttachmentDelete = async (taskId: string, attachmentId: string) => {
    if (!projectId) return;

    const key = `${taskId}:${attachmentId}`;
    setDeletingTaskAttachments((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await api(`/api/projects/${projectId}/tasks/${taskId}/attachments/${attachmentId}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('projects.task.attachment.deleteFailed'));
        return;
      }

      if (data?.task) {
        setTasks((prev) => prev.map((task) => (task.id === taskId ? data.task : task)));
      }
    } catch (err) {
      console.error(err);
      toast.error(t('projects.task.attachment.deleteFailed'));
    } finally {
      setDeletingTaskAttachments((prev) => ({ ...prev, [key]: false }));
    }
  };

  const startEditTask = (task: Task) => {
    setEditingTaskId(task.id);
    setEditTaskTitle(task.title || '');
    setEditTaskDesc(task.description || '');
    setEditTaskPriority(task.priority || 'medium');
    setEditTaskAssignee(task.assignedTo || '');
  };

  const cancelEditTask = () => {
    if (savingTaskEdit) return;
    setEditingTaskId(null);
    setEditTaskTitle('');
    setEditTaskDesc('');
    setEditTaskPriority('medium');
    setEditTaskAssignee('');
  };

  const saveTaskEdit = async (taskId: string) => {
    if (!projectId || !editTaskTitle.trim() || !editTaskAssignee) return;
    setSavingTaskEdit(true);
    try {
      const res = await api(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: editTaskTitle.trim(),
          description: editTaskDesc.trim() || null,
          priority: editTaskPriority,
          assignedTo: editTaskAssignee,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('projects.task.update.failed'));
        return;
      }
      setTasks((prev) => prev.map((task) => (task.id === taskId ? data : task)));
      setEditingTaskId(null);
      setEditTaskTitle('');
      setEditTaskDesc('');
      setEditTaskPriority('medium');
      setEditTaskAssignee('');
    } catch (err) {
      console.error(err);
      toast.error(t('projects.task.update.failed'));
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
      const res = await api(`/api/projects/${projectId}/tasks/${deleteTaskId}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('projects.task.delete.failed'));
        return;
      }
      setTasks((prev) => prev.filter((task) => task.id !== deleteTaskId));
      if (editingTaskId === deleteTaskId) {
        cancelEditTask();
      }
      setDeleteTaskId(null);
    } catch (err) {
      console.error(err);
      toast.error(t('projects.task.delete.failed'));
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
    const failedText = t('projects.delete.failed');

    setDeletingProject(true);
    try {
      const res = await api(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      navigate('/projects');
    } catch (err) {
      console.error(err);
      toast.error(failedText);
    } finally {
      setDeletingProject(false);
    }
  };

  const handleStartEditProject = () => {
    if (!project) return;
    setEditProjectName(project.name || '');
    setEditProjectDesc(project.description || '');
    setEditProjectStatus(project.status || 'active');
    setShowEditProject(true);
  };

  const handleExportProject = async () => {
    if (!projectId || exportingProject) return;
    setExportingProject(true);

    try {
      const res = await api(`/api/projects/${projectId}/export`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Export failed');
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition') || '';
      const fileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
      const fileName = fileNameMatch?.[1] || `project-${projectId}-export.md`;

      const fileUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = fileUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(fileUrl);
    } catch (err) {
      console.error(err);
      toast.error(t('projects.export.failed'));
    } finally {
      setExportingProject(false);
    }
  };

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !project || !editProjectName.trim()) return;

    setSavingProject(true);
    try {
      const res = await api(`/api/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editProjectName.trim(),
          description: editProjectDesc.trim() || null,
          status: editProjectStatus,
        }),
      });

      if (!res.ok) throw new Error('Update failed');
      const updated = await res.json();
      setProject((prev) => (prev ? { ...prev, ...updated } : prev));
      setShowEditProject(false);
    } catch (err) {
      console.error(err);
      toast.error(t('projects.update.failed'));
    } finally {
      setSavingProject(false);
    }
  };

  const openWorkflowModal = () => {
    if (!project) return;
    const normalized = normalizeWorkflowConfig(project.workflowConfig);
    setWorkflowEnabledStatuses(normalized.enabledStatuses);
    setWorkflowInstructions({ ...normalized.instructions });
    setShowWorkflowModal(true);
  };

  const openProjectContextModal = () => {
    if (!project) return;
    const normalized = normalizeProjectContext(project.projectContext);
    setProjectContextDraft(normalized);
    setShowProjectContextModal(true);
  };

  const addDefinitionOfDoneItem = () => {
    setProjectContextDraft((prev) => ({
      ...prev,
      definitionOfDone: [...prev.definitionOfDone, ''],
    }));
  };

  const updateDefinitionOfDoneItem = (index: number, value: string) => {
    setProjectContextDraft((prev) => ({
      ...prev,
      definitionOfDone: prev.definitionOfDone.map((item, itemIndex) => (itemIndex === index ? value : item)),
    }));
  };

  const removeDefinitionOfDoneItem = (index: number) => {
    setProjectContextDraft((prev) => ({
      ...prev,
      definitionOfDone: prev.definitionOfDone.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const addDecisionLogEntry = () => {
    setProjectContextDraft((prev) => ({
      ...prev,
      decisionLog: [
        ...prev.decisionLog,
        { id: generateContextEntryId('decision'), date: '', title: '', decision: '', rationale: '' },
      ],
    }));
  };

  const updateDecisionLogEntry = (entryId: string, patch: Partial<DecisionLogEntry>) => {
    setProjectContextDraft((prev) => ({
      ...prev,
      decisionLog: prev.decisionLog.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)),
    }));
  };

  const removeDecisionLogEntry = (entryId: string) => {
    setProjectContextDraft((prev) => ({
      ...prev,
      decisionLog: prev.decisionLog.filter((entry) => entry.id !== entryId),
    }));
  };

  const addMilestoneEntry = () => {
    setProjectContextDraft((prev) => ({
      ...prev,
      milestones: [
        ...prev.milestones,
        { id: generateContextEntryId('milestone'), title: '', dueDate: '', status: 'planned', notes: '' },
      ],
    }));
  };

  const updateMilestoneEntry = (entryId: string, patch: Partial<MilestoneEntry>) => {
    setProjectContextDraft((prev) => ({
      ...prev,
      milestones: prev.milestones.map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)),
    }));
  };

  const removeMilestoneEntry = (entryId: string) => {
    setProjectContextDraft((prev) => ({
      ...prev,
      milestones: prev.milestones.filter((entry) => entry.id !== entryId),
    }));
  };

  const saveWorkflow = async () => {
    if (!projectId || !project) return;

    const enabledStatuses = [
      ...CORE_TASK_STATUSES,
      ...OPTIONAL_TASK_STATUSES.filter((status) => workflowEnabledStatuses.includes(status)),
    ];

    setSavingWorkflow(true);
    try {
      const res = await api(`/api/projects/${projectId}/workflow`, {
        method: 'PUT',
        body: JSON.stringify({
          enabledStatuses,
          instructions: workflowInstructions,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('projects.workflow.saveFailed'));
        return;
      }

      const normalized = normalizeWorkflowConfig(data.workflowConfig);
      setProject((prev) => (prev ? { ...prev, workflowConfig: normalized } : prev));
      setShowWorkflowModal(false);
      toast.success(t('projects.workflow.saved'));
    } catch (err) {
      console.error(err);
      toast.error(t('projects.workflow.saveFailed'));
    } finally {
      setSavingWorkflow(false);
    }
  };

  const saveProjectContext = async () => {
    if (!projectId || !project) return;

    setSavingProjectContext(true);
    try {
      const res = await api(`/api/projects/${projectId}/context`, {
        method: 'PUT',
        body: JSON.stringify(projectContextDraft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('projects.context.saveFailed'));
        return;
      }

      const normalized = normalizeProjectContext(data.projectContext);
      setProject((prev) => (prev ? { ...prev, projectContext: normalized } : prev));
      setShowProjectContextModal(false);
      toast.success(t('projects.context.saved'));
    } catch (err) {
      console.error(err);
      toast.error(t('projects.context.saveFailed'));
    } finally {
      setSavingProjectContext(false);
    }
  };

  const handleInvite = async (payload: { username: string }) => {
    if (!projectId) return;
    setInviteStatus('');
    setInviting(true);
    try {
      const res = await api(`/api/projects/${projectId}/team/invite`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteStatus(data.error || t('projects.team.invite.failed'));
        return;
      }

      setInviteStatus(t('projects.team.invite.success'));
      setInviteUsername('');
      await loadProject();
    } catch (err) {
      console.error(err);
      setInviteStatus(t('projects.team.invite.networkError'));
    } finally {
      setInviting(false);
    }
  };

  const getTasksByStatus = (status: string) => tasks.filter((task) => task.status === status);
  const editingTask = useMemo(
    () => tasks.find((task) => task.id === editingTaskId) || null,
    [tasks, editingTaskId],
  );
  const attachmentsTask = useMemo(
    () => tasks.find((task) => task.id === attachmentsTaskId) || null,
    [tasks, attachmentsTaskId],
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
    isDark ? 'border-gray-600 bg-gray-700 text-white placeholder-gray-400' : 'border-gray-300 bg-white'
  } outline-none focus:ring-2 focus:ring-blue-500`;

  const tabLabels: Record<string, string> = {
    tasks: t('projects.tab.tasks'),
    team: t('projects.tab.team'),
    secrets: t('projects.tab.secrets'),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className={`min-h-screen ${isDark ? 'bg-gray-900' : 'bg-gray-50'} px-4 py-10 sm:px-6 lg:px-8`}>
        <div className="max-w-5xl mx-auto">
          <EmptyState
            icon="⚠️"
            title={error || t('projects.detail.notFound')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className={`border-b ${isDark ? 'border-gray-800 bg-gray-800/70' : 'border-gray-200 bg-white'}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 space-y-3 sm:space-y-4">
          <Card className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">📋 {project.name}</h1>
                {project.description && (
                  <p className={`mt-2 text-sm sm:text-base ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{project.description}</p>
                )}
              </div>
              {(isOwner || isTeamMember) && (
                <div className="shrink-0 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={handleExportProject}
                    variant="secondary"
                    size="sm"
                    disabled={exportingProject}
                    className="h-8 min-w-[92px] justify-center whitespace-nowrap"
                  >
                    {exportingProject ? t('projects.actions.exporting') : t('projects.actions.export')}
                  </Button>
                  {isOwner && (
                    <>
                  <Button
                    type="button"
                    onClick={handleStartEditProject}
                    variant="secondary"
                    size="sm"
                    className="h-8 min-w-[92px] justify-center whitespace-nowrap"
                  >
                    {t('projects.actions.edit')}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleDeleteProject}
                    disabled={deletingProject}
                    variant="danger"
                    size="sm"
                    className="h-8 min-w-[92px] justify-center whitespace-nowrap"
                  >
                    {deletingProject ? t('projects.actions.deleting') : t('projects.actions.delete')}
                  </Button>
                    </>
                  )}
                </div>
              )}
            </div>

            {isOwner && showEditProject && (
              <form
                onSubmit={handleUpdateProject}
                className={`mt-4 rounded-lg border-l-4 border-blue-500 p-3 sm:p-4 ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-blue-50 border border-blue-100'}`}
              >
                <div className="grid gap-3">
                  <Input
                    type="text"
                    placeholder={t('projects.name.placeholder')}
                    value={editProjectName}
                    onChange={(e) => setEditProjectName(e.target.value)}
                    autoFocus
                  />
                  <textarea
                    placeholder={t('projects.description.placeholder')}
                    value={editProjectDesc}
                    onChange={(e) => setEditProjectDesc(e.target.value)}
                    className={textAreaCls}
                    rows={2}
                  />
                  <Select
                    value={editProjectStatus}
                    onChange={(e) => setEditProjectStatus(e.target.value)}
                  >
                    <option value="active">{t('projects.status.active')}</option>
                    <option value="archived">{t('projects.status.archived')}</option>
                    <option value="closed">{t('projects.status.closed')}</option>
                  </Select>
                </div>
                <div className="mt-3 flex flex-col sm:flex-row gap-2">
                  <Button type="submit" size="sm" disabled={savingProject}>
                    {savingProject ? t('projects.update.saving') : t('projects.update.save')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowEditProject(false)}
                    disabled={savingProject}
                  >
                    {t('projects.update.cancel')}
                  </Button>
                </div>
              </form>
            )}
          </Card>

          <Card tone="muted" className="p-3 sm:p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className={`rounded-lg border px-3 py-2 ${isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-white'}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('projects.detail.status')}
                </div>
                <div className="mt-1">
                  <Badge variant={project.status === 'active' ? 'success' : 'neutral'}>
                    {t(`projects.status.${project.status}`) || project.status}
                  </Badge>
                </div>
              </div>

              <div className={`rounded-lg border px-3 py-2 ${isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-white'}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('projects.detail.created')}
                </div>
                <div className={`mt-1 text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                  {new Date(project.createdAt).toLocaleDateString()}
                </div>
              </div>

              <div className={`rounded-lg border px-3 py-2 ${isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-white'}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('projects.room.linked')}
                </div>
                {project.roomId ? (
                  <div className="mt-1">
                    <div
                      className="break-all font-mono text-xs sm:text-sm text-blue-400"
                      title={project.roomId}
                    >
                      {project.roomId}
                    </div>
                    <Link
                      to={`/room/${project.roomId}`}
                      className={`mt-1 inline-flex text-xs font-medium ${
                        isDark ? 'text-blue-300 hover:text-blue-200' : 'text-blue-600 hover:text-blue-500'
                      }`}
                    >
                      {t('projects.actions.room')}
                    </Link>
                  </div>
                ) : (
                  <div className={`mt-1 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{t('projects.room.none')}</div>
                )}
              </div>
            </div>
          </Card>

          <Card tone="muted" className="p-3 sm:p-4">
            <SectionHeader
              title={t('projects.context.title')}
              className="mb-3"
              actions={
                isOwner ? (
                  <Button type="button" size="sm" variant="secondary" onClick={openProjectContextModal}>
                    {t('projects.context.define')}
                  </Button>
                ) : undefined
              }
            />
            <div className="space-y-3">
              <div className={`rounded-lg border px-3 py-3 ${isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-white'}`}>
                <div className={`mb-2 text-[11px] uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('projects.context.dod.title')}
                </div>
                {projectContext.definitionOfDone.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {projectContext.definitionOfDone.map((item, index) => (
                      <li key={`${item}-${index}`} className={isDark ? 'text-gray-100' : 'text-gray-800'}>
                        - {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{t('projects.context.empty')}</div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className={`rounded-lg border px-3 py-3 ${isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-white'}`}>
                  <div className={`mb-2 text-[11px] uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {t('projects.context.decision.title')}
                  </div>
                  {projectContext.decisionLog.length > 0 ? (
                    <div className="space-y-2">
                      {projectContext.decisionLog.map((entry) => (
                        <div key={entry.id} className={`rounded border px-2 py-2 text-xs ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
                          <div className={`font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                            {entry.date || t('projects.context.empty')} - {entry.title || t('projects.context.empty')}
                          </div>
                          <div className={`${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{entry.decision || t('projects.context.empty')}</div>
                          <div className={isDark ? 'text-gray-400' : 'text-gray-600'}>{entry.rationale || t('projects.context.empty')}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{t('projects.context.empty')}</div>
                  )}
                </div>

                <div className={`rounded-lg border px-3 py-3 ${isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-white'}`}>
                  <div className={`mb-2 text-[11px] uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {t('projects.context.milestones.title')}
                  </div>
                  {projectContext.milestones.length > 0 ? (
                    <div className="space-y-2">
                      {projectContext.milestones.map((entry) => (
                        <div key={entry.id} className={`rounded border px-2 py-2 text-xs ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
                          <div className={`font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{entry.title || t('projects.context.empty')}</div>
                          <div className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                            {entry.dueDate || t('projects.context.empty')} - {t(`projects.context.milestones.status.${entry.status}`)}
                          </div>
                          <div className={isDark ? 'text-gray-400' : 'text-gray-600'}>{entry.notes || t('projects.context.empty')}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{t('projects.context.empty')}</div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className={`rounded-lg border px-3 py-3 ${isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-white'}`}>
                <div className={`mb-2 text-[11px] uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('projects.context.brief.title')}
                </div>
                <div className="space-y-2 text-sm">
                  <div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('projects.context.brief.goal')}</div>
                    <div className={isDark ? 'text-gray-100' : 'text-gray-800'}>{projectContext.brief.goal || t('projects.context.empty')}</div>
                  </div>
                  <div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('projects.context.brief.scope')}</div>
                    <div className={isDark ? 'text-gray-100' : 'text-gray-800'}>{projectContext.brief.scope || t('projects.context.empty')}</div>
                  </div>
                  <div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('projects.context.brief.outOfScope')}</div>
                    <div className={isDark ? 'text-gray-100' : 'text-gray-800'}>{projectContext.brief.outOfScope || t('projects.context.empty')}</div>
                  </div>
                  <div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('projects.context.brief.successCriteria')}</div>
                    <div className={isDark ? 'text-gray-100' : 'text-gray-800'}>{projectContext.brief.successCriteria || t('projects.context.empty')}</div>
                  </div>
                </div>
              </div>

              <div className={`rounded-lg border px-3 py-3 ${isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-white'}`}>
                <div className={`mb-2 text-[11px] uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('projects.context.runbook.title')}
                </div>
                <div className="space-y-2 text-sm">
                  <div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('projects.context.runbook.preferredLanguage')}</div>
                    <div className={isDark ? 'text-gray-100' : 'text-gray-800'}>{projectContext.runbook.preferredLanguage || t('projects.context.empty')}</div>
                  </div>
                  <div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('projects.context.runbook.responseStyle')}</div>
                    <div className={isDark ? 'text-gray-100' : 'text-gray-800'}>{projectContext.runbook.responseStyle || t('projects.context.empty')}</div>
                  </div>
                  <div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('projects.context.runbook.constraints')}</div>
                    <div className={isDark ? 'text-gray-100' : 'text-gray-800'}>{projectContext.runbook.constraints || t('projects.context.empty')}</div>
                  </div>
                  <div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('projects.context.runbook.escalationPath')}</div>
                    <div className={isDark ? 'text-gray-100' : 'text-gray-800'}>{projectContext.runbook.escalationPath || t('projects.context.empty')}</div>
                  </div>
                </div>
              </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div className={`border-b ${isDark ? 'border-gray-800' : 'border-gray-200'}`}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex gap-2 flex-wrap">
          {(['tasks', 'team', 'secrets'] as const).map((tab) => (
            <Button
              key={tab}
              onClick={() => setActiveTab(tab)}
              variant={activeTab === tab ? 'primary' : 'secondary'}
              size="sm"
            >
              {tabLabels[tab]}
            </Button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {activeTab === 'tasks' && (
          <div>
            {!showCreateTask && (
              <div className="mb-4 sm:mb-6 flex flex-wrap gap-2">
                {isTeamMember && (
                  <Button onClick={() => setShowCreateTask(true)} className="h-9 whitespace-nowrap">
                    {t('projects.task.add')}
                  </Button>
                )}
                {isOwner && (
                  <Button type="button" variant="secondary" onClick={openWorkflowModal} className="h-9 whitespace-nowrap">
                    {t('projects.workflow.define')}
                  </Button>
                )}
              </div>
            )}

            {showCreateTask && isTeamMember && (
              <form
                onSubmit={handleCreateTask}
                className={`mb-6 rounded-lg border-l-4 border-blue-500 p-3 sm:p-4 ${isDark ? 'bg-gray-800' : 'bg-blue-50'}`}
              >
                <Input
                  type="text"
                  placeholder={t('projects.task.title.placeholder')}
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="mb-3"
                  autoFocus
                />
                <textarea
                  placeholder={t('projects.task.description.placeholder')}
                  value={newTaskDesc}
                  onChange={(e) => setNewTaskDesc(e.target.value)}
                  className={`${textAreaCls} mb-3`}
                  rows={3}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  <Select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value)}
                  >
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>{t(`projects.priority.${priority}`)}</option>
                    ))}
                  </Select>

                  <Select
                    value={newTaskAssignee}
                    onChange={(e) => setNewTaskAssignee(e.target.value)}
                  >
                    {project.teamMemberIds.map((memberId) => {
                      const member = teamMemberLookup.get(memberId);
                      const label = member ? `${member.displayName} (@${member.username})` : memberId;
                      return <option key={memberId} value={memberId}>{label}</option>;
                    })}
                  </Select>
                </div>

                <div className="mb-4">
                  <div className={`mb-1 text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    {t('projects.task.attachments')}
                  </div>
                  <label
                    className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs ${
                      isDark
                        ? 'border-gray-600 bg-gray-800 text-gray-200 hover:bg-gray-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
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
                        e.currentTarget.value = '';
                      }}
                    />
                    {t('projects.task.attachment.add')}
                  </label>
                  <div className={`mt-1 text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {t('projects.task.attachment.createHint')}
                  </div>
                  {newTaskFiles.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {newTaskFiles.map((file, index) => (
                        <div
                          key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                          className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs ${
                            isDark ? 'border-gray-700 bg-gray-900 text-gray-200' : 'border-gray-200 bg-white text-gray-700'
                          }`}
                        >
                          <span className="truncate">{file.name}</span>
                          <button
                            type="button"
                            className={isDark ? 'text-red-300 hover:text-red-200' : 'text-red-600 hover:text-red-500'}
                            onClick={() => {
                              setNewTaskFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index));
                            }}
                          >
                            {t('projects.task.attachment.removeSelected')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <Button type="submit" disabled={creatingTask}>
                    {creatingTask ? t('projects.task.creating') : t('projects.create')}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      if (creatingTask) return;
                      setShowCreateTask(false);
                      setNewTaskFiles([]);
                    }}
                    variant="secondary"
                    disabled={creatingTask}
                  >
                    {t('projects.cancel')}
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
                      const taskId = e.dataTransfer.getData('taskId');
                      if (taskId) handleUpdateTaskStatus(taskId, status);
                    }}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-xs uppercase tracking-wide">
                        {t(`projects.status.${status}`) || status.replace('_', ' ')}
                      </h3>
                      <Badge variant="neutral">{statusTasks.length}</Badge>
                    </div>
                    {workflowConfig.instructions[status]?.trim() && (
                      <div className={`mb-3 rounded border px-2 py-1 text-[11px] leading-4 ${isDark ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-600'}`}>
                        {workflowConfig.instructions[status]}
                      </div>
                    )}
                    {statusTasks.length === 0 ? (
                      <div className={`rounded-lg border border-dashed px-3 py-5 text-center text-xs ${isDark ? 'border-gray-700 text-gray-500' : 'border-gray-300 text-gray-400'}`}>
                        {t('projects.task.emptyColumn')}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {statusTasks.map((task) => {
                          const assignedMember = teamMemberLookup.get(task.assignedTo);
                          const canDrag = user?.id === task.assignedTo;
                          const canEditTask = Boolean(isOwner || user?.id === task.assignedTo);

                          return (
                            <Card
                              key={task.id}
                              className={`p-3 ${
                                canDrag
                                  ? isDark
                                    ? 'cursor-move hover:bg-gray-700'
                                    : 'cursor-move hover:shadow-sm'
                                  : 'cursor-not-allowed opacity-90'
                              } transition-all`}
                              draggable={canDrag}
                              onDragStart={(e) => {
                                if (!canDrag) return;
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('taskId', task.id);
                              }}
                            >
                              <div className="font-medium text-sm leading-5">{task.title}</div>
                              {task.description && (
                                <div className={`text-xs mt-1.5 break-words overflow-hidden ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                  {task.description}
                                </div>
                              )}

                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                <div className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                                  📎 {task.attachments?.length || 0} {t('projects.task.attachments')}
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  className="h-8 whitespace-nowrap"
                                  onClick={() => setAttachmentsTaskId(task.id)}
                                >
                                  {t('projects.task.attachment.manage')}
                                </Button>
                              </div>

                              <div className={`text-xs mt-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                                {t('projects.task.assignee')}: {assignedMember ? `${assignedMember.displayName} (@${assignedMember.username})` : task.assignedTo}
                              </div>

                              {!canDrag && (
                                <div className={`text-[11px] mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                  {t('projects.task.drag.onlyAssignee')}
                                </div>
                              )}

                              {task.priority && (
                                <Badge
                                  variant={
                                    task.priority === 'high'
                                      ? 'danger'
                                      : task.priority === 'medium'
                                        ? 'warning'
                                        : 'success'
                                  }
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
                                    {t('projects.task.edit')}
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
          </div>
        )}

        {activeTab === 'team' && (
          <Card className="p-4 sm:p-6 space-y-5">
            <SectionHeader
              title={t('projects.tab.team')}
              actions={<Badge variant="neutral">{project.teamMemberIds.length}</Badge>}
            />

            {isOwner && (
              <Card tone="muted" className="p-3 sm:p-4">
                <SectionHeader
                  title={t('projects.team.invite.title')}
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
                    <label className={`block text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.team.invite.usernameLabel')}
                    </label>
                    <div className="relative">
                      <Input
                        value={inviteUsername}
                        onChange={(e) => {
                          setInviteUsername(e.target.value);
                          setInviteStatus('');
                        }}
                        placeholder={t('projects.team.invite.usernamePlaceholder')}
                      />
                      {project.roomId && (
                        <InvitePopup
                          roomId={project.roomId}
                          query={inviteUsername}
                          visible={activeTab === 'team' && inviteUsername.trim().length > 0}
                          onSelect={(username) => {
                            setInviteUsername(username);
                            setInviteStatus('');
                          }}
                        />
                      )}
                    </div>
                    <div className={`text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {t('projects.team.invite.usernameHint')}
                    </div>

                    <Button
                      type="submit"
                      disabled={inviting}
                      size="sm"
                      className="w-full sm:w-auto"
                    >
                      {t('projects.team.invite.submit')}
                    </Button>
                  </form>
                </div>

                {inviteStatus && (
                  <div
                    className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                      isDark
                        ? 'border-blue-800/50 bg-blue-900/20 text-blue-300'
                        : 'border-blue-200 bg-blue-50 text-blue-700'
                    }`}
                  >
                    {inviteStatus}
                  </div>
                )}
              </Card>
            )}

            {project.teamMemberIds.length === 0 ? (
              <EmptyState title={t('projects.team.empty')} icon="👥" />
            ) : (
              <div className="space-y-3">
                {project.teamMemberIds.map((memberId) => {
                  const member = teamMemberLookup.get(memberId);
                  return (
                    <Card key={memberId} tone="muted" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-4">
                      <div>
                        <div className="text-sm font-semibold">
                          {member ? `${member.displayName} (@${member.username})` : memberId}
                        </div>
                        <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {member?.email || getUserTypeLabel(member?.userType) || memberId}
                        </div>
                      </div>
                      {memberId === project.ownerId && (
                        <Badge variant="info">{t('projects.team.owner')}</Badge>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {activeTab === 'secrets' && (
          <SecretManager projectId={projectId!} isOwner={isOwner || false} />
        )}
      </div>

      {showWorkflowModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => {
            if (!savingWorkflow) setShowWorkflowModal(false);
          }}
        >
          <Card
            className={`w-full max-w-2xl p-4 sm:p-5 max-h-[85vh] overflow-y-auto ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <SectionHeader title={t('projects.workflow.title')} className="mb-2" />
            <p className={`text-sm mb-4 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {t('projects.workflow.description')}
            </p>

            <div className="mb-4">
              <div className={`text-xs font-medium uppercase tracking-wide mb-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                {t('projects.workflow.optionalStatuses')}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {OPTIONAL_TASK_STATUSES.map((status) => {
                  const checked = workflowEnabledStatuses.includes(status);
                  return (
                    <label
                      key={status}
                      className={`flex items-center gap-2 rounded border px-3 py-2 text-sm ${isDark ? 'border-gray-700 bg-gray-800/70 text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-700'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const isChecked = e.target.checked;
                          setWorkflowEnabledStatuses((prev) => {
                            if (isChecked) return [...new Set([...prev, status])];
                            return prev.filter((item) => item !== status);
                          });
                        }}
                      />
                      {t(`projects.status.${status}`)}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <div className={`text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                {t('projects.workflow.instructions')}
              </div>
              {draftWorkflowStatuses.map((status) => (
                <div key={status}>
                  <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    {t(`projects.status.${status}`)}
                  </label>
                  <textarea
                    rows={2}
                    value={workflowInstructions[status] || ''}
                    onChange={(e) => {
                      const value = e.target.value;
                      setWorkflowInstructions((prev) => ({ ...prev, [status]: value }));
                    }}
                    placeholder={t('projects.workflow.instructionsPlaceholder')}
                    className={textAreaCls}
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <Button type="button" onClick={saveWorkflow} disabled={savingWorkflow}>
                {savingWorkflow ? t('projects.workflow.saving') : t('projects.workflow.save')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowWorkflowModal(false)}
                disabled={savingWorkflow}
              >
                {t('projects.cancel')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {showProjectContextModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => {
            if (!savingProjectContext) setShowProjectContextModal(false);
          }}
        >
          <Card
            className={`w-full max-w-2xl p-4 sm:p-5 max-h-[85vh] overflow-y-auto ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <SectionHeader title={t('projects.context.title')} className="mb-2" />
            <p className={`text-sm mb-4 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {t('projects.context.description')}
            </p>

            <div className="space-y-4">
              <div>
                <div className={`text-xs font-medium uppercase tracking-wide mb-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('projects.context.dod.title')}
                </div>
                <div className="space-y-2">
                  {projectContextDraft.definitionOfDone.map((item, index) => (
                    <div key={`dod-${index}`} className="flex flex-col sm:flex-row gap-2">
                      <textarea
                        rows={2}
                        value={item}
                        onChange={(e) => updateDefinitionOfDoneItem(index, e.target.value)}
                        placeholder={t('projects.context.dod.placeholder')}
                        className={textAreaCls}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        className="w-full sm:w-auto shrink-0 sm:self-start"
                        onClick={() => removeDefinitionOfDoneItem(index)}
                      >
                        {t('projects.context.remove')}
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <Button type="button" size="sm" variant="secondary" onClick={addDefinitionOfDoneItem}>
                    {t('projects.context.dod.add')}
                  </Button>
                </div>
              </div>

              <div>
                <div className={`text-xs font-medium uppercase tracking-wide mb-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('projects.context.decision.title')}
                </div>
                <div className="space-y-3">
                  {projectContextDraft.decisionLog.map((entry) => (
                    <div
                      key={entry.id}
                      className={`rounded border p-3 space-y-2 ${isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-gray-50'}`}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            {t('projects.context.decision.date')}
                          </label>
                          <Input
                            type="date"
                            value={entry.date}
                            onChange={(e) => updateDecisionLogEntry(entry.id, { date: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            {t('projects.context.decision.entryTitle')}
                          </label>
                          <Input
                            type="text"
                            value={entry.title}
                            onChange={(e) => updateDecisionLogEntry(entry.id, { title: e.target.value })}
                          />
                        </div>
                      </div>
                      <div>
                        <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                          {t('projects.context.decision.decision')}
                        </label>
                        <textarea
                          rows={2}
                          value={entry.decision}
                          onChange={(e) => updateDecisionLogEntry(entry.id, { decision: e.target.value })}
                          className={textAreaCls}
                        />
                      </div>
                      <div>
                        <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                          {t('projects.context.decision.rationale')}
                        </label>
                        <textarea
                          rows={2}
                          value={entry.rationale}
                          onChange={(e) => updateDecisionLogEntry(entry.id, { rationale: e.target.value })}
                          className={textAreaCls}
                        />
                      </div>
                      <Button type="button" size="sm" variant="danger" className="w-full sm:w-auto" onClick={() => removeDecisionLogEntry(entry.id)}>
                        {t('projects.context.remove')}
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <Button type="button" size="sm" variant="secondary" onClick={addDecisionLogEntry}>
                    {t('projects.context.decision.add')}
                  </Button>
                </div>
              </div>

              <div>
                <div className={`text-xs font-medium uppercase tracking-wide mb-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('projects.context.milestones.title')}
                </div>
                <div className="space-y-3">
                  {projectContextDraft.milestones.map((entry) => (
                    <div
                      key={entry.id}
                      className={`rounded border p-3 space-y-2 ${isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-gray-50'}`}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            {t('projects.context.milestones.name')}
                          </label>
                          <Input
                            type="text"
                            value={entry.title}
                            onChange={(e) => updateMilestoneEntry(entry.id, { title: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            {t('projects.context.milestones.deadline')}
                          </label>
                          <Input
                            type="date"
                            value={entry.dueDate}
                            onChange={(e) => updateMilestoneEntry(entry.id, { dueDate: e.target.value })}
                          />
                        </div>
                      </div>
                      <div>
                        <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                          {t('projects.context.milestones.status')}
                        </label>
                        <Select
                          value={entry.status}
                          onChange={(e) => updateMilestoneEntry(entry.id, { status: e.target.value as MilestoneStatus })}
                        >
                          <option value="planned">{t('projects.context.milestones.status.planned')}</option>
                          <option value="in_progress">{t('projects.context.milestones.status.in_progress')}</option>
                          <option value="done">{t('projects.context.milestones.status.done')}</option>
                        </Select>
                      </div>
                      <div>
                        <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                          {t('projects.context.milestones.notes')}
                        </label>
                        <textarea
                          rows={2}
                          value={entry.notes}
                          onChange={(e) => updateMilestoneEntry(entry.id, { notes: e.target.value })}
                          className={textAreaCls}
                        />
                      </div>
                      <Button type="button" size="sm" variant="danger" className="w-full sm:w-auto" onClick={() => removeMilestoneEntry(entry.id)}>
                        {t('projects.context.remove')}
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <Button type="button" size="sm" variant="secondary" onClick={addMilestoneEntry}>
                    {t('projects.context.milestones.add')}
                  </Button>
                </div>
              </div>

              <div>
                <div className={`text-xs font-medium uppercase tracking-wide mb-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('projects.context.brief.title')}
                </div>
                <div className="space-y-2">
                  <div>
                    <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.brief.goal')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.brief.goal}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          brief: { ...prev.brief, goal: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.brief.scope')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.brief.scope}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          brief: { ...prev.brief, scope: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.brief.outOfScope')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.brief.outOfScope}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          brief: { ...prev.brief, outOfScope: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.brief.successCriteria')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.brief.successCriteria}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          brief: { ...prev.brief, successCriteria: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className={`text-xs font-medium uppercase tracking-wide mb-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('projects.context.runbook.title')}
                </div>
                <div className="space-y-2">
                  <div>
                    <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.runbook.preferredLanguage')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.runbook.preferredLanguage}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          runbook: { ...prev.runbook, preferredLanguage: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.runbook.responseStyle')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.runbook.responseStyle}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          runbook: { ...prev.runbook, responseStyle: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.runbook.constraints')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.runbook.constraints}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          runbook: { ...prev.runbook, constraints: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                  <div>
                    <label className={`block text-xs mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.context.runbook.escalationPath')}
                    </label>
                    <textarea
                      rows={2}
                      value={projectContextDraft.runbook.escalationPath}
                      onChange={(e) =>
                        setProjectContextDraft((prev) => ({
                          ...prev,
                          runbook: { ...prev.runbook, escalationPath: e.target.value },
                        }))
                      }
                      className={textAreaCls}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <Button type="button" onClick={saveProjectContext} disabled={savingProjectContext}>
                {savingProjectContext ? t('projects.context.saving') : t('projects.context.save')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowProjectContextModal(false)}
                disabled={savingProjectContext}
              >
                {t('projects.cancel')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {attachmentsTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setAttachmentsTaskId(null)}
        >
          <Card
            className={`w-full max-w-2xl p-4 sm:p-5 max-h-[85vh] overflow-y-auto ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <SectionHeader
              title={t('projects.task.attachment.manage')}
              className="mb-3"
              actions={<Badge variant="neutral">{attachmentsTask.attachments?.length || 0}</Badge>}
            />

            <div className={`mb-3 text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
              {attachmentsTask.title}
            </div>

            {isTeamMember && (
              <div className="mb-4">
                <label
                  className={`inline-flex cursor-pointer items-center rounded-md border px-3 py-1.5 text-xs ${
                    isDark
                      ? 'border-gray-600 bg-gray-800 text-gray-200 hover:bg-gray-700'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                  } ${uploadingTaskAttachments[attachmentsTask.id] ? 'pointer-events-none opacity-70' : ''}`}
                >
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    disabled={uploadingTaskAttachments[attachmentsTask.id]}
                    onChange={(e) => {
                      const selected = Array.from(e.target.files || []);
                      if (selected.length > 0) {
                        handleTaskAttachmentUpload(attachmentsTask.id, selected);
                      }
                      e.currentTarget.value = '';
                    }}
                  />
                  {uploadingTaskAttachments[attachmentsTask.id]
                    ? t('projects.task.attachment.uploading')
                    : t('projects.task.attachment.add')}
                </label>
              </div>
            )}

            {attachmentsTask.attachments && attachmentsTask.attachments.length > 0 ? (
              <div className="space-y-2">
                {attachmentsTask.attachments.map((attachment) => {
                  const deleteKey = `${attachmentsTask.id}:${attachment.id}`;
                  const isDeletingAttachment = deletingTaskAttachments[deleteKey];
                  const canDeleteAttachment = Boolean(
                    user && (isOwner || user.id === attachmentsTask.assignedTo || user.id === attachment.uploadedBy),
                  );

                  return (
                    <div
                      key={attachment.id}
                      className={`flex flex-col sm:flex-row gap-2 rounded border p-2 ${isDark ? 'border-gray-700 bg-gray-800/70' : 'border-gray-200 bg-gray-50'}`}
                    >
                      <a
                        href={authFileUrl(attachment.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex-1 min-w-0 rounded border px-2 py-1 text-xs transition-colors ${
                          isDark
                            ? 'border-gray-700 bg-gray-800 hover:bg-gray-700 text-blue-300'
                            : 'border-gray-200 bg-white hover:bg-gray-50 text-blue-600'
                        }`}
                        title={attachment.filename}
                      >
                        <div className="truncate">{attachment.filename}</div>
                        <div className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                          {formatFileSize(attachment.size)}
                        </div>
                      </a>
                      {canDeleteAttachment && (
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          className="w-full sm:w-auto shrink-0 whitespace-nowrap"
                          onClick={() => handleTaskAttachmentDelete(attachmentsTask.id, attachment.id)}
                          disabled={Boolean(isDeletingAttachment)}
                        >
                          {isDeletingAttachment
                            ? t('projects.task.attachment.deleting')
                            : t('projects.task.attachment.delete')}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={`rounded border border-dashed px-3 py-6 text-center text-sm ${isDark ? 'border-gray-700 text-gray-500' : 'border-gray-300 text-gray-400'}`}>
                {t('projects.task.attachment.empty')}
              </div>
            )}

            <div className="mt-4">
              <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setAttachmentsTaskId(null)}>
                {t('projects.task.attachment.close')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {editingTaskId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={cancelEditTask}
        >
          <Card
            className={`w-full max-w-lg p-4 sm:p-5 max-h-[85vh] overflow-y-auto ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <SectionHeader
              title={t('projects.task.edit')}
              className="mb-3"
              actions={
                editingTask ? (
                  <Badge variant="neutral">{t(`projects.status.${editingTask.status}`) || editingTask.status}</Badge>
                ) : undefined
              }
            />
            <div className="space-y-3">
              <Input
                value={editTaskTitle}
                onChange={(e) => setEditTaskTitle(e.target.value)}
                placeholder={t('projects.task.title.placeholder')}
                autoFocus
              />
              <textarea
                value={editTaskDesc}
                onChange={(e) => setEditTaskDesc(e.target.value)}
                rows={3}
                className={textAreaCls}
                placeholder={t('projects.task.description.placeholder')}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select
                  value={editTaskPriority}
                  onChange={(e) => setEditTaskPriority(e.target.value)}
                >
                  {PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>{t(`projects.priority.${priority}`)}</option>
                  ))}
                </Select>
                <Select
                  value={editTaskAssignee}
                  onChange={(e) => setEditTaskAssignee(e.target.value)}
                >
                  {project.teamMemberIds.map((memberId) => {
                    const member = teamMemberLookup.get(memberId);
                    const label = member ? `${member.displayName} (@${member.username})` : memberId;
                    return <option key={memberId} value={memberId}>{label}</option>;
                  })}
                </Select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <Button
                  type="button"
                  onClick={() => saveTaskEdit(editingTaskId)}
                  disabled={savingTaskEdit || !editTaskTitle.trim() || !editTaskAssignee}
                  className="w-full"
                >
                  {savingTaskEdit ? t('projects.task.saving') : t('projects.task.save')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={cancelEditTask}
                  disabled={savingTaskEdit}
                  className="w-full"
                >
                  {t('projects.task.cancel')}
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
                {t('projects.task.delete')}
              </Button>
            </div>
          </Card>
        </div>
      )}
      <ConfirmDialog
        open={!!deleteTaskId}
        title={t('projects.task.delete.title')}
        message={t('projects.task.delete.message').replace('{title}', taskToDelete?.title || '')}
        confirmLabel={t('projects.task.delete')}
        cancelLabel={t('projects.cancel')}
        variant="danger"
        loading={deletingTask}
        onConfirm={confirmDeleteTask}
        onCancel={() => {
          if (!deletingTask) setDeleteTaskId(null);
        }}
      />
      <ConfirmDialog
        open={showDeleteDialog}
        title={t('projects.delete.title')}
        message={t('projects.delete.message').replace('{name}', project.name)}
        confirmLabel={t('projects.actions.delete')}
        cancelLabel={t('projects.cancel')}
        variant="danger"
        loading={deletingProject}
        onConfirm={confirmDeleteProject}
        onCancel={() => {
          if (!deletingProject) setShowDeleteDialog(false);
        }}
      />
    </div>
  );
};
