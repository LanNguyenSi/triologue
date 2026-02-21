import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuthStore } from '../stores/authStore';
import { SecretManager } from '../components/projects/SecretManager';

interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  ownerId: string;
  teamMemberIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: string;
  assignedTo?: string;
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
  const isDark = theme === 'dark';

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');

  const [activeTab, setActiveTab] = useState<'tasks' | 'team' | 'secrets'>('tasks');

  const isOwner = project && user && project.ownerId === user.id;

  useEffect(() => { if (projectId) loadProject(); }, [projectId]);

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
    if (!newTaskTitle.trim() || !projectId) return;
    try {
      const res = await api(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title: newTaskTitle, description: newTaskDesc, priority: newTaskPriority }),
      });
      if (res.ok) {
        const newTask = await res.json();
        setTasks([...tasks, newTask]);
        setNewTaskTitle(''); setNewTaskDesc(''); setNewTaskPriority('medium');
        setShowCreateTask(false);
      }
    } catch (err) { console.error(err); }
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
        setTasks(tasks.map(t => (t.id === taskId ? updated : t)));
      }
    } catch (err) { console.error(err); }
  };

  const getTasksByStatus = (status: string) => tasks.filter(t => t.status === status);

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
      {/* Header */}
      <div className={`border-b ${isDark ? 'border-gray-800 bg-gray-800' : 'border-gray-200 bg-white'} p-8`}>
        <h1 className="text-4xl font-bold mb-2">{project.name}</h1>
        {project.description && (
          <p className={`text-lg ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{project.description}</p>
        )}
        <div className={`mt-4 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          <span className={`inline-block px-3 py-1 rounded-full mr-4 ${
            project.status === 'active'
              ? isDark ? 'bg-green-900 text-green-200' : 'bg-green-100 text-green-800'
              : isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
          }`}>
            {t(`projects.status.${project.status}`) || project.status}
          </span>
          {t('projects.detail.created')} {new Date(project.createdAt).toLocaleDateString()}
        </div>
      </div>

      {/* Tabs */}
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

      {/* Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        {activeTab === 'tasks' && (
          <div>
            {isOwner && !showCreateTask && (
              <button
                onClick={() => setShowCreateTask(true)}
                className={`mb-6 rounded px-4 py-2 font-medium text-sm ${
                  isDark ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
                } text-white`}
              >
                {t('projects.task.add')}
              </button>
            )}

            {showCreateTask && isOwner && (
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
                <select
                  value={newTaskPriority}
                  onChange={(e) => setNewTaskPriority(e.target.value)}
                  className={`${inputCls} mb-4 w-auto`}
                >
                  {PRIORITIES.map(p => (
                    <option key={p} value={p}>{t(`projects.priority.${p}`)}</option>
                  ))}
                </select>
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

            {/* Kanban Board */}
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
                    {getTasksByStatus(status).map((task) => (
                      <div
                        key={task.id}
                        className={`rounded-lg p-3 ${
                          isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-white hover:shadow-md'
                        } cursor-move transition-all`}
                        draggable
                        onDragStart={(e) => {
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
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'team' && (
          <div className={`rounded-lg border ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} p-6`}>
            <h2 className="mb-4 text-xl font-bold">{t('projects.tab.team')} ({project.teamMemberIds.length})</h2>
            {project.teamMemberIds.length === 0 ? (
              <p className={isDark ? 'text-gray-500' : 'text-gray-400'}>{t('projects.team.empty')}</p>
            ) : (
              <div className="space-y-3">
                {project.teamMemberIds.map((memberId, idx) => (
                  <div key={memberId} className={`flex items-center justify-between p-4 rounded ${isDark ? 'bg-gray-700' : 'bg-gray-50'}`}>
                    <div>
                      <div className="font-medium">{t('projects.team.member')} {idx + 1}</div>
                      <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>ID: {memberId}</div>
                    </div>
                    {memberId === project.ownerId && (
                      <span className="text-xs px-2 py-1 rounded bg-purple-600 text-purple-100">Owner</span>
                    )}
                  </div>
                ))}
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
