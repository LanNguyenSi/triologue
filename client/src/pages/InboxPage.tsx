import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckIcon, TrashIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { PageShell } from '../components/ui/PageShell';
import { Badge, Button, Card } from '../components/ui/primitives';
import { useNotificationStore } from '../stores/notificationStore';

const API = import.meta.env.VITE_API_URL ?? '/api';
const PAGE_SIZE = 20;

interface InboxItem {
  id: string;
  type: string;
  title: string;
  message?: string | null;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
}

interface InboxListResponse {
  items?: InboxItem[];
  unreadCount?: number;
  totalCount?: number;
  pageInfo?: {
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
    nextPage: number | null;
  };
}

const typeBadgeVariant: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'danger',
};

export const InboxPage: React.FC = () => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const refreshNotificationStore = useNotificationStore((state) => state.loadInbox);

  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const authHeaders = useCallback((): HeadersInit | null => {
    const token = localStorage.getItem('triologue_token');
    if (!token) return null;
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }, []);

  const fetchInboxPage = useCallback(async (targetPage = 1, targetFilter: 'all' | 'unread' = filter) => {
    const headers = authHeaders();
    if (!headers) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('page', String(targetPage));
      params.set('filter', targetFilter);
      const res = await fetch(`${API}/inbox?${params.toString()}`, {
        method: 'GET',
        headers,
      });
      if (!res.ok) throw new Error(`Failed to load inbox (${res.status})`);
      const data = (await res.json()) as InboxListResponse;
      const list = Array.isArray(data.items) ? data.items : [];
      const nextPage = data.pageInfo?.page ?? targetPage;
      const nextTotalCount = data.totalCount ?? list.length;
      const nextTotalPages = data.pageInfo?.totalPages ?? Math.max(1, Math.ceil(nextTotalCount / PAGE_SIZE));

      setItems(list);
      setPage(nextPage);
      setTotalCount(nextTotalCount);
      setTotalPages(nextTotalPages);
      setHasMore(data.pageInfo?.hasMore ?? nextPage < nextTotalPages);
      setUnreadCount(data.unreadCount ?? list.filter((item) => !item.isRead).length);
    } catch {
      setItems([]);
      setPage(1);
      setTotalCount(0);
      setTotalPages(1);
      setHasMore(false);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, filter]);

  useEffect(() => {
    void fetchInboxPage(1, filter);
  }, [filter, fetchInboxPage]);

  const refreshAfterMutation = async (targetPage = page, targetFilter: 'all' | 'unread' = filter) => {
    await fetchInboxPage(targetPage, targetFilter);
    void refreshNotificationStore();
  };

  const markRead = async (id: string, options?: { fallbackPage?: number }) => {
    const headers = authHeaders();
    if (!headers) return;
    setMutating(true);
    try {
      await fetch(`${API}/inbox/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
        headers,
      });
      await refreshAfterMutation(options?.fallbackPage ?? page, filter);
    } finally {
      setMutating(false);
    }
  };

  const removeItem = async (id: string) => {
    const headers = authHeaders();
    if (!headers) return;
    setMutating(true);
    try {
      await fetch(`${API}/inbox/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      });
      const fallbackPage = items.length === 1 && page > 1 ? page - 1 : page;
      await refreshAfterMutation(fallbackPage, filter);
    } finally {
      setMutating(false);
    }
  };

  const markAllRead = async () => {
    const headers = authHeaders();
    if (!headers) return;
    setMutating(true);
    try {
      await fetch(`${API}/inbox/read-all`, {
        method: 'PATCH',
        headers,
      });
      await refreshAfterMutation(filter === 'unread' ? 1 : page, filter);
    } finally {
      setMutating(false);
    }
  };

  const clearAll = async () => {
    const headers = authHeaders();
    if (!headers) return;
    setMutating(true);
    try {
      await fetch(`${API}/inbox`, {
        method: 'DELETE',
        headers,
      });
      await refreshAfterMutation(1, filter);
    } finally {
      setMutating(false);
    }
  };

  const openItem = async (item: InboxItem) => {
    if (!item.isRead) {
      const fallbackPage = filter === 'unread' && items.length === 1 && page > 1 ? page - 1 : page;
      await markRead(item.id, { fallbackPage });
    }
    if (item.link) navigate(item.link);
  };

  const handleNextPage = async () => {
    if (!hasMore || loading) return;
    await fetchInboxPage(page + 1, filter);
  };

  const handlePrevPage = async () => {
    if (page <= 1 || loading) return;
    await fetchInboxPage(page - 1, filter);
  };

  const isDark = theme === 'dark';
  const pageStart = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = totalCount === 0 ? 0 : pageStart + items.length - 1;
  const resultsText = t('pagination.results')
    .replace('{start}', String(pageStart))
    .replace('{end}', String(pageEnd))
    .replace('{total}', String(totalCount));
  const pageInfoText = t('pagination.pageInfo')
    .replace('{page}', String(Math.min(page, totalPages)))
    .replace('{total}', String(Math.max(1, totalPages)));
  const pageLoading = loading || mutating;
  const emptyText = t('inbox.empty');

  return (
    <PageShell
      maxWidth="6xl"
      title={<span className="inline-flex items-center gap-2">🔔 {t('inbox.title')}</span>}
      subtitle={t('inbox.subtitle')}
      actions={(
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void fetchInboxPage(page, filter);
            }}
            disabled={pageLoading}
          >
            <span className="inline-flex items-center gap-1">
              <ArrowPathIcon className="w-4 h-4" />
              {t('inbox.refresh')}
            </span>
          </Button>
          <Button variant="secondary" size="sm" onClick={markAllRead} disabled={unreadCount === 0 || pageLoading}>
            <span className="inline-flex items-center gap-1">
              <CheckIcon className="w-4 h-4" />
              {t('notifications.markAllRead')}
            </span>
          </Button>
          <Button variant="danger" size="sm" onClick={clearAll} disabled={totalCount === 0 || pageLoading}>
            <span className="inline-flex items-center gap-1">
              <TrashIcon className="w-4 h-4" />
              {t('notifications.clearAll')}
            </span>
          </Button>
        </div>
      )}
    >
      <div className="space-y-4 sm:space-y-5">
        <Card tone="muted" className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-lg border px-2 py-1">
              <button
                type="button"
                onClick={() => setFilter('all')}
                aria-pressed={filter === 'all'}
                className={`rounded px-2.5 py-1 text-sm font-medium transition-colors ${
                  filter === 'all'
                    ? isDark
                      ? 'bg-gray-700 text-white'
                      : 'bg-gray-200 text-gray-900'
                    : isDark
                      ? 'text-gray-300 hover:bg-gray-800'
                      : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t('inbox.filter.all')}
              </button>
              <button
                type="button"
                onClick={() => setFilter('unread')}
                aria-pressed={filter === 'unread'}
                className={`rounded px-2.5 py-1 text-sm font-medium transition-colors ${
                  filter === 'unread'
                    ? isDark
                      ? 'bg-gray-700 text-white'
                      : 'bg-gray-200 text-gray-900'
                    : isDark
                      ? 'text-gray-300 hover:bg-gray-800'
                      : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t('inbox.filter.unread')}
              </button>
            </div>
            <Badge variant="neutral">{unreadCount} {t('inbox.unread')}</Badge>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          {pageLoading && (
            <div className={`rounded-lg border px-4 py-8 text-center text-sm ${isDark ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
              {t('common.loading')}
            </div>
          )}
          {!pageLoading && items.length === 0 ? (
            <div className={`rounded-lg border px-4 py-8 text-center text-sm ${isDark ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
              {emptyText}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-lg border px-3 py-3 transition-colors ${
                    isDark ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-white'
                  } ${item.isRead ? '' : isDark ? 'ring-1 ring-blue-800/40' : 'ring-1 ring-blue-200'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        void openItem(item);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-semibold">{item.title}</div>
                        <Badge variant={typeBadgeVariant[item.type] || 'info'}>{item.type}</Badge>
                        <Badge variant={item.isRead ? 'neutral' : 'info'}>{item.isRead ? t('inbox.read') : t('inbox.unread')}</Badge>
                      </div>
                      {item.message && (
                        <div className={`mt-1 text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          {item.message}
                        </div>
                      )}
                      <div className={`mt-1 text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {new Date(item.createdAt).toLocaleString()}
                      </div>
                    </button>

                    <div className="flex items-center gap-1">
                      {!item.isRead && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const fallbackPage = filter === 'unread' && items.length === 1 && page > 1 ? page - 1 : page;
                            void markRead(item.id, { fallbackPage });
                          }}
                          disabled={pageLoading}
                        >
                          <CheckIcon className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void removeItem(item.id);
                        }}
                        disabled={pageLoading}
                      >
                        <TrashIcon className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card tone="muted" className="p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              {resultsText}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handlePrevPage}
                disabled={page <= 1 || pageLoading}
              >
                {t('pagination.prev')}
              </Button>
              <span
                className={`text-sm min-w-[90px] text-center ${isDark ? 'text-gray-300' : 'text-gray-700'}`}
              >
                {pageInfoText}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleNextPage}
                disabled={!hasMore || pageLoading}
              >
                {t('pagination.next')}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </PageShell>
  );
};
