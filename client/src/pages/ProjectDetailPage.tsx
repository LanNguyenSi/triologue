import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuthStore } from '../stores/authStore';
import { SecretManager } from '../components/projects/SecretManager';

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

const TASK_STATUSES = ['todo', 'in_progress', 'done', 'blocked'];
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

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');

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
      if (res.ok) {
        const updated = await res.json();
        setTasks(tasks.map((task) => (task.id === taskId ? updated : task)));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectId || !project) return;
    const confirmText = t('projects.delete.confirm').replace('{name}', project.name);
    const failedText = t('projects.delete.failed');
    const confirmed = window.confirm(confirmText);
    if (!confirmed) return;

    setDeletingProject(true);
    try {
      const res = await api(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      navigate('/projects');
    } catch (err) {
      console.error(err);
      alert(failedText);
    } finally {
      setDeletingProject(false);
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

  const inputCls = `w-full rounded border px-3 py-2 text-sm ${
    isDark ? 'border-gray-600 bg-gray-700 text-white placeholder-gray-400' : 'border-gray-300 bg-white'
  }`;

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
      <div className={`p-8 ${isDark ? 'bg-gray-900 text-red-300' : 'bg-white text-red-600'}`}>
        {error || t('projects.detail.notFound')}
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className={`border-b ${isDark ? 'border-gray-800 bg-gray-800' : 'border-gray-200 bg-white'} p-8`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2">{project.name}</h1>
            {project.description && (
              <p className={`text-lg ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{project.description}</p>
            )}
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={handleDeleteProject}
              disabled={deletingProject}
              className={`rounded px-3 py-2 text-sm font-medium ${
                deletingProject ? 'opacity-50 cursor-not-allowed' : ''
              } ${isDark ? 'bg-red-700 hover:bg-red-600 text-red-100' : 'bg-red-600 hover:bg-red-500 text-white'}`}
            >
              {deletingProject ? t('projects.actions.deleting') : t('projects.actions.delete')}
            </button>
          )}
        </div>

        <div className={`mt-4 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          <span className={`inline-block px-3 py-1 rounded-full mr-4 ${
            project.status === 'active'
              ? isDark ? 'bg-green-900 text-green-200' : 'bg-green-100 text-green-800'
              : isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
          }`}>
            {t(`projects.status.${project.status}`) || project.status}
          </span>
          {t('projects.detail.created')} {new Date(project.createdAt).toLocaleDateString()}
          {project.roomId && (
            <span className="ml-4">🔒 {t('projects.room.linked')}: {project.roomId}</span>
          )}
        </div>
      </div>

      <div className={`border-b ${isDark ? 'border-gray-800' : 'border-gray-200'}`}>
        <div className="max-w-7xl mx-auto px-8 flex gap-8">
          {(['tasks', 'team', 'secrets'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-4 px-4 font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? isDark ? 'border-blue-500 text-blue-400' : 'border-blue-600 text-blue-600'
                  : isDark ? 'border-transparent text-gray-400 hover:text-gray-300' : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {activeTab === 'tasks' && (
          <div>
            {isTeamMember && !showCreateTask && (
              <button
                onClick={() => setShowCreateTask(true)}
                className={`mb-6 rounded px-4 py-2 font-medium text-sm ${
                  isDark ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
                } text-white`}
              >
                {t('projects.task.add')}
              </button>
            )}

            {showCreateTask && isTeamMember && (
              <form
                onSubmit={handleCreateTask}
                className={`mb-6 rounded-lg border-l-4 border-blue-500 p-4 ${isDark ? 'bg-gray-800' : 'bg-blue-50'}`}
              >
                <input
                  type="text"
                  placeholder={t('projects.task.title.placeholder')}
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className={`${inputCls} mb-3`}
                  autoFocus
                />
                <textarea
                  placeholder={t('projects.task.description.placeholder')}
                  value={newTaskDesc}
                  onChange={(e) => setNewTaskDesc(e.target.value)}
                  className={`${inputCls} mb-3`}
                  rows={3}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  <select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value)}
                    className={inputCls}
                  >
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>{t(`projects.priority.${priority}`)}</option>
                    ))}
                  </select>

                  <select
                    value={newTaskAssignee}
                    onChange={(e) => setNewTaskAssignee(e.target.value)}
                    className={inputCls}
                  >
                    {project.teamMemberIds.map((memberId) => {
                      const member = teamMemberLookup.get(memberId);
                      const label = member ? `${member.displayName} (@${member.username})` : memberId;
                      return <option key={memberId} value={memberId}>{label}</option>;
                    })}
                  </select>
                </div>

                <div className="flex gap-2">
                  <button type="submit" className={`rounded px-4 py-2 text-sm font-medium ${
                    isDark ? 'bg-green-600 hover:bg-green-700' : 'bg-green-500 hover:bg-green-600'
                  } text-white`}>
                    {t('projects.create')}
                  </button>
                  <button type="button" onClick={() => setShowCreateTask(false)} className={`rounded px-4 py-2 text-sm ${
                    isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300'
                  }`}>
                    {t('projects.cancel')}
                  </button>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {TASK_STATUSES.map((status) => (
                <div
                  key={status}
                  className={`rounded-lg p-4 min-h-[200px] ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const taskId = e.dataTransfer.getData('taskId');
                    if (taskId) handleUpdateTaskStatus(taskId, status);
                  }}
                >
                  <h3 className="mb-4 font-bold text-sm">
                    {t(`projects.status.${status}`) || status.replace('_', ' ')} ({getTasksByStatus(status).length})
                  </h3>
                  <div className="space-y-2">
                    {getTasksByStatus(status).map((task) => {
                      const assignedMember = teamMemberLookup.get(task.assignedTo);
                      const canDrag = user?.id === task.assignedTo;

                      return (
                        <div
                          key={task.id}
                          className={`rounded-lg p-3 ${
                            isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-white hover:shadow-md'
                          } ${canDrag ? 'cursor-move' : 'cursor-not-allowed opacity-90'} transition-all`}
                          draggable={canDrag}
                          onDragStart={(e) => {
                            if (!canDrag) return;
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('taskId', task.id);
                          }}
                        >
                          <div className="font-medium text-sm">{task.title}</div>
                          {task.description && (
                            <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
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
                            <span className={`mt-2 inline-block text-xs px-2 py-0.5 rounded ${
                              task.priority === 'high' ? 'bg-red-900/40 text-red-300'
                                : task.priority === 'medium' ? 'bg-yellow-900/40 text-yellow-300'
                                : 'bg-green-900/40 text-green-300'
                            }`}>
                              {t(`projects.priority.${task.priority}`)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'team' && (
          <div className={`rounded-lg border ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} p-6`}>
            <h2 className="mb-4 text-xl font-bold">{t('projects.tab.team')} ({project.teamMemberIds.length})</h2>

            {isOwner && (
              <div className={`mb-6 rounded-lg border p-4 ${isDark ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50'}`}>
                <div className="font-medium mb-3">{t('projects.team.invite.title')}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!inviteEmail.trim()) return;
                      handleInvite({ email: inviteEmail.trim() });
                    }}
                    className="space-y-2"
                  >
                    <label className="text-sm">{t('projects.team.invite.emailLabel')}</label>
                    <input
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="name@example.com"
                      className={inputCls}
                    />
                    <button
                      type="submit"
                      disabled={inviting}
                      className={`rounded px-3 py-1.5 text-sm ${isDark ? 'bg-blue-700 hover:bg-blue-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
                    >
                      {t('projects.team.invite.submit')}
                    </button>
                  </form>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!inviteUsername.trim()) return;
                      handleInvite({ username: inviteUsername.trim() });
                    }}
                    className="space-y-2"
                  >
                    <label className="text-sm">{t('projects.team.invite.usernameLabel')}</label>
                    <input
                      value={inviteUsername}
                      onChange={(e) => setInviteUsername(e.target.value)}
                      placeholder={t('projects.team.invite.usernamePlaceholder')}
                      className={inputCls}
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
                            <button
                              type="button"
                              onClick={() => setInviteUsername(candidate.username)}
                              className={`text-left flex-1 ${isDark ? 'hover:text-white' : 'hover:text-gray-900'}`}
                            >
                              {candidate.displayName} (@{candidate.username}) • {getUserTypeLabel(candidate.userType)}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleInvite({ username: candidate.username })}
                              className={`px-2 py-1 rounded text-xs font-semibold ${
                                isDark ? 'bg-blue-700 hover:bg-blue-600 text-blue-100' : 'bg-blue-100 hover:bg-blue-200 text-blue-700'
                              }`}
                            >
                              + {t('projects.team.invite.add')}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={inviting}
                      className={`rounded px-3 py-1.5 text-sm ${isDark ? 'bg-blue-700 hover:bg-blue-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
                    >
                      {t('projects.team.invite.submit')}
                    </button>
                  </form>
                </div>

                {inviteStatus && (
                  <div className={`mt-3 text-sm ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>{inviteStatus}</div>
                )}
              </div>
            )}

            {project.teamMemberIds.length === 0 ? (
              <p className={isDark ? 'text-gray-500' : 'text-gray-400'}>{t('projects.team.empty')}</p>
            ) : (
              <div className="space-y-3">
                {project.teamMemberIds.map((memberId) => {
                  const member = teamMemberLookup.get(memberId);
                  return (
                    <div key={memberId} className={`flex items-center justify-between p-4 rounded ${isDark ? 'bg-gray-700' : 'bg-gray-50'}`}>
                      <div>
                        <div className="font-medium">
                          {member ? `${member.displayName} (@${member.username})` : memberId}
                        </div>
                        <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {member?.email || getUserTypeLabel(member?.userType) || memberId}
                        </div>
                      </div>
                      {memberId === project.ownerId && (
                        <span className="text-xs px-2 py-1 rounded bg-purple-600 text-purple-100">{t('projects.team.owner')}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'secrets' && (
          <SecretManager projectId={projectId!} isOwner={isOwner || false} />
        )}
      </div>
    </div>
  );
};
