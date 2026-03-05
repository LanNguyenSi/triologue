import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useTheme } from '../contexts/ThemeContext';
import { useChatStore } from '../stores/chatStore';
import { useLanguage } from '../contexts/LanguageContext';
import { useNotificationStore } from '../stores/notificationStore';
import { PageShell } from '../components/ui/PageShell';
import { Badge, Button, Card } from '../components/ui/primitives';
import { taskPriorityBadgeVariant, taskStatusBadgeVariant } from '../utils/statusBadges';
import { getActionCenterStartExpanded } from '../utils/actionCenterPreference';

interface AgentSummary {
  total: number;
  active: number;
}

interface DashboardTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId: string;
  projectName: string;
}

interface DashboardHandover {
  projectId: string;
  projectName: string;
  roomId: string;
  messageId: string;
  contentPreview: string;
  timestamp: string;
  sender?: {
    id: string;
    username: string;
    displayName?: string | null;
    userType: string;
  } | null;
}

type CardStatus = 'live' | 'in_progress' | 'soon';

const CARD_KEYS = [
  { icon: '💬', key: 'chat', status: 'live' },
  { icon: '🤖', key: 'agents', status: 'live' },
  { icon: '🧠', key: 'memory', status: 'live' },
  { icon: '⚡', key: 'workflows', status: 'soon' },
  { icon: '🏪', key: 'marketplace', status: 'soon' },
  { icon: '🚀', key: 'projects', status: 'live' },
  { icon: '🔑', key: 'secrets', status: 'in_progress' },
  { icon: '🔌', key: 'githubPlugin', status: 'soon' },
  { icon: '📊', key: 'analytics', status: 'soon' },
] as const satisfies Array<{ icon: string; key: string; status: CardStatus }>;

