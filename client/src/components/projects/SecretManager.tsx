import React, { useState, useEffect } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTheme } from '../../contexts/ThemeContext';

interface Secret {
  id: string;
  projectId: string;
  name: string;
  createdBy: string;
  permissions?: Record<string, string>;
  lastUsedAt?: string;
  lastUsedBy?: string;
  createdAt: string;
}

interface SecretManagerProps {
  projectId: string;
  isOwner: boolean;
}

export const SecretManager: React.FC<SecretManagerProps> = ({ projectId, isOwner }) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [newSecretName, setNewSecretName] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editPermissions, setEditPermissions] = useState<Record<string, string>>({});

  const [showShareModal, setShowShareModal] = useState(false);
  const [shareSecretId, setShareSecretId] = useState<string | null>(null);
  const [sharePermissions, setSharePermissions] = useState<Record<string, string>>({});

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteSecretId, setDeleteSecretId] = useState<string | null>(null);

  useEffect(() => {
    loadSecrets();
  }, [projectId]);

  const loadSecrets = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/projects/${projectId}/secrets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setSecrets(await res.json());
        setError('');
      }
    } catch (err) {
      setError(t('secrets.error.load'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSecretName.trim() || !newSecretValue.trim()) return;

    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/projects/${projectId}/secrets`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newSecretName, value: newSecretValue }),
      });

      if (res.ok) {
        setNewSecretName('');
        setNewSecretValue('');
        setShowCreate(false);
        await loadSecrets();
      } else {
        setError(t('secrets.error.create'));
      }
    } catch (err) {
      setError(t('secrets.error.create'));
      console.error(err);
    }
  };

  const handleEditSecret = async (secret: Secret) => {
    setEditingId(secret.id);
    setEditName(secret.name);
    setEditValue(''); // Don't show current value for security
    setEditPermissions(secret.permissions || {});
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return;

    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/projects/${projectId}/secrets/${editingId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: editName,
          value: editValue || undefined,
          permissions: editPermissions,
        }),
      });

      if (res.ok) {
        setEditingId(null);
        await loadSecrets();
      } else {
        setError(t('secrets.error.update'));
      }
    } catch (err) {
      setError(t('secrets.error.update'));
      console.error(err);
    }
  };

  const handleDeleteSecret = async () => {
    if (!deleteSecretId) return;

    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/projects/${projectId}/secrets/${deleteSecretId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setDeleteSecretId(null);
        setShowDeleteConfirm(false);
        await loadSecrets();
      } else {
        setError(t('secrets.error.delete'));
      }
    } catch (err) {
      setError(t('secrets.error.delete'));
      console.error(err);
    }
  };

  const handleOpenShare = (secret: Secret) => {
    setShareSecretId(secret.id);
    setSharePermissions(secret.permissions || {});
    setShowShareModal(true);
  };

  const handleSavePermissions = async () => {
    if (!shareSecretId) return;

    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/projects/${projectId}/secrets/${shareSecretId}/permissions`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permissions: sharePermissions }),
      });

      if (res.ok) {
        setShowShareModal(false);
        setShareSecretId(null);
        await loadSecrets();
      } else {
        setError(t('secrets.error.permissions'));
      }
    } catch (err) {
      setError(t('secrets.error.permissions'));
      console.error(err);
    }
  };

  if (loading) return <div className="p-4">{t('common.loading')}</div>;

  return (
    <div
      className={`rounded-lg border ${isDark ? 'border-gray-700 bg-gray-900' : 'border-gray-200 bg-white'} p-6`}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">{t('secrets.title')}</h2>
        {isOwner && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className={`rounded px-3 py-1 text-sm font-medium ${
              isDark
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
          >
            {t('secrets.add')}
          </button>
        )}
      </div>

      <div className={`mb-4 rounded border p-3 text-sm ${isDark ? 'border-blue-800/70 bg-blue-950/40 text-blue-200' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
        <strong>{t('secrets.preview.title')}:</strong> {t('secrets.preview.text')}
      </div>

      {error && (
        <div className={`mb-4 rounded p-3 ${isDark ? 'bg-red-900 text-red-200' : 'bg-red-100 text-red-700'}`}>
          {error}
        </div>
      )}

      {/* Create Form */}
      {showCreate && isOwner && (
        <form
          onSubmit={handleCreateSecret}
          className={`mb-4 rounded border-l-4 border-blue-500 p-4 ${isDark ? 'bg-gray-800' : 'bg-blue-50'}`}
        >
          <input
            type="text"
            placeholder={t('secrets.name.placeholder')}
            value={newSecretName}
            onChange={(e) => setNewSecretName(e.target.value)}
            className={`mb-2 w-full rounded border px-3 py-2 ${
              isDark ? 'border-gray-600 bg-gray-700 text-white' : 'border-gray-300'
            }`}
          />
          <input
            type="password"
            placeholder={t('secrets.value.placeholder')}
            value={newSecretValue}
            onChange={(e) => setNewSecretValue(e.target.value)}
            className={`mb-3 w-full rounded border px-3 py-2 ${
              isDark ? 'border-gray-600 bg-gray-700 text-white' : 'border-gray-300'
            }`}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className={`rounded px-3 py-1 text-sm font-medium ${
                isDark ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-green-500 hover:bg-green-600 text-white'
              }`}
            >
              {t('secrets.create')}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className={`rounded px-3 py-1 text-sm ${isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
            >
              {t('secrets.cancel')}
            </button>
          </div>
        </form>
      )}

      {/* Secrets List */}
      <div className="space-y-2">
        {secrets.length === 0 ? (
          <div className={`text-center py-8 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {t('secrets.empty')}
          </div>
        ) : (
          secrets.map((secret) => (
            <div key={secret.id} className={`flex items-center justify-between p-3 rounded border ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
              {editingId === secret.id ? (
                // Edit Mode
                <div className="flex-1">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={`mb-2 w-full rounded border px-2 py-1 text-sm ${
                      isDark ? 'border-gray-600 bg-gray-700 text-white' : 'border-gray-300'
                    }`}
                  />
                  <input
                    type="password"
                    placeholder={t('secrets.newValue.placeholder')}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className={`w-full rounded border px-2 py-1 text-sm ${
                      isDark ? 'border-gray-600 bg-gray-700 text-white' : 'border-gray-300'
                    }`}
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      className="rounded px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white"
                    >
                      {t('secrets.save')}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className={`rounded px-2 py-1 text-xs ${isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-300 hover:bg-gray-400'}`}
                    >
                      {t('secrets.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                // View Mode
                <>
                  <div>
                    <div className="font-mono text-sm font-semibold">{secret.name}</div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {t('secrets.createdBy')} {secret.createdBy}
                      {secret.lastUsedBy && ` • ${t('secrets.lastUsedBy')} ${secret.lastUsedBy}`}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {isOwner && (
                      <>
                        <button
                          onClick={() => handleEditSecret(secret)}
                          className={`text-xs px-2 py-1 rounded ${isDark ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'} text-white`}
                        >
                          {t('secrets.edit')}
                        </button>
                        <button
                          onClick={() => {
                            setDeleteSecretId(secret.id);
                            setShowDeleteConfirm(true);
                          }}
                          className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white"
                        >
                          {t('secrets.delete')}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div
            className={`rounded-lg p-6 max-w-sm ${isDark ? 'bg-gray-800' : 'bg-white'}`}
          >
            <h3 className="text-lg font-bold mb-4">{t('secrets.delete.title')}</h3>
            <p className={`mb-6 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {t('secrets.delete.message')}
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDeleteSecret}
                className="flex-1 rounded px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium"
              >
                {t('secrets.delete')}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className={`flex-1 rounded px-4 py-2 ${isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
              >
                {t('secrets.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Permissions Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div
            className={`rounded-lg p-6 max-w-md ${isDark ? 'bg-gray-800' : 'bg-white'}`}
          >
            <h3 className="text-lg font-bold mb-4">{t('secrets.share.title')}</h3>
            <div className="mb-4">
              <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('secrets.share.permissionsLabel')}
              </label>
              <textarea
                value={JSON.stringify(sharePermissions, null, 2)}
                onChange={(e) => {
                  try {
                    setSharePermissions(JSON.parse(e.target.value));
                  } catch {
                    // Invalid JSON, let user fix it
                  }
                }}
                className={`w-full h-32 rounded border p-2 font-mono text-sm ${
                  isDark ? 'border-gray-600 bg-gray-700 text-white' : 'border-gray-300'
                }`}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSavePermissions}
                className="flex-1 rounded px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium"
              >
                {t('secrets.save')}
              </button>
              <button
                onClick={() => setShowShareModal(false)}
                className={`flex-1 rounded px-4 py-2 ${isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-200 hover:bg-gray-300'}`}
              >
                {t('secrets.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
