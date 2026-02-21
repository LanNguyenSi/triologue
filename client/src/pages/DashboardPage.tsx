import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useTheme } from '../contexts/ThemeContext';
import { useChatStore } from '../stores/chatStore';

interface AgentSummary {
  total: number;
  active: number;
}

export const DashboardPage: React.FC = () => {
  const { user } = useAuthStore();
  const { theme } = useTheme();
  const { rooms, loadRooms, unreadCounts } = useChatStore();
  const [agents, setAgents] = useState<AgentSummary>({ total: 0, active: 0 });

  useEffect(() => {
    loadRooms();
    // Load agent count
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

  const cards = [
    {
      icon: '💬',
      title: 'Chat',
      subtitle: `${rooms.length} room${rooms.length !== 1 ? 's' : ''}`,
      badge: totalUnread > 0 ? `${totalUnread} unread` : undefined,
      link: rooms.length > 0 ? `/room/${rooms[0]?.id ?? 'onboarding'}` : '/room/onboarding',
      available: true,
    },
    {
      icon: '🤖',
      title: 'My Agents',
      subtitle: agents.total > 0 ? `${agents.active} active` : 'No agents yet',
      link: '/settings',
      available: true,
    },
    {
      icon: '🧠',
      title: 'Team Memory',
      subtitle: 'Shared knowledge your AI remembers',
      available: false,
    },
    {
      icon: '⚡',
      title: 'Workflows',
      subtitle: 'Automate tasks with your AI team',
      available: false,
    },
    {
      icon: '🏪',
      title: 'Marketplace',
      subtitle: 'Find & install agents in seconds',
      available: false,
    },
    {
      icon: '🚀',
      title: 'Projects',
      subtitle: 'Organize work with your AI team',
      available: false,
    },
    {
      icon: '🔑',
      title: 'Shared Secrets',
      subtitle: 'Team-scoped API keys & credentials',
      available: false,
    },
    {
      icon: '🔗',
      title: 'GitHub',
      subtitle: 'Connect repos, automate PRs',
      available: false,
    },
    {
      icon: '📊',
      title: 'Team Analytics',
      subtitle: 'Activity, performance, costs',
      available: false,
    },
  ];

  return (
    <div className={`min-h-screen ${isDark ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold mb-3">
            Build AI-Human Teams
          </h2>
          <p className={`text-lg ${isDark ? 'text-gray-400' : 'text-gray-600'} max-w-2xl mx-auto`}>
            Where humans and AI agents collaborate as real teams — not just chat.
          </p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {cards.map((card) => {
            const content = (
              <div
                key={card.title}
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
                {/* Coming Soon badge */}
                {!card.available && (
                  <span className={`absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'
                  }`}>
                    Coming Soon
                  </span>
                )}

                {/* Unread badge */}
                {card.badge && (
                  <span className="absolute top-3 right-3 text-xs font-bold px-2 py-0.5 rounded-full bg-blue-500 text-white">
                    {card.badge}
                  </span>
                )}

                <div className="text-3xl mb-3">{card.icon}</div>
                <h3 className="text-lg font-semibold mb-1">{card.title}</h3>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {card.subtitle}
                </p>
              </div>
            );

            if (card.available && card.link) {
              return <Link key={card.title} to={card.link}>{content}</Link>;
            }
            return <div key={card.title}>{content}</div>;
          })}
        </div>

        {/* Beta Notice */}
        <div className={`mt-12 text-center p-6 rounded-xl border ${
          isDark ? 'bg-blue-900/10 border-blue-800/30' : 'bg-blue-50 border-blue-200'
        }`}>
          <p className={`text-sm ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
            🚧 <strong>Beta</strong> — You're early. Chat and Agent management are live.
            Projects, integrations, and more are on the way.
          </p>
          <Link
            to="/byoa"
            className={`inline-block mt-3 text-sm font-medium transition-colors ${
              isDark ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'
            }`}
          >
            → Bring Your Own Agent (BYOA) Docs
          </Link>
        </div>
      </main>
    </div>
  );
};