export const DashboardPage: React.FC = () => {
  const { user } = useAuthStore();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const { rooms, loadRooms, unreadCounts } = useChatStore();
  const notificationItems = useNotificationStore((state) => state.items);
  const [agents, setAgents] = useState<AgentSummary>({ total: 0, active: 0 });
  const [myTasks, setMyTasks] = useState<DashboardTask[]>([]);
  const [importantTasks, setImportantTasks] = useState<DashboardTask[]>([]);
  const [latestHandovers, setLatestHandovers] = useState<DashboardHandover[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [isActionCenterExpanded, setIsActionCenterExpanded] = useState(() =>
    getActionCenterStartExpanded(),
  );

  useEffect(() => {
    loadRooms();
    const token = localStorage.getItem('triologue_token');
    if (!token) {
      setTasksLoading(false);
      return;
    }

    if (token) {
      fetch('/api/agents/mine', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : [])
        .then((list: any[]) => setAgents({
          total: list.length,
          active: list.filter(a => a.status === 'active').length,
        }))
        .catch(() => {});

      fetch('/api/batch/me/dashboard', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          setMyTasks(Array.isArray(data.myTasks) ? data.myTasks : []);
          setImportantTasks(Array.isArray(data.importantTasks) ? data.importantTasks : []);
          setLatestHandovers(Array.isArray(data.latestHandovers) ? data.latestHandovers : []);
        })
        .catch(() => {})
        .finally(() => setTasksLoading(false));
    }
  }, [loadRooms]);

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
  const inboxItems = notificationItems.filter((item) => item.source === 'server');
  const inboxUnread = inboxItems.filter((item) => !item.read).length;
  const countValue = (value: number) => (tasksLoading ? '…' : String(value));
  const actionCenterCounts = [
    { key: 'my', label: t('dash.actionCenter.myTasks'), value: myTasks.length },
    { key: 'important', label: t('dash.actionCenter.importantTasks'), value: importantTasks.length },
    { key: 'handover', label: t('dash.actionCenter.latestHandover'), value: latestHandovers.length },
    { key: 'inbox', label: t('dash.actionCenter.inbox'), value: inboxUnread },
  ] as const;
  const isDark = theme === 'dark';
  const actionPanelClass = `rounded-xl border p-3.5 sm:p-4 min-h-[216px] flex flex-col ${
    isDark ? 'border-gray-700 bg-gray-800/60' : 'border-gray-200 bg-gray-50'
  }`;
  const actionItemClass = `rounded border px-2.5 py-2 transition-colors ${
    isDark ? 'border-gray-700 bg-gray-900/60 hover:bg-gray-800' : 'border-gray-200 bg-white hover:bg-gray-50'
  }`;

  const getSubtitle = (key: string) => {
    if (key === 'chat') return `${rooms.length} ${rooms.length !== 1 ? t('dash.chat.rooms') : t('dash.chat.room')}`;
    if (key === 'agents') return agents.total > 0 ? `${agents.active} ${t('dash.agents.active')}` : t('dash.agents.none');
    return t(`dash.${key}.sub`);
  };

  const getLink = (key: string) => {
    if (key === 'chat') return rooms.length > 0 ? `/room/${rooms[0]?.id ?? 'onboarding'}` : '/room/onboarding';
    if (key === 'agents') return '/settings';
    if (key === 'memory') return '/memory';
    if (key === 'secrets') return '/secrets';
    if (key === 'projects') return '/projects';
    return undefined;
  };

  const handoverAuthor = (handover: DashboardHandover) => {
    const displayName = handover.sender?.displayName?.trim();
    if (displayName) return displayName;
    return handover.sender?.username || 'Unknown';
  };

  return (
    <PageShell
      maxWidth="6xl"
      title={<span className="inline-flex items-center gap-2">🏠 {t("hero.title.prefix")} {t("hero.title.highlight")}</span>}
      subtitle={t("dash.subtitle")}
      headerClassName="text-center"
    >
      <Card tone="muted" className="mb-6 sm:mb-7 p-4 sm:p-5">
        <p className={`text-sm leading-relaxed ${isDark ? 'text-amber-200' : 'text-amber-800'}`}>
          ✨ {t('dash.wip.notice')}
        </p>
        <p className={`mt-1 text-xs leading-relaxed ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
          🔌 {t('dash.pluginReady')}
          <Link
            to="/plugin-dev"
            className={`ml-2 underline underline-offset-2 ${
              isDark ? 'text-blue-300 hover:text-blue-200' : 'text-blue-700 hover:text-blue-900'
            }`}
          >
            {t('dash.pluginReady.link')}
          </Link>
        </p>
      </Card>

      <Card className="mb-6 sm:mb-7 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 mb-4">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold tracking-tight leading-tight">🎯 {t('dash.actionCenter.title')}</h2>
            <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{t('dash.actionCenter.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Link
              to="/inbox"
              className={`text-sm font-medium transition-colors ${
                isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
              }`}
            >
              {t('dash.actionCenter.openInbox')}
            </Link>
            <Link
              to="/projects"
              className={`text-sm font-medium transition-colors ${
                isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
              }`}
            >
              {t('dash.actionCenter.openProjects')}
            </Link>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsActionCenterExpanded((expanded) => !expanded)}
            >
              {isActionCenterExpanded
                ? t('dash.actionCenter.collapse')
                : t('dash.actionCenter.expand')}
            </Button>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {actionCenterCounts.map((slot) => (
            <Badge
              key={slot.key}
              variant={slot.key === 'inbox' && inboxUnread > 0 ? 'info' : 'neutral'}
            >
              {slot.label}: {countValue(slot.value)}
            </Badge>
          ))}
        </div>

        {!isActionCenterExpanded ? (
          <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            {t('dash.actionCenter.collapsedHint')}
          </div>
        ) : tasksLoading ? (
          <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{t('dash.actionCenter.loading')}</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className={actionPanelClass}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold tracking-tight">{t('dash.actionCenter.myTasks')}</span>
                <Badge variant="neutral">{myTasks.length}</Badge>
              </div>
              {myTasks.length === 0 ? (
                <p className={`mt-1 text-sm leading-relaxed ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{t('dash.actionCenter.noneMy')}</p>
              ) : (
                <div className="space-y-2.5">
                  {myTasks.slice(0, 4).map((task) => (
                    <Link
                      key={task.id}
                      to={`/projects/${task.projectId}`}
                      className={`${actionItemClass} flex items-start justify-between gap-2`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-snug">{task.title}</div>
                        <div className={`truncate text-xs leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{task.projectName}</div>
                      </div>
                      <Badge variant={taskPriorityBadgeVariant(task.priority)}>
                        {t(`projects.priority.${task.priority}`) || task.priority}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className={actionPanelClass}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold tracking-tight">{t('dash.actionCenter.importantTasks')}</span>
                <Badge variant="neutral">{importantTasks.length}</Badge>
              </div>
              {importantTasks.length === 0 ? (
                <p className={`mt-1 text-sm leading-relaxed ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{t('dash.actionCenter.noneImportant')}</p>
              ) : (
                <div className="space-y-2.5">
                  {importantTasks.slice(0, 4).map((task) => (
                    <Link
                      key={task.id}
                      to={`/projects/${task.projectId}`}
                      className={`${actionItemClass} flex items-start justify-between gap-2`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-snug">{task.title}</div>
                        <div className={`truncate text-xs leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{task.projectName}</div>
                      </div>
                      <Badge variant={taskStatusBadgeVariant(task.status)}>
                        {t(`projects.status.${task.status}`) || task.status}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className={actionPanelClass}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold tracking-tight">{t('dash.actionCenter.latestHandover')}</span>
                <Badge variant="neutral">{latestHandovers.length}</Badge>
              </div>
              {latestHandovers.length === 0 ? (
                <p className={`mt-1 text-sm leading-relaxed ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{t('dash.actionCenter.noneHandover')}</p>
              ) : (
                <div className="space-y-2.5">
                  {latestHandovers.slice(0, 4).map((handover) => (
                    <Link
                      key={handover.messageId}
                      to={`/room/${handover.roomId}`}
                      className={`block ${actionItemClass}`}
                    >
                      <div className="truncate text-sm font-semibold leading-snug">{handover.projectName}</div>
                      <div className={`mt-0.5 truncate text-xs leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                        {handoverAuthor(handover)} · {new Date(handover.timestamp).toLocaleString()}
                      </div>
                      <div className={`mt-0.5 truncate text-xs leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {handover.contentPreview || t('dash.actionCenter.openRoom')}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className={actionPanelClass}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold tracking-tight">{t('dash.actionCenter.inbox')}</span>
                <Badge variant={inboxUnread > 0 ? 'info' : 'neutral'}>{inboxUnread}</Badge>
              </div>
              {inboxItems.length === 0 ? (
                <p className={`mt-1 text-sm leading-relaxed ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{t('dash.actionCenter.noneInbox')}</p>
              ) : (
                <div className="space-y-2.5">
                  {inboxItems.slice(0, 4).map((item) => (
                    <Link
                      key={item.id}
                      to={item.link || '/inbox'}
                      className={`block ${actionItemClass}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-sm font-semibold leading-snug">{item.title}</div>
                        {!item.read && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
                      </div>
                      {item.message && (
                        <div className={`mt-0.5 truncate text-xs leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {item.message}
                        </div>
                      )}
                      <div className={`mt-0.5 text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {new Date(item.createdAt).toLocaleString()}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
        {CARD_KEYS.map((card) => {
          const badge = card.key === 'chat' && totalUnread > 0
            ? `${totalUnread} ${t('dash.unread')}`
            : undefined;
          const link = card.status !== 'soon' ? getLink(card.key) : undefined;
          const isAvailable = card.status !== 'soon';

          const content = (
            <Card
              tone={isAvailable ? "default" : "muted"}
              className={`relative h-full min-h-[164px] sm:min-h-[176px] p-4 sm:p-5 transition-all flex flex-col ${
                isAvailable
                  ? isDark
                    ? 'hover:border-blue-500/50 hover:bg-gray-800'
                    : 'hover:border-blue-400 hover:shadow-md'
                  : 'opacity-60'
              }`}
            >
              {card.status === 'in_progress' && (
                <span className="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 dark:bg-amber-800/70 dark:text-amber-200">
                  {t("landing.platform.inProgress")}
                </span>
              )}

              {card.status === 'soon' && (
                <span className={`absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'
                }`}>
                  {t("landing.platform.soon")}
                </span>
              )}

              {badge && (
                <span className="absolute top-3 right-3 text-xs font-bold px-2 py-0.5 rounded-full bg-blue-500 text-white">
                  {badge}
                </span>
              )}

              <div className="text-3xl mb-2.5">{card.icon}</div>
              <h3 className="text-base sm:text-lg font-semibold tracking-tight leading-snug mb-1">{t(`dash.${card.key}.title`)}</h3>
              <p className={`text-sm mt-2 leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {getSubtitle(card.key)}
              </p>
            </Card>
          );

          if (link) return <Link key={card.key} to={link} className="block h-full">{content}</Link>;
          return <div key={card.key} className="h-full">{content}</div>;
        })}
      </div>

      <Card tone="accent" className="mt-8 sm:mt-10 text-center p-5 sm:p-6">
        <p className={`text-sm ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
          🚧 <strong>Beta</strong> — {t("dash.beta.text")}
        </p>
        <div className="mt-3 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/byoa"
            className={`text-sm font-medium transition-colors ${
              isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'
            }`}
          >
            → {t("dash.beta.byoa")}
          </Link>
          <Link
            to="/plugin-dev"
            className={`text-sm font-medium transition-colors ${
              isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'
            }`}
          >
            → {t("dash.beta.pluginDocs")}
          </Link>
        </div>
      </Card>
    </PageShell>
  );
};
