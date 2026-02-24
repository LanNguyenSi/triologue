import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useTheme } from '../contexts/ThemeContext';
import { useChatStore } from '../stores/chatStore';
import { useLanguage } from '../contexts/LanguageContext';
import { PageShell } from '../components/ui/PageShell';
import { Card } from '../components/ui/primitives';

interface AgentSummary {
  total: number;
  active: number;
}

type CardStatus = 'live' | 'in_progress' | 'soon';

const CARD_KEYS = [
  { icon: '💬', key: 'chat', status: 'live' },
  { icon: '🤖', key: 'agents', status: 'live' },
  { icon: '🧠', key: 'memory', status: 'soon' },
  { icon: '⚡', key: 'workflows', status: 'soon' },
  { icon: '🏪', key: 'marketplace', status: 'soon' },
  { icon: '🚀', key: 'projects', status: 'live' },
  { icon: '🔑', key: 'secrets', status: 'in_progress' },
  { icon: '🔗', key: 'github', status: 'soon' },
  { icon: '📊', key: 'analytics', status: 'soon' },
] as const satisfies Array<{ icon: string; key: string; status: CardStatus }>;

export const DashboardPage: React.FC = () => {
  const { user } = useAuthStore();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const { rooms, loadRooms, unreadCounts } = useChatStore();
  const [agents, setAgents] = useState<AgentSummary>({ total: 0, active: 0 });

  useEffect(() => {
    loadRooms();
    const token = localStorage.getItem('triologue_token');
    if (token) {
      fetch('/api/agents/mine', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : [])
        .then((list: any[]) => setAgents({
          total: list.length,
          active: list.filter(a => a.status === 'active').length,
        }))
        .catch(() => {});
    }
  }, [loadRooms]);

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
  const isDark = theme === 'dark';

  const getSubtitle = (key: string) => {
    if (key === 'chat') return `${rooms.length} ${rooms.length !== 1 ? t('dash.chat.rooms') : t('dash.chat.room')}`;
    if (key === 'agents') return agents.total > 0 ? `${agents.active} ${t('dash.agents.active')}` : t('dash.agents.none');
    return t(`dash.${key}.sub`);
  };

  const getLink = (key: string) => {
    if (key === 'chat') return rooms.length > 0 ? `/room/${rooms[0]?.id ?? 'onboarding'}` : '/room/onboarding';
    if (key === 'agents') return '/settings';
    if (key === 'secrets') return '/secrets';
    if (key === 'projects') return '/projects';
    return undefined;
  };

  return (
    <PageShell
      maxWidth="6xl"
      title={<span className="inline-flex items-center gap-2">🏠 {t("hero.title.prefix")} {t("hero.title.highlight")}</span>}
      subtitle={t("dash.subtitle")}
      headerClassName="text-center"
    >
      <Card tone="muted" className="mb-5 sm:mb-6 p-4 sm:p-5">
        <p className={`text-sm ${isDark ? 'text-amber-200' : 'text-amber-800'}`}>
          ✨ {t('dash.wip.notice')}
        </p>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {CARD_KEYS.map((card) => {
          const badge = card.key === 'chat' && totalUnread > 0
            ? `${totalUnread} ${t('dash.unread')}`
            : undefined;
          const link = card.status !== 'soon' ? getLink(card.key) : undefined;
          const isAvailable = card.status !== 'soon';

          const content = (
            <Card
              tone={isAvailable ? "default" : "muted"}
              className={`relative h-full min-h-[152px] sm:min-h-[164px] p-5 sm:p-6 transition-all flex flex-col ${
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

              <div className="text-3xl mb-3">{card.icon}</div>
              <h3 className="text-lg font-semibold mb-1">{t(`dash.${card.key}.title`)}</h3>
              <p className={`text-sm mt-auto ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {getSubtitle(card.key)}
              </p>
            </Card>
          );

          if (link) return <Link key={card.key} to={link} className="block h-full">{content}</Link>;
          return <div key={card.key} className="h-full">{content}</div>;
        })}
      </div>

      <Card tone="accent" className="mt-8 sm:mt-12 text-center p-5 sm:p-6">
        <p className={`text-sm ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
          🚧 <strong>Beta</strong> — {t("dash.beta.text")}
        </p>
        <Link
          to="/byoa"
          className={`inline-block mt-3 text-sm font-medium transition-colors ${
            isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'
          }`}
        >
          → {t("dash.beta.byoa")}
        </Link>
      </Card>
    </PageShell>
  );
};
