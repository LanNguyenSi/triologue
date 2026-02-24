import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useNotificationStore } from '../stores/notificationStore';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageShell } from '../components/ui/PageShell';
import { Badge, Button, Card, EmptyState, Input } from '../components/ui/primitives';

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

interface ProjectListResponse {
  items: Project[];
  totalCount: number;
  pageInfo?: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

const PAGE_SIZE = 8;
type StatusFilter = 'all' | 'active' | 'archived' | 'closed';
const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'archived', 'closed'];

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
  const navigate = useNavigate();
  const isDark = theme === 'dark';

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const requestSeq = useRef(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 220);
    return () => clearTimeout(timeout);
  }, [query]);

  const fetchPage = async (cursor: string | null, history: Array<string | null>) => {
    const seq = ++requestSeq.current;
    setLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      if (cursor) params.set('cursor', cursor);
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const res = await api(`/api/projects?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load projects (${res.status})`);
      }

      const data = await res.json();
      if (seq !== requestSeq.current) return;

      const payload: ProjectListResponse = Array.isArray(data)
        ? { items: data, totalCount: data.length, pageInfo: { limit: PAGE_SIZE, hasMore: false, nextCursor: null } }
        : data;

      setProjects(payload.items || []);
      setTotalCount(payload.totalCount ?? (payload.items?.length || 0));
      setHasMore(Boolean(payload.pageInfo?.hasMore));
      setNextCursor(payload.pageInfo?.nextCursor ?? null);
      setCurrentCursor(cursor);
      setCursorHistory(history);
    } catch (err) {
      console.error('Error loading projects:', err);
      if (seq === requestSeq.current) {
        setProjects([]);
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
    fetchPage(null, []);
  }, [debouncedQuery, statusFilter]);

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
        await reloadFirstPage();
        await refreshRooms();
      }
    } catch (err) {
      console.error('Error creating project:', err);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const failedText = t('projects.delete.failed');

    setDeleteLoadingId(deleteTarget.id);
    try {
      const res = await api(`/api/projects/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      await reloadFirstPage();
      await refreshRooms();
      setDeleteTarget(null);
    } catch (err) {
      console.error('Error deleting project:', err);
      toast.error(failedText);
    } finally {
      setDeleteLoadingId(null);
    }
  };

  const currentPage = cursorHistory.length + 1;
  const pageStart = totalCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = totalCount === 0 ? 0 : pageStart + projects.length - 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const resultsText = t('pagination.results')
    .replace('{start}', String(pageStart))
    .replace('{end}', String(pageEnd))
    .replace('{total}', String(totalCount));
  const pageInfoText = t('pagination.pageInfo')
    .replace('{page}', String(Math.min(currentPage, totalPages)))
    .replace('{total}', String(totalPages));
  const openProject = (projectId: string) => navigate(`/projects/${projectId}`);
  const openProjectLabel = (name: string) => t('projects.a11y.openProject').replace('{name}', name);
  const openRoomLabel = (name: string) => t('projects.a11y.openRoom').replace('{name}', name);
  const deleteProjectLabel = (name: string) => t('projects.a11y.deleteProject').replace('{name}', name);

  const textAreaCls = `w-full rounded-lg border px-3 py-2 text-sm ${
    isDark ? 'border-gray-600 bg-gray-700 text-white placeholder-gray-400' : 'border-gray-300 bg-white'
  } outline-none focus:ring-2 focus:ring-blue-500`;

  return (
    <PageShell
      maxWidth="6xl"
      title={<span className="inline-flex items-center gap-2">📋 {t('projects.title')}</span>}
      subtitle={t('projects.description')}
      actions={
        <Button onClick={() => setShowCreate(!showCreate)} size="sm">
          {t('projects.add')}
        </Button>
      }
    >
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className={`mb-6 rounded-xl border-l-4 border-blue-500 p-3 sm:p-4 ${isDark ? 'bg-gray-800/80 border border-gray-700' : 'bg-blue-50 border border-blue-100'}`}
        >
          <div className="grid gap-3">
            <Input
              type="text"
              placeholder={t('projects.name.placeholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <textarea
              placeholder={t('projects.description.placeholder')}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className={textAreaCls}
              rows={2}
            />
          </div>
          <div className="flex gap-2 mt-3">
            <Button type="submit" variant="primary" size="sm">
              {t('projects.create')}
            </Button>
            <Button
              type="button"
              onClick={() => setShowCreate(false)}
              variant="secondary"
              size="sm"
            >
              {t('projects.cancel')}
            </Button>
          </div>
        </form>
      )}

      <Card tone="muted" className="mb-4 p-3 sm:p-4">
        <div className="flex flex-col gap-3">
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('projects.search.placeholder')}
            className="md:max-w-md"
          />
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((status) => (
              <Button
                key={status}
                onClick={() => setStatusFilter(status)}
                size="sm"
                variant={statusFilter === status ? 'primary' : 'secondary'}
                className="rounded-full"
              >
                {status === 'all' ? t('projects.filter.all') : t(`projects.status.${status}`)}
              </Button>
            ))}
            {(query || statusFilter !== 'all') && (
              <Button
                onClick={() => {
                  setQuery('');
                  setStatusFilter('all');
                }}
                size="sm"
                variant="ghost"
              >
                {t('projects.filters.reset')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon="📁"
          title={t('projects.empty')}
          action={(
            <Button onClick={() => setShowCreate(true)} size="sm">
              {t('projects.createFirst')}
            </Button>
          )}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <div className={`grid grid-cols-12 gap-3 px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              <div className="col-span-3">{t('projects.list.name')}</div>
              <div className="col-span-2">{t('projects.list.status')}</div>
              <div className="col-span-1">{t('projects.list.team')}</div>
              <div className="col-span-1">{t('projects.list.tasks')}</div>
              <div className="col-span-1">{t('projects.list.created')}</div>
              <div className="col-span-4 text-right">{t('projects.list.actions')}</div>
            </div>

            <div className="space-y-2">
              {projects.map((project) => {
                const isOwner = user?.id === project.ownerId;
                const deleting = deleteLoadingId === project.id;
                return (
                  <Card
                    key={project.id}
                    className={`p-3 transition cursor-pointer ${
                      isDark ? 'hover:border-blue-500 hover:bg-gray-800' : 'hover:border-blue-400 hover:shadow-sm'
                    }`}
                    onClick={() => openProject(project.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openProject(project.id);
                      }
                    }}
                    role="link"
                    tabIndex={0}
                    title={openProjectLabel(project.name)}
                    aria-label={openProjectLabel(project.name)}
                  >
                    <div className="grid grid-cols-12 gap-3 items-center">
                      <div className="col-span-3 min-w-0">
                        <div className="font-semibold truncate">{project.name}</div>
                        {project.description && (
                          <div className={`text-xs mt-0.5 truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            {project.description}
                          </div>
                        )}
                      </div>
                      <div className="col-span-2">
                        <Badge variant={project.status === 'active' ? 'success' : 'neutral'}>
                          {t(`projects.status.${project.status}`) || project.status}
                        </Badge>
                      </div>
                      <div className={`col-span-1 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {project.teamMemberIds?.length || 0}
                      </div>
                      <div className={`col-span-1 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {project._count?.tasks ?? '-'}
                      </div>
                      <div className={`col-span-1 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {new Date(project.createdAt).toLocaleDateString()}
                      </div>
                      <div className="col-span-4 flex justify-end items-center gap-2 flex-nowrap">
                        {project.roomId && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-8 min-w-[92px] justify-center whitespace-nowrap"
                            title={openRoomLabel(project.name)}
                            aria-label={openRoomLabel(project.name)}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/room/${project.roomId}`);
                            }}
                          >
                            {t('projects.actions.room')}
                          </Button>
                        )}
                        {isOwner && (
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(project);
                            }}
                            disabled={deleting}
                            variant="danger"
                            size="sm"
                            className="h-8 min-w-[92px] justify-center whitespace-nowrap"
                            title={deleteProjectLabel(project.name)}
                            aria-label={deleteProjectLabel(project.name)}
                          >
                            {deleting ? t('projects.actions.deleting') : t('projects.actions.delete')}
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:hidden">
            {projects.map((project) => {
              const isOwner = user?.id === project.ownerId;
              const deleting = deleteLoadingId === project.id;
              return (
                <Card
                  key={project.id}
                  className={`p-3 transition ${
                    isDark ? 'hover:border-blue-500 hover:bg-gray-800' : 'hover:border-blue-400 hover:shadow-sm'
                  }`}
                  onClick={() => openProject(project.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openProject(project.id);
                    }
                  }}
                  role="link"
                  tabIndex={0}
                  title={openProjectLabel(project.name)}
                  aria-label={openProjectLabel(project.name)}
                >
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <h3 className="font-bold truncate">{project.name}</h3>
                    <Badge variant={project.status === 'active' ? 'success' : 'neutral'}>
                      {t(`projects.status.${project.status}`) || project.status}
                    </Badge>
                  </div>

                  {project.description && (
                    <p className={`text-sm mb-3 line-clamp-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                      {project.description}
                    </p>
                  )}

                  <div className={`flex flex-wrap gap-2 text-xs mb-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    <span>👥 {project.teamMemberIds?.length || 0} {t('projects.members')}</span>
                    <span>✅ {project._count?.tasks ?? 0} {t('projects.tasks')}</span>
                  </div>

                  <div className="flex items-center justify-end gap-2 flex-nowrap">
                    <div className="flex items-center gap-2 flex-nowrap">
                      {project.roomId && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="!inline-flex items-center justify-center w-9 h-9 !px-0 !py-0 text-base leading-none"
                          title={openRoomLabel(project.name)}
                          aria-label={openRoomLabel(project.name)}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/room/${project.roomId}`);
                          }}
                        >
                          <span aria-hidden="true">↗</span>
                        </Button>
                      )}
                    </div>

                    {isOwner && (
                      <Button
                        onClick={(e) => {
                        e.stopPropagation();
                          setDeleteTarget(project);
                        }}
                        disabled={deleting}
                        variant="danger"
                        size="sm"
                        className="!inline-flex items-center justify-center w-9 h-9 !px-0 !py-0 text-base leading-none"
                        title={deleteProjectLabel(project.name)}
                        aria-label={deleteProjectLabel(project.name)}
                      >
                        <span aria-hidden="true">{deleting ? '…' : '🗑'}</span>
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          <Card tone="muted" className="mt-4 p-3 sm:p-4">
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
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('projects.delete.title')}
        message={t('projects.delete.message').replace('{name}', deleteTarget?.name || '')}
        confirmLabel={t('projects.actions.delete')}
        cancelLabel={t('projects.cancel')}
        variant="danger"
        loading={deleteLoadingId === deleteTarget?.id}
        onConfirm={handleDelete}
        onCancel={() => {
          if (!deleteLoadingId) setDeleteTarget(null);
        }}
      />
    </PageShell>
  );
};
