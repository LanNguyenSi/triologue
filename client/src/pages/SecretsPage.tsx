import React, { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';

interface Secret {
  id: string;
  name: string;
  description: string | null;
  projectId: string | null;
  projectName: string | null;
  lastUsedAt: string | null;
  lastUsedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Project {
  id: string;
  name: string;
}

const api = (path: string, opts?: RequestInit) => {
  const token = localStorage.getItem('triologue_token');
  return fetch(path, {
    ...opts,
    headers: {
      ...(opts?.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
};

export const SecretsPage: React.FC = () => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'unlinked' | string>('all');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newProjectId, setNewProjectId] = useState('');

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editProjectId, setEditProjectId] = useState('');

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    loadSecrets();
    loadProjects();
  }, []);

  const loadSecrets = async () => {
    try {
      const res = await api('/api/secrets');
      if (res.ok) setSecrets(await res.json());
    } catch (err) {
      setError(t('secrets.error.load'));
    } finally {
      setLoading(false);
    }
  };

  const loadProjects = async () => {
    try {
      const res = await api('/api/projects');
      if (res.ok) setProjects(await res.json());
    } catch {}
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newValue.trim()) return;
    setError('');

    const res = await api('/api/secrets', {
      method: 'POST',
      body: JSON.stringify({
        name: newName,
        value: newValue,
        description: newDesc || undefined,
        projectId: newProjectId || undefined,
      }),
    });

    if (res.ok) {
      setNewName(''); setNewValue(''); setNewDesc(''); setNewProjectId('');
      setShowCreate(false);
      await loadSecrets();
    } else {
      const data = await res.json();
      setError(data.error || t('secrets.error.create'));
    }
  };

  const startEdit = (s: Secret) => {
    setEditId(s.id);
    setEditName(s.name);
    setEditValue('');
    setEditDesc(s.description || '');
    setEditProjectId(s.projectId || '');
  };

  const handleSave = async () => {
    if (!editId || !editName.trim()) return;
    setError('');

    const res = await api(`/api/secrets/${editId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: editName,
        value: editValue || undefined,
        description: editDesc,
        projectId: editProjectId || null,
      }),
    });

    if (res.ok) {
      setEditId(null);
      await loadSecrets();
    } else {
      const data = await res.json();
      setError(data.error || t('secrets.error.update'));
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const res = await api(`/api/secrets/${deleteId}`, { method: 'DELETE' });
    if (res.ok) {
      setDeleteId(null);
      await loadSecrets();
    }
  };

  const filtered = secrets.filter((s) => {
    if (filter === 'all') return true;
    if (filter === 'unlinked') return !s.projectId;
    return s.projectId === filter;
  });

  const inputCls = `w-full rounded border px-3 py-2 text-sm ${
    isDark ? 'border-gray-600 bg-gray-700 text-white placeholder-gray-400' : 'border-gray-300 bg-white'
  }`;
  const btnPrimary = `rounded px-3 py-1.5 text-sm font-medium ${
    isDark ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'
  } text-white`;
  const btnGhost = `rounded px-3 py-1.5 text-sm ${
    isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-200' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
  }`;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className={`max-w-4xl mx-auto p-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">🔑 {t('secrets.title')}</h1>
          <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {t('secrets.description')}
          </p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className={btnPrimary}>
          {t('secrets.add')}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className={`mb-4 rounded p-3 text-sm ${isDark ? 'bg-red-900/50 text-red-200' : 'bg-red-50 text-red-700'}`}>
          {error}
          <button onClick={() => setError('')} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { key: 'all', label: `${t('secrets.filter.all')} (${secrets.length})` },
          { key: 'unlinked', label: `${t('secrets.filter.unlinked')} (${secrets.filter((s) => !s.projectId).length})` },
          ...projects
            .filter((p) => secrets.some((s) => s.projectId === p.id))
            .map((p) => ({ key: p.id, label: p.name })),
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === f.key
                ? isDark ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white'
                : isDark ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Create Form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className={`mb-6 rounded-lg border-l-4 border-blue-500 p-4 ${isDark ? 'bg-gray-800' : 'bg-blue-50'}`}
        >
          <div className="grid gap-3">
            <input
              type="text"
              placeholder={t('secrets.name.placeholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
              className={`${inputCls} font-mono`}
              autoFocus
            />
            <input
              type="password"
              placeholder={t('secrets.value.placeholder')}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className={inputCls}
            />
            <input
              type="text"
              placeholder={t('secrets.description.placeholder')}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className={inputCls}
            />
            <select
              value={newProjectId}
              onChange={(e) => setNewProjectId(e.target.value)}
              className={inputCls}
            >
              <option value="">{t('secrets.noProject')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 mt-3">
            <button type="submit" className={btnPrimary}>{t('secrets.create')}</button>
            <button type="button" onClick={() => setShowCreate(false)} className={btnGhost}>{t('secrets.cancel')}</button>
          </div>
        </form>
      )}

      {/* Secrets List */}
      {filtered.length === 0 ? (
        <div className={`text-center py-16 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          <div className="text-4xl mb-3">🔐</div>
          <p>{t('secrets.empty')}</p>
          <button onClick={() => setShowCreate(true)} className={`mt-3 ${btnPrimary}`}>
            {t('secrets.createFirst')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <div
              key={s.id}
              className={`rounded-lg border p-4 transition ${
                isDark ? 'border-gray-700 bg-gray-800/50 hover:bg-gray-800' : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              {editId === s.id ? (
                /* Edit mode */
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                    className={`${inputCls} font-mono`}
                  />
                  <input
                    type="password"
                    placeholder={t('secrets.newValue.placeholder')}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className={inputCls}
                  />
                  <input
                    type="text"
                    placeholder={t('secrets.description.placeholder')}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    className={inputCls}
                  />
                  <select
                    value={editProjectId}
                    onChange={(e) => setEditProjectId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">{t('secrets.noProject')}</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={handleSave} className={btnPrimary}>{t('secrets.save')}</button>
                    <button onClick={() => setEditId(null)} className={btnGhost}>{t('secrets.cancel')}</button>
                  </div>
                </div>
              ) : (
                /* View mode */
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold">{s.name}</span>
                      {s.projectName && (
                        <span className={`rounded-full px-2 py-0.5 text-xs ${
                          isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
                        }`}>
                          📁 {s.projectName}
                        </span>
                      )}
                    </div>
                    {s.description && (
                      <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{s.description}</p>
                    )}
                    <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {t('secrets.createdBy')} {new Date(s.createdAt).toLocaleDateString()}
                      {s.lastUsedBy && ` · ${t('secrets.lastUsedBy')} ${s.lastUsedBy}`}
                    </p>
                  </div>
                  <div className="flex gap-1.5 ml-4 shrink-0">
                    <button
                      onClick={() => startEdit(s)}
                      className={`rounded px-2 py-1 text-xs ${isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'}`}
                      title={t('secrets.edit')}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => setDeleteId(s.id)}
                      className="rounded px-2 py-1 text-xs bg-red-600/10 hover:bg-red-600/20 text-red-500"
                      title={t('secrets.delete')}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete Modal */}
      {deleteId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={() => setDeleteId(null)}>
          <div
            className={`rounded-lg p-6 max-w-sm mx-4 ${isDark ? 'bg-gray-800' : 'bg-white'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-2">{t('secrets.delete.title')}</h3>
            <p className={`mb-6 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {t('secrets.delete.message')}
            </p>
            <div className="flex gap-3">
              <button onClick={handleDelete} className="flex-1 rounded px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium">
                {t('secrets.delete')}
              </button>
              <button onClick={() => setDeleteId(null)} className={`flex-1 ${btnGhost}`}>
                {t('secrets.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SecretsPage;
