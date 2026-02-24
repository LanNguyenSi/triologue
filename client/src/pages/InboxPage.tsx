import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckIcon, TrashIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { PageShell } from '../components/ui/PageShell';
import { Badge, Button, Card } from '../components/ui/primitives';
import { useNotificationStore } from '../stores/notificationStore';

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

  const allItems = useNotificationStore((state) => state.items);
  const loadInbox = useNotificationStore((state) => state.loadInbox);
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const remove = useNotificationStore((state) => state.remove);
  const clear = useNotificationStore((state) => state.clear);

  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const items = useMemo(() => allItems.filter((item) => item.source === 'server'), [allItems]);
  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);
  const visibleItems = useMemo(
    () => (filter === 'unread' ? items.filter((item) => !item.read) : items),
    [items, filter],
  );

  const isDark = theme === 'dark';

  return (
    <PageShell
      maxWidth="5xl"
      title={`🔔 ${t('inbox.title')}`}
      subtitle={t('inbox.subtitle')}
      actions={(
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void loadInbox();
            }}
          >
            <span className="inline-flex items-center gap-1">
              <ArrowPathIcon className="w-4 h-4" />
              {t('inbox.refresh')}
            </span>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => markAllRead('server')} disabled={unreadCount === 0}>
            <span className="inline-flex items-center gap-1">
              <CheckIcon className="w-4 h-4" />
              {t('notifications.markAllRead')}
            </span>
          </Button>
          <Button variant="danger" size="sm" onClick={() => clear('server')} disabled={items.length === 0}>
            <span className="inline-flex items-center gap-1">
              <TrashIcon className="w-4 h-4" />
              {t('notifications.clearAll')}
            </span>
          </Button>
        </div>
      )}
    >
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-lg border px-2 py-1">
            <button
              type="button"
              onClick={() => setFilter('all')}
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

        {visibleItems.length === 0 ? (
          <div className={`rounded-lg border px-4 py-8 text-center text-sm ${isDark ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
            {t('inbox.empty')}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleItems.map((item) => (
              <div
                key={item.id}
                className={`rounded-lg border px-3 py-3 transition-colors ${
                  isDark ? 'border-gray-700 bg-gray-800/40' : 'border-gray-200 bg-white'
                } ${item.read ? '' : isDark ? 'ring-1 ring-blue-800/40' : 'ring-1 ring-blue-200'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      markRead(item.id);
                      if (item.link) navigate(item.link);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-semibold">{item.title}</div>
                      <Badge variant={typeBadgeVariant[item.type] || 'info'}>{item.type}</Badge>
                      <Badge variant={item.read ? 'neutral' : 'info'}>{item.read ? t('inbox.read') : t('inbox.unread')}</Badge>
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
                    {!item.read && (
                      <Button variant="ghost" size="sm" onClick={() => markRead(item.id)}>
                        <CheckIcon className="w-4 h-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => remove(item.id)}>
                      <TrashIcon className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </PageShell>
  );
};
