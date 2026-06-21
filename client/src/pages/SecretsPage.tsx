import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FolderIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageShell } from '../components/ui/PageShell';
import { Badge, Button, Card, EmptyState, Input } from '../components/ui/primitives';
import { apiClient } from '../lib/apiClient';

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

interface SecretListResponse {
  items: Secret[];
  totalCount: number;
  pageInfo?: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

interface ProjectListResponse {
  items: Project[];
  totalCount: number;
  pageInfo?: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

const PAGE_SIZE = 10;

const api = (path: string, opts?: RequestInit) => apiClient(path, opts);

export const SecretsPage: React.FC = () => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const isDark = theme === 'dark';

  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unlinked' | string>('all');

  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const requestSeq = useRef(0);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => clearTimeout(timeout);
  }, [query]);

  const loadProjects = async () => {
    try {
      const res = await api('/api/projects?limit=100');
      if (!res.ok) return;
      const data = await res.json();

      const payload: ProjectListResponse = Array.isArray(data)
        ? { items: data, totalCount: data.length, pageInfo: { limit: 100, hasMore: false, nextCursor: null } }
        : data;

      setProjects(payload.items || []);
    } catch {
      // best effort
    }
  };

  const fetchPage = async (cursor: string | null, history: Array<string | null>) => {
    const seq = ++requestSeq.current;
    setLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('scope', filter);
      if (cursor) params.set('cursor', cursor);
      if (debouncedQuery) params.set('q', debouncedQuery);

      const res = await api(`/api/secrets?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to load secrets (${res.status})`);
      }

      const data = await res.json();
      if (seq !== requestSeq.current) return;

      const payload: SecretListResponse = Array.isArray(data)
        ? { items: data, totalCount: data.length, pageInfo: { limit: PAGE_SIZE, hasMore: false, nextCursor: null } }
        : data;

      setSecrets(payload.items || []);
      setTotalCount(payload.totalCount ?? (payload.items?.length || 0));
      setHasMore(Boolean(payload.pageInfo?.hasMore));
      setNextCursor(payload.pageInfo?.nextCursor ?? null);
      setCurrentCursor(cursor);
      setCursorHistory(history);
    } catch (err) {
      if (seq === requestSeq.current) {
        setError(err instanceof Error ? err.message : t('secrets.error.load'));
        setSecrets([]);
        setTotalCount(0);
        setHasMore(false);
        setNextCursor(null);
        setCurrentCursor(cursor);
        setCursorHistory(history);
      }
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    void fetchPage(null, []);
  }, [debouncedQuery, filter]);

  const reloadFirstPage = async () => {
    await fetchPage(null, []);
  };

  const handleNextPage = async () => {
    if (!hasMore || !nextCursor) return;
    const nextHistory = [...cursorHistory, currentCursor];
    await fetchPage(nextCursor, nextHistory);
  };

  const handlePrevPage = async () => {
    if (cursorHistory.length === 0) return;
    const targetCursor = cursorHistory[cursorHistory.length - 1] ?? null;
    const nextHistory = cursorHistory.slice(0, -1);
    await fetchPage(targetCursor, nextHistory);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const res = await api(`/api/secrets/${deleteId}`, { method: 'DELETE' });
    if (res.ok) {
      setDeleteId(null);
      await reloadFirstPage();
      return;
    }

    const data = await res.json().catch(() => ({}));
    setError(String(data?.error || t('secrets.error.delete')));
  };

  const currentPage = cursorHistory.length + 1;
  const pageStart = totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = totalCount === 0 ? 0 : pageStart + secrets.length - 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const resultsText = t('pagination.results')
    .replace('{start}', String(pageStart))
    .replace('{end}', String(pageEnd))
    .replace('{total}', String(totalCount));
  const pageInfoText = t('pagination.pageInfo')
    .replace('{page}', String(Math.min(currentPage, totalPages)))
    .replace('{total}', String(totalPages));
  const openSecret = (secretId: string) => navigate(`/secrets/${secretId}`);
  const openSecretLabel = (name: string) => t('secrets.a11y.openSecret').replace('{name}', name);
  const deleteSecretLabel = (name: string) => t('secrets.a11y.deleteSecret').replace('{name}', name);

  const scopeChips = [
    { key: 'all', label: t('secrets.filter.all') },
    { key: 'unlinked', label: t('secrets.filter.unlinked') },
    ...projects.map((p) => ({ key: p.id, label: p.name })),
  ];

  return (
    <PageShell
      maxWidth="6xl"
      title={t('secrets.title')}
      subtitle={t('secrets.description')}
      actions={
        <Button onClick={() => navigate('/secrets/new')} size="sm">
          {t('common.createAction')}
        </Button>
      }
    >
      <div className="space-y-4 sm:space-y-5">
        {error && (
          <div className={`rounded p-3 text-sm ${isDark ? 'bg-red-900/50 text-red-200' : 'bg-red-50 text-red-700'}`}>
            {error}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-2 !px-1.5 !py-0.5"
              onClick={() => setError('')}
            >
              ✕
            </Button>
          </div>
        )}

        <Card tone="accent" className="p-3 sm:p-4">
          <p className={`text-sm ${isDark ? 'text-blue-200' : 'text-blue-800'}`}>
            <strong>{t('secrets.preview.title')}:</strong> {t('secrets.preview.text')}
          </p>
        </Card>

        <Card tone="muted" className="p-3 sm:p-4">
          <div className="flex flex-col gap-3">
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('secrets.search.placeholder')}
              className="md:max-w-md"
            />
            <div className="flex gap-2 flex-wrap">
              {scopeChips.map((chip) => (
                <Button
                  key={chip.key}
                  onClick={() => setFilter(chip.key)}
                  size="sm"
                  variant={filter === chip.key ? 'primary' : 'secondary'}
                  className="rounded-full"
                >
                  {chip.label}
                </Button>
              ))}
              {(query || filter !== 'all') && (
                <Button
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {t('secrets.filters.reset')}
                </Button>
              )}
            </div>
          </div>
        </Card>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : secrets.length === 0 ? (
        <EmptyState
          icon={<LockClosedIcon className="w-8 h-8" />}
          title={t('secrets.empty')}
          action={(
            <Button onClick={() => navigate('/secrets/new')} size="sm">
              {t('common.createAction')}
            </Button>
          )}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <div className={`grid grid-cols-12 gap-3 px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              <div className="col-span-3">{t('secrets.list.name')}</div>
              <div className="col-span-2">{t('secrets.list.project')}</div>
              <div className="col-span-2">{t('secrets.list.lastUsed')}</div>
              <div className="col-span-2">{t('secrets.list.created')}</div>
              <div className="col-span-3 text-right">{t('secrets.list.actions')}</div>
            </div>

            <div className="space-y-2">
              {secrets.map((s) => (
                <Card
                  key={s.id}
                  className={`p-3 transition cursor-pointer ${
                    isDark ? 'hover:border-blue-500 hover:bg-gray-800' : 'hover:border-blue-400 hover:shadow-sm'
                  }`}
                  onClick={() => openSecret(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openSecret(s.id);
                    }
                  }}
                  role="link"
                  tabIndex={0}
                  title={openSecretLabel(s.name)}
                  aria-label={openSecretLabel(s.name)}
                >
                  <div className="grid grid-cols-12 gap-3 items-center">
                    <div className="col-span-3 min-w-0">
                      <div className="font-mono text-sm font-bold truncate">{s.name}</div>
                      {s.description && (
                        <div className={`text-xs mt-0.5 truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{s.description}</div>
                      )}
                    </div>
                    <div className="col-span-2">
                      {s.projectName ? (
                        <Badge variant="neutral"><FolderIcon className="w-3 h-3 inline -mt-0.5" /> {s.projectName}</Badge>
                      ) : (
                        <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{t('secrets.noProject')}</span>
                      )}
                    </div>
                    <div className={`col-span-2 text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {s.lastUsedBy ? (
                        <>
                          <div>{s.lastUsedBy}</div>
                          {s.lastUsedAt && <div className="text-gray-500 dark:text-gray-400">{new Date(s.lastUsedAt).toLocaleDateString()}</div>}
                        </>
                      ) : (
                        t('secrets.lastUsed.never')
                      )}
                    </div>
                    <div className={`col-span-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {new Date(s.createdAt).toLocaleDateString()}
                    </div>
                    <div className="col-span-3 flex justify-end gap-2 flex-nowrap">
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          openSecret(s.id);
                        }}
                        variant="primary"
                        size="sm"
                        className="h-8 min-w-[92px] justify-center whitespace-nowrap"
                        title={openSecretLabel(s.name)}
                        aria-label={openSecretLabel(s.name)}
                      >
                        {t('secrets.details')}
                      </Button>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteId(s.id);
                        }}
                        variant="danger"
                        size="sm"
                        className="h-8 min-w-[92px] justify-center whitespace-nowrap"
                        title={deleteSecretLabel(s.name)}
                        aria-label={deleteSecretLabel(s.name)}
                      >
                        {t('secrets.delete')}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <div className="space-y-2 md:hidden">
            {secrets.map((s) => (
              <Card
                key={s.id}
                className={`p-3 sm:p-4 transition cursor-pointer ${
                  isDark ? 'hover:border-blue-500 hover:bg-gray-800' : 'hover:border-blue-400 hover:bg-gray-50 hover:shadow-sm'
                }`}
                onClick={() => openSecret(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openSecret(s.id);
                  }
                }}
                role="link"
                tabIndex={0}
                title={openSecretLabel(s.name)}
                aria-label={openSecretLabel(s.name)}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold">{s.name}</span>
                      {s.projectName && (
                        <Badge variant="neutral"><FolderIcon className="w-3 h-3 inline -mt-0.5" /> {s.projectName}</Badge>
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
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      openSecret(s.id);
                    }}
                    variant="primary"
                    size="sm"
                    title={openSecretLabel(s.name)}
                    aria-label={openSecretLabel(s.name)}
                  >
                    {t('secrets.details')}
                  </Button>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteId(s.id);
                    }}
                    variant="danger"
                    size="sm"
                    title={deleteSecretLabel(s.name)}
                    aria-label={deleteSecretLabel(s.name)}
                  >
                    {t('secrets.delete')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          <Card tone="muted" className="p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{resultsText}</div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handlePrevPage}
                  disabled={cursorHistory.length === 0 || loading}
                >
                  {t('pagination.prev')}
                </Button>
                <span className={`text-sm min-w-[90px] text-center ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{pageInfoText}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={!hasMore || !nextCursor || loading}
                >
                  {t('pagination.next')}
                </Button>
              </div>
            </div>
          </Card>
        </>
      )}
      </div>

      <ConfirmDialog
        open={!!deleteId}
        title={t('secrets.delete.title')}
        message={t('secrets.delete.message')}
        confirmLabel={t('secrets.delete')}
        cancelLabel={t('secrets.cancel')}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </PageShell>
  );
};

export default SecretsPage;
