import React, { useCallback, useEffect, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTheme } from '../../contexts/ThemeContext';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Button, Card, Input } from '../ui/primitives';
import { apiClient } from '../../lib/apiClient';

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
  const [creatingSecret, setCreatingSecret] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editPermissions, setEditPermissions] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const [showShareModal, setShowShareModal] = useState(false);
  const [shareSecretId, setShareSecretId] = useState<string | null>(null);
  const [shareText, setShareText] = useState('{}');
  const [shareError, setShareError] = useState('');
  const [savingPermissions, setSavingPermissions] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteSecretId, setDeleteSecretId] = useState<string | null>(null);
  const [deletingSecret, setDeletingSecret] = useState(false);

  const loadSecrets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient(`/api/projects/${projectId}/secrets`);

      if (!res.ok) {
        throw new Error(t('secrets.error.load'));
      }

      setSecrets(await res.json());
      setError('');
    } catch (err) {
      setError(t('secrets.error.load'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void loadSecrets();
  }, [loadSecrets]);

  useEffect(() => {
    if (!showShareModal) return;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingPermissions) {
        setShowShareModal(false);
        setShareSecretId(null);
        setShareError('');
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showShareModal, savingPermissions]);

  const handleCreateSecret = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newSecretName.trim() || !newSecretValue.trim() || creatingSecret) return;

    setCreatingSecret(true);
    setError('');

    try {
      const res = await apiClient(`/api/projects/${projectId}/secrets`, {
        method: 'POST',
        body: JSON.stringify({
          name: newSecretName.trim(),
          value: newSecretValue,
        }),
      });

      if (!res.ok) {
        throw new Error(t('secrets.error.create'));
      }

      setNewSecretName('');
      setNewSecretValue('');
      setShowCreate(false);
      await loadSecrets();
    } catch (err) {
      setError(t('secrets.error.create'));
      console.error(err);
    } finally {
      setCreatingSecret(false);
    }
  };

  const handleEditSecret = (secret: Secret) => {
    setEditingId(secret.id);
    setEditName(secret.name);
    setEditValue('');
    setEditPermissions(secret.permissions || {});
  };

  const handleSaveEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingId || !editName.trim() || savingEdit) return;

    setSavingEdit(true);
    setError('');

    try {
      const res = await apiClient(`/api/projects/${projectId}/secrets/${editingId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editName.trim(),
          value: editValue || undefined,
          permissions: editPermissions,
        }),
      });

      if (!res.ok) {
        throw new Error(t('secrets.error.update'));
      }

      setEditingId(null);
      await loadSecrets();
    } catch (err) {
      setError(t('secrets.error.update'));
      console.error(err);
    } finally {
      setSavingEdit(false);
    }
  };

  const promptDeleteSecret = (secretId: string) => {
    setDeleteSecretId(secretId);
    setShowDeleteConfirm(true);
  };

  const handleDeleteSecret = async () => {
    if (!deleteSecretId || deletingSecret) return;

    setDeletingSecret(true);
    setError('');

    try {
      const res = await apiClient(`/api/projects/${projectId}/secrets/${deleteSecretId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error(t('secrets.error.delete'));
      }

      setDeleteSecretId(null);
      setShowDeleteConfirm(false);
      await loadSecrets();
    } catch (err) {
      setError(t('secrets.error.delete'));
      console.error(err);
    } finally {
      setDeletingSecret(false);
    }
  };

  const handleOpenShare = (secret: Secret) => {
    setShareSecretId(secret.id);
    setShareText(JSON.stringify(secret.permissions || {}, null, 2));
    setShareError('');
    setShowShareModal(true);
  };

  const handleCloseShare = () => {
    if (savingPermissions) return;
    setShowShareModal(false);
    setShareSecretId(null);
    setShareError('');
  };

  const handleSavePermissions = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!shareSecretId || savingPermissions) return;

    let parsedPermissions: Record<string, string>;
    try {
      parsedPermissions = JSON.parse(shareText || '{}') as Record<string, string>;
      setShareError('');
    } catch {
      setShareError(t('secrets.error.permissions'));
      return;
    }

    setSavingPermissions(true);
    setError('');

    try {
      const res = await apiClient(`/api/projects/${projectId}/secrets/${shareSecretId}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: parsedPermissions }),
      });

      if (!res.ok) {
        throw new Error(t('secrets.error.permissions'));
      }

      setShowShareModal(false);
      setShareSecretId(null);
      await loadSecrets();
    } catch (err) {
      setError(t('secrets.error.permissions'));
      console.error(err);
    } finally {
      setSavingPermissions(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-4 text-sm">
        {t('common.loading')}
      </Card>
    );
  }

  return (
    <>
      <Card className="p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{t('secrets.title')}</h2>
          {isOwner && (
            <Button
              type="button"
              size="sm"
              variant={showCreate ? 'secondary' : 'primary'}
              onClick={() => setShowCreate((current) => !current)}
            >
              {showCreate ? t('secrets.cancel') : t('secrets.add')}
            </Button>
          )}
        </div>

        <Card tone="accent" className="p-3 text-sm">
          <strong>{t('secrets.preview.title')}:</strong> {t('secrets.preview.text')}
        </Card>

        {error && (
          <div className={`rounded p-3 text-sm ${isDark ? 'bg-red-900/40 text-red-200 border border-red-700/50' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {error}
          </div>
        )}

        {showCreate && isOwner && (
          <Card tone="muted" className="p-4">
            <form onSubmit={handleCreateSecret} className="space-y-3">
              <div>
                <label htmlFor="secret-create-name" className={`mb-1 block text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('secrets.field.name')} <span className="text-red-400">*</span>
                </label>
                <Input
                  id="secret-create-name"
                  type="text"
                  placeholder={t('secrets.name.placeholder')}
                  value={newSecretName}
                  onChange={(event) => setNewSecretName(event.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="secret-create-value" className={`mb-1 block text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('secrets.field.value')} <span className="text-red-400">*</span>
                </label>
                <Input
                  id="secret-create-value"
                  type="password"
                  placeholder={t('secrets.value.placeholder')}
                  value={newSecretValue}
                  onChange={(event) => setNewSecretValue(event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={creatingSecret || !newSecretName.trim() || !newSecretValue.trim()}>
                  {creatingSecret ? t('common.loading') : t('secrets.create')}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setShowCreate(false)}>
                  {t('secrets.cancel')}
                </Button>
              </div>
            </form>
          </Card>
        )}

        <div className="space-y-2">
          {secrets.length === 0 ? (
            <Card tone="muted" className={`p-6 text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('secrets.empty')}
            </Card>
          ) : (
            secrets.map((secret) => (
              <Card key={secret.id} tone="muted" className="p-3">
                {editingId === secret.id ? (
                  <form onSubmit={handleSaveEdit} className="space-y-2">
                    <div>
                      <label htmlFor={`secret-edit-name-${secret.id}`} className={`mb-1 block text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {t('secrets.field.name')} <span className="text-red-400">*</span>
                      </label>
                      <Input
                        id={`secret-edit-name-${secret.id}`}
                        type="text"
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor={`secret-edit-value-${secret.id}`} className={`mb-1 block text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {t('secrets.field.newValue')}
                      </label>
                      <Input
                        id={`secret-edit-value-${secret.id}`}
                        type="password"
                        placeholder={t('secrets.newValue.placeholder')}
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" size="sm" disabled={savingEdit || !editName.trim()}>
                        {savingEdit ? t('common.loading') : t('secrets.save')}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                        {t('secrets.cancel')}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold">{secret.name}</div>
                      <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {t('secrets.createdBy')} {secret.createdBy}
                        {secret.lastUsedBy && ` • ${t('secrets.lastUsedBy')} ${secret.lastUsedBy}`}
                      </div>
                    </div>
                    {isOwner && (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="secondary" onClick={() => handleOpenShare(secret)}>
                          {t('secrets.share')}
                        </Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => handleEditSecret(secret)}>
                          {t('secrets.edit')}
                        </Button>
                        <Button type="button" size="sm" variant="danger" onClick={() => promptDeleteSecret(secret.id)}>
                          {t('secrets.delete')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      </Card>

      {showShareModal && shareSecretId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={handleCloseShare}
        >
          <div
            className={`w-full max-w-xl mx-4 rounded-xl border shadow-elevated ${isDark ? 'bg-gray-800 border-gray-700/50' : 'bg-white border-gray-200/60'}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={`flex items-center justify-between p-4 border-b ${isDark ? 'border-gray-700/50' : 'border-gray-200/60'}`}>
              <h3 className="text-lg font-semibold">{t('secrets.share.title')}</h3>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={handleCloseShare}
                disabled={savingPermissions}
                aria-label={t('secrets.cancel')}
              >
                <XMarkIcon className="w-4 h-4" />
              </Button>
            </div>

            <form onSubmit={handleSavePermissions} className="p-4 space-y-3">
              <div>
                <label htmlFor="secret-share-permissions" className={`mb-1 block text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('secrets.share.permissionsLabel')} <span className="text-red-400">*</span>
                </label>
                <textarea
                  id="secret-share-permissions"
                  value={shareText}
                  onChange={(event) => {
                    setShareText(event.target.value);
                    if (shareError) setShareError('');
                  }}
                  className={`h-40 w-full rounded-lg border px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500 ${
                    isDark
                      ? 'border-gray-600/50 bg-gray-700 text-white placeholder-gray-400'
                      : 'border-gray-300/60 bg-white text-gray-900 placeholder-gray-500'
                  }`}
                  spellCheck={false}
                  required
                />
              </div>

              {shareError && (
                <p className={`text-xs ${isDark ? 'text-red-300' : 'text-red-600'}`}>
                  {shareError}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={savingPermissions}>
                  {savingPermissions ? t('common.loading') : t('secrets.save')}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={handleCloseShare} disabled={savingPermissions}>
                  {t('secrets.cancel')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showDeleteConfirm && !!deleteSecretId}
        title={t('secrets.delete.title')}
        message={t('secrets.delete.message')}
        confirmLabel={t('secrets.delete')}
        cancelLabel={t('secrets.cancel')}
        variant="danger"
        loading={deletingSecret}
        onConfirm={() => {
          void handleDeleteSecret();
        }}
        onCancel={() => {
          if (deletingSecret) return;
          setShowDeleteConfirm(false);
          setDeleteSecretId(null);
        }}
      />
    </>
  );
};
