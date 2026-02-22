import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuthStore } from '../stores/authStore';
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

interface InvitableUser {
  id: string;
  username: string;
  displayName: string;
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
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
}

const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'done', 'blocked'];
const PRIORITIES = ['low', 'medium', 'high'];

const api = (path: string, opts?: RequestInit) => {
  const token = localStorage.getItem('triologue_token');
  return fetch(path, {
    ...opts,
    headers: { ...(opts?.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskTitle, setEditTaskTitle] = useState('');
  const [editTaskDesc, setEditTaskDesc] = useState('');
  const [editTaskPriority, setEditTaskPriority] = useState('medium');
  const [editTaskAssignee, setEditTaskAssignee] = useState('');
  const [savingTaskEdit, setSavingTaskEdit] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [invitableUsers, setInvitableUsers] = useState<InvitableUser[]>([]);
  const [inviteStatus, setInviteStatus] = useState('');
  const [inviting, setInviting] = useState(false);

  const [activeTab, setActiveTab] = useState<'tasks' | 'team' | 'secrets'>('tasks');

  const isOwner = Boolean(project && user && project.ownerId === user.id);
  const isTeamMember = Boolean(project && user && project.teamMemberIds.includes(user.id));

  const teamMembers = useMemo(() => {
    if (!project) return [];
    return project.teamMembers || [];
  }, [project]);

  const teamMemberLookup = useMemo(() => {
    const map = new Map<string, TeamMember>();
    teamMembers.forEach((m) => map.set(m.id, m));
    return map;
  }, [teamMembers]);

  const getUserTypeLabel = (userType?: TeamMember['userType'] | InvitableUser['userType'] | string | null) => {
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

  useEffect(() => {
    const roomId = project?.roomId;
    const query = inviteUsername.trim();

    if (!roomId || activeTab !== 'team' || !query) {
      setInvitableUsers([]);
      return;
    }

    let isCancelled = false;
    const timeout = setTimeout(async () => {
      try {
        const res = await api(`/api/rooms/${roomId}/invitable?q=${encodeURIComponent(query)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!isCancelled) {
          setInvitableUsers(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error(err);
      }
    }, 180);

    return () => {
      isCancelled = true;
      clearTimeout(timeout);
    };
  }, [inviteUsername, project?.roomId, activeTab]);

  const loadProject = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data);
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
      if (res.ok) {
        const createdTask = await res.json();
        setTasks([...tasks, createdTask]);
        setNewTaskTitle('');
        setNewTaskDesc('');
        setNewTaskPriority('medium');
        if (user?.id && project?.teamMemberIds.includes(user.id)) {
          setNewTaskAssignee(user.id);
        }
        setShowCreateTask(false);
      }
    } catch (err) {
      console.error(err);
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

  const handleInvite = async (payload: { email?: string; username?: string; agentUserId?: string }) => {
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

      if (data.mode === 'email-pending') {
        const codeText = t('projects.team.invite.code').replace('{email}', data.email).replace('{code}', data.inviteCode);
        setInviteStatus(codeText);
      } else {
        setInviteStatus(t('projects.team.invite.success'));
      }

      setInviteEmail('');
      setInviteUsername('');
      setInvitableUsers([]);
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
  const taskToDelete = useMemo(
    () => tasks.find((task) => task.id === deleteTaskId) || null,
    [tasks, deleteTaskId],
  );

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
              {isOwner && (
                <div className="shrink-0 flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={handleStartEditProject}
                    variant="secondary"
                    size="sm"
                  >
                    {t('projects.actions.edit')}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleDeleteProject}
                    disabled={deletingProject}
                    variant="danger"
                    size="sm"
                  >
                    {deletingProject ? t('projects.actions.deleting') : t('projects.actions.delete')}
                  </Button>
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
                <div className="mt-3 flex gap-2">
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
            {isTeamMember && !showCreateTask && (
              <Button
                onClick={() => setShowCreateTask(true)}
                className="mb-4 sm:mb-6"
              >
                {t('projects.task.add')}
              </Button>
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

                <div className="flex gap-2">
                  <Button type="submit">
                    {t('projects.create')}
                  </Button>
                  <Button type="button" onClick={() => setShowCreateTask(false)} variant="secondary">
                    {t('projects.cancel')}
                  </Button>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 sm:gap-4">
              {TASK_STATUSES.map((status) => {
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!inviteEmail.trim()) return;
                      handleInvite({ email: inviteEmail.trim() });
                    }}
                    className="space-y-2"
                  >
                    <label className={`block text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {t('projects.team.invite.emailLabel')}
                    </label>
                    <Input
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="name@example.com"
                    />
                    <Button
                      type="submit"
                      disabled={inviting}
                      size="sm"
                    >
                      {t('projects.team.invite.submit')}
                    </Button>
                  </form>

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
                    <Input
                      value={inviteUsername}
                      onChange={(e) => setInviteUsername(e.target.value)}
                      placeholder={t('projects.team.invite.usernamePlaceholder')}
                    />

                    {invitableUsers.length > 0 && (
                      <div className={`rounded border ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
                        {invitableUsers.map((candidate) => (
                          <div
                            key={candidate.id}
                            className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm border-b last:border-b-0 ${
                              isDark ? 'border-gray-700 text-gray-100' : 'border-gray-200 text-gray-800'
                            }`}
                          >
                            <Button
                              type="button"
                              onClick={() => setInviteUsername(candidate.username)}
                              variant="ghost"
                              size="sm"
                              className={`flex-1 !px-0 !py-0 text-left rounded-none justify-start ${isDark ? 'hover:bg-transparent hover:text-white text-gray-100' : 'hover:bg-transparent hover:text-gray-900 text-gray-800'}`}
                            >
                              {candidate.displayName} (@{candidate.username}) • {getUserTypeLabel(candidate.userType)}
                            </Button>
                            <Button
                              type="button"
                              onClick={() => handleInvite({ username: candidate.username })}
                              size="sm"
                              variant="secondary"
                            >
                              + {t('projects.team.invite.add')}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    <Button
                      type="submit"
                      disabled={inviting}
                      size="sm"
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
                    <Card key={memberId} tone="muted" className="flex items-center justify-between p-4">
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

      {editingTaskId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={cancelEditTask}
        >
          <Card
            className={`w-full max-w-lg p-4 sm:p-5 ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}
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
