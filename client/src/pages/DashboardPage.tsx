import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useTheme } from '../contexts/ThemeContext';
import { useChatStore } from '../stores/chatStore';
import { useLanguage } from '../contexts/LanguageContext';

interface AgentSummary {
  total: number;
  active: number;
}

const CARD_KEYS = [
  { icon: '💬', key: 'chat', available: true, linkKey: 'chat' },
  { icon: '🤖', key: 'agents', available: true, linkKey: 'agents' },
  { icon: '🧠', key: 'memory', available: false },
  { icon: '⚡', key: 'workflows', available: false },
  { icon: '🏪', key: 'marketplace', available: false },
  { icon: '🚀', key: 'projects', available: true },
  { icon: '🔑', key: 'secrets', available: true },
  { icon: '🔗', key: 'github', available: false },
  { icon: '📊', key: 'analytics', available: false },
] as const;

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
    <div className={`min-h-screen ${isDark ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold mb-3">
            {t("hero.title.prefix")} {t("hero.title.highlight")}
          </h2>
          <p className={`text-lg ${isDark ? 'text-gray-400' : 'text-gray-600'} max-w-2xl mx-auto`}>
            {t("dash.subtitle")}
          </p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {CARD_KEYS.map((card) => {
            const badge = card.key === 'chat' && totalUnread > 0
              ? `${totalUnread} ${t('dash.unread')}`
              : undefined;
            const link = card.available ? getLink(card.key) : undefined;

            const content = (
              <div
                key={card.key}
                className={`relative p-6 rounded-xl border transition-all ${
                  card.available
                    ? isDark
                      ? 'bg-gray-800/50 border-gray-700 hover:border-blue-500/50 hover:bg-gray-800 cursor-pointer'
                      : 'bg-white border-gray-200 hover:border-blue-400 hover:shadow-md cursor-pointer'
                    : isDark
                      ? 'bg-gray-800/20 border-gray-800 opacity-60'
                      : 'bg-gray-100/50 border-gray-200 opacity-60'
                }`}
              >
                {!card.available && (
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
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {getSubtitle(card.key)}
                </p>
              </div>
            );

            if (link) return <Link key={card.key} to={link}>{content}</Link>;
            return <div key={card.key}>{content}</div>;
          })}
        </div>

        {/* Beta Notice */}
        <div className={`mt-12 text-center p-6 rounded-xl border ${
          isDark ? 'bg-blue-900/10 border-blue-800/30' : 'bg-blue-50 border-blue-200'
        }`}>
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
        </div>
      </main>
    </div>
  );
};
