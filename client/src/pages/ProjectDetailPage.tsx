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
  status: string; // todo | in_progress | done | blocked
  assignedTo?: string;
  priority?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

interface TeamMember {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
}

const TASK_STATUSES = ['todo', 'in_progress', 'done', 'blocked'];
const PRIORITIES = ['low', 'medium', 'high'];

export const ProjectDetailPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const { user } = useAuthStore();
  const isDark = theme === 'dark';

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showCreateTask, setShowCreateTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');

  const [activeTab, setActiveTab] = useState<'tasks' | 'team' | 'secrets'>('tasks');

  const isOwner = project && user && project.ownerId === user.id;

  useEffect(() => {
    if (projectId) loadProject();
  }, [projectId]);

  const loadProject = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/projects/${projectId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setProject(data);
        setTasks(data.tasks || []);
        setError('');
      } else {
        setError('Project not found');
      }
    } catch (err) {
      setError('Failed to load project');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !projectId) return;

    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: newTaskTitle,
          description: newTaskDesc,
          priority: newTaskPriority,
        }),
      });

      if (res.ok) {
        const newTask = await res.json();
        setTasks([...tasks, newTask]);
        setNewTaskTitle('');
        setNewTaskDesc('');
        setNewTaskPriority('medium');
        setShowCreateTask(false);
      } else {
        setError('Failed to create task');
      }
    } catch (err) {
      setError('Error creating task');
      console.error(err);
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, newStatus: string) => {
    if (!projectId) return;

    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        const updated = await res.json();
        setTasks(tasks.map(t => (t.id === taskId ? updated : t)));
      }
    } catch (err) {
      console.error('Error updating task:', err);
    }
  };

  const getTasksByStatus = (status: string) => tasks.filter(t => t.status === status);

  if (loading) {
    return (
      <div className={`p-8 ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
        <div className="animate-pulse">Loading project...</div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div
        className={`p-8 ${isDark ? 'bg-gray-900 text-red-300' : 'bg-white text-red-600'}`}
      >
        {error || 'Project not found'}
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className={`border-b ${isDark ? 'border-gray-800 bg-gray-800' : 'border-gray-200 bg-white'} p-8`}>
        <h1 className="text-4xl font-bold mb-2">{project.name}</h1>
        {project.description && (
          <p className={`text-lg ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            {project.description}
          </p>
        )}
        <div className={`mt-4 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          <span className={`inline-block px-3 py-1 rounded-full mr-4 ${
            project.status === 'active'
              ? isDark
                ? 'bg-green-900 text-green-200'
                : 'bg-green-100 text-green-800'
              : isDark
              ? 'bg-gray-700 text-gray-300'
              : 'bg-gray-200 text-gray-700'
          }`}>
            {project.status}
          </span>
          Created {new Date(project.createdAt).toLocaleDateString()}
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
                  ? isDark
                    ? 'border-blue-500 text-blue-400'
                    : 'border-blue-600 text-blue-600'
                  : isDark
                  ? 'border-transparent text-gray-400 hover:text-gray-300'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Tasks Board */}
        {activeTab === 'tasks' && (
          <div>
            {isOwner && !showCreateTask && (
              <button
                onClick={() => setShowCreateTask(true)}
                className={`mb-6 rounded px-4 py-2 font-medium ${
                  isDark
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : 'bg-blue-500 hover:bg-blue-600 text-white'
                }`}
              >
                + New Task
              </button>
            )}

            {showCreateTask && isOwner && (
              <form
                onSubmit={handleCreateTask}
                className={`mb-6 rounded-lg border-l-4 border-blue-500 p-6 ${
                  isDark ? 'bg-gray-800' : 'bg-blue-50'
                }`}
              >
                <input
                  type="text"
                  placeholder="Task title"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className={`mb-3 w-full rounded border px-3 py-2 ${
                    isDark ? 'border-gray-600 bg-gray-700 text-white' : 'border-gray-300'
                  }`}
                  autoFocus
                />
                <textarea
                  placeholder="Description (optional)"
                  value={newTaskDesc}
                  onChange={(e) => setNewTaskDesc(e.target.value)}
                  className={`mb-3 w-full rounded border px-3 py-2 ${
                    isDark ? 'border-gray-600 bg-gray-700 text-white' : 'border-gray-300'
                  }`}
                  rows={3}
                />
                <div className="mb-4 flex gap-4">
                  <select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value)}
                    className={`rounded border px-3 py-2 ${
                      isDark ? 'border-gray-600 bg-gray-700 text-white' : 'border-gray-300'
                    }`}
                  >
                    {PRIORITIES.map(p => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className={`rounded px-4 py-2 font-medium ${
                      isDark
                        ? 'bg-green-600 hover:bg-green-700 text-white'
                        : 'bg-green-500 hover:bg-green-600 text-white'
                    }`}
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreateTask(false)}
                    className={`rounded px-4 py-2 ${
                      isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'
                    }`}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Kanban Board */}
            <div className="grid grid-cols-4 gap-4">
              {TASK_STATUSES.map((status) => (
                <div
                  key={status}
                  className={`rounded-lg p-4 ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}
                >
                  <h3 className="mb-4 font-bold capitalize">
                    {status.replace('_', ' ')} ({getTasksByStatus(status).length})
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
                          e.dataTransfer.setData('fromStatus', status);
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const taskId = e.dataTransfer.getData('taskId');
                          if (taskId !== task.id) {
                            handleUpdateTaskStatus(taskId, status);
                          }
                        }}
                      >
                        <div className="font-medium text-sm">{task.title}</div>
                        {task.description && (
                          <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            {task.description}
                          </div>
                        )}
                        {task.priority && (
                          <div className="mt-2 inline-block">
                            <span className={`text-xs px-2 py-1 rounded ${
                              task.priority === 'high'
                                ? 'bg-red-900 text-red-200'
                                : task.priority === 'medium'
                                ? 'bg-yellow-900 text-yellow-200'
                                : 'bg-green-900 text-green-200'
                            }`}>
                              {task.priority}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Team Tab */}
        {activeTab === 'team' && (
          <div className={`rounded-lg border ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'} p-6`}>
            <h2 className="mb-4 text-xl font-bold">Team Members ({project.teamMemberIds.length})</h2>
            <div className="space-y-3">
              {project.teamMemberIds.map((memberId, idx) => (
                <div
                  key={memberId}
                  className={`flex items-center justify-between p-4 rounded ${
                    isDark ? 'bg-gray-700' : 'bg-gray-50'
                  }`}
                >
                  <div>
                    <div className="font-medium">Member {idx + 1}</div>
                    <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      ID: {memberId}
                    </div>
                  </div>
                  {memberId === project.ownerId && (
                    <span className="text-xs px-2 py-1 rounded bg-purple-600 text-purple-100">
                      Owner
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Secrets Tab */}
        {activeTab === 'secrets' && (
          <SecretManager projectId={projectId!} isOwner={isOwner || false} />
        )}
      </div>
    </div>
  );
};
