import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useNotificationStore } from '../stores/notificationStore';

interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  ownerId: string;
  teamMemberIds: string[];
  roomId?: string | null;
  _count?: { tasks: number; secrets: number };
  createdAt: string;
}

const api = (path: string, opts?: RequestInit) => {
  const token = localStorage.getItem('triologue_token');
  return fetch(path, {
    ...opts,
    headers: { ...(opts?.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
};

export const ProjectsPage: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuthStore();
  const refreshRooms = useChatStore((state) => state.loadRooms);
  const addNotification = useNotificationStore((state) => state.add);
  const isDark = theme === 'dark';

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);

  useEffect(() => { loadProjects(); }, []);

  const loadProjects = async () => {
    try {
      const res = await api('/api/projects');
      if (res.ok) setProjects(await res.json());
    } catch (err) {
      console.error('Error loading projects:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const res = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || null }),
      });
      if (res.ok) {
        const created = await res.json();
        if (created?.roomId) {
          const text = t('projects.notice.roomCreatedFromProject').replace('{roomId}', created.roomId);
          toast.success(text);
          addNotification({
            type: 'success',
            title: t('notifications.projectCreatedTitle'),
            message: text,
            link: created.id ? `/projects/${created.id}` : '/projects',
          });
        }
        setNewName('');
        setNewDesc('');
        setShowCreate(false);
        await loadProjects();
        await refreshRooms();
      }
    } catch (err) {
      console.error('Error creating project:', err);
    }
  };

  const handleDelete = async (project: Project) => {
    const confirmText = t('projects.delete.confirm').replace('{name}', project.name);
    const failedText = t('projects.delete.failed');
    const confirmed = window.confirm(confirmText);
    if (!confirmed) return;

    setDeleteLoadingId(project.id);
    try {
      const res = await api(`/api/projects/${project.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      await refreshRooms();
    } catch (err) {
      console.error('Error deleting project:', err);
      alert(failedText);
    } finally {
      setDeleteLoadingId(null);
    }
  };

  const inputCls = `w-full rounded border px-3 py-2 text-sm ${
    isDark ? 'border-gray-600 bg-gray-700 text-white placeholder-gray-400' : 'border-gray-300 bg-white'
  } outline-none focus:ring-2 focus:ring-blue-500`;

  return (
    <div className={`max-w-5xl mx-auto p-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">📋 {t('projects.title')}</h1>
          <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {t('projects.description')}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            isDark ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
          } text-white`}
        >
          {t('projects.add')}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className={`mb-6 rounded-lg border-l-4 border-blue-500 p-4 ${isDark ? 'bg-gray-800' : 'bg-blue-50'}`}
        >
          <div className="grid gap-3">
            <input
              type="text"
              placeholder={t('projects.name.placeholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={inputCls}
              autoFocus
            />
            <textarea
              placeholder={t('projects.description.placeholder')}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className={inputCls}
              rows={2}
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button type="submit" className={`rounded px-3 py-1.5 text-sm font-medium ${
              isDark ? 'bg-green-600 hover:bg-green-700' : 'bg-green-500 hover:bg-green-600'
            } text-white`}>
              {t('projects.create')}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className={`rounded px-3 py-1.5 text-sm ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
            >
              {t('projects.cancel')}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : projects.length === 0 ? (
        <div className={`text-center py-16 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          <div className="text-4xl mb-3">📁</div>
          <p>{t('projects.empty')}</p>
          <button onClick={() => setShowCreate(true)} className={`mt-3 rounded px-3 py-1.5 text-sm font-medium ${
            isDark ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
          } text-white`}>
            {t('projects.createFirst')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => {
            const isOwner = user?.id === project.ownerId;
            const deleting = deleteLoadingId === project.id;

            return (
              <div
                key={project.id}
                className={`p-4 rounded-lg border transition ${
                  isDark ? 'bg-gray-800/50 border-gray-700 hover:border-blue-500 hover:bg-gray-800' : 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between mb-2 gap-2">
                  <h3 className="font-bold truncate">{project.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    project.status === 'active'
                      ? isDark ? 'bg-green-900/40 text-green-300' : 'bg-green-100 text-green-700'
                      : isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {t(`projects.status.${project.status}`) || project.status}
                  </span>
                </div>

                {project.description && (
                  <p className={`text-sm mb-3 line-clamp-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    {project.description}
                  </p>
                )}

                <div className={`flex gap-3 text-xs mb-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  <span>👥 {project.teamMemberIds?.length || 0} {t('projects.members')}</span>
                  {project._count?.tasks !== undefined && <span>✅ {project._count.tasks} {t('projects.tasks')}</span>}
                  {project.roomId && <span>🔒 {t('projects.room.linked')}</span>}
                </div>

                <div className="flex items-center justify-between">
                  <Link
                    to={`/projects/${project.id}`}
                    className={`text-sm font-medium ${isDark ? 'text-blue-300 hover:text-blue-200' : 'text-blue-600 hover:text-blue-500'}`}
                  >
                    {t('projects.actions.open')}
                  </Link>

                  {isOwner && (
                    <button
                      onClick={() => handleDelete(project)}
                      disabled={deleting}
                      className={`text-xs px-2 py-1 rounded ${
                        isDark ? 'bg-red-800 hover:bg-red-700 text-red-100' : 'bg-red-100 hover:bg-red-200 text-red-700'
                      } ${deleting ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      {deleting ? t('projects.actions.deleting') : t('projects.actions.delete')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
