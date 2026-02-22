import React, { useRef, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useChatStore } from '../../stores/chatStore';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuthStore();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const location = useLocation();
  const { unreadCounts } = useChatStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isDark = theme === 'dark';
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close menu on navigation
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const isChat = location.pathname.startsWith('/room');

  const navLink = (to: string, label: string, active: boolean, badge?: number) => (
    <Link
      to={to}
      className={`relative px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? isDark ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-900'
          : isDark ? 'text-gray-300 hover:text-white hover:bg-gray-800' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
      }`}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-blue-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );

  if (!user) return null;

  return (
    <nav className={`sticky top-0 z-50 border-b backdrop-blur-sm ${
      isDark ? 'bg-gray-900/90 border-gray-800' : 'bg-white/90 border-gray-200'
    }`}>
      <div className="max-w-7xl mx-auto px-4 h-12 flex items-center justify-between">
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-1">
          <Link to="/" className="flex items-center gap-2 mr-4 hover:opacity-80 transition-opacity">
            <span className="text-lg">🧊🌋👨‍💻</span>
            <span className="font-bold text-sm hidden sm:inline">OpenTriologue</span>
          </Link>

          {navLink('/', `🏠 ${t('nav.home')}`, location.pathname === '/')}
          {navLink('/room/onboarding', `💬 ${t('nav.chat')}`, isChat, totalUnread)}
          {(user as any)?.isAdmin && navLink('/admin', `🔧 ${t('nav.admin')}`, location.pathname === '/admin')}
        </div>

        {/* Right: User menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            className={`flex items-center gap-2 px-2 py-1 rounded-lg transition-colors ${
              isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
            }`}
          >
            <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
              {user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <span className="text-sm font-medium hidden sm:inline">{user?.username}</span>
            <span className={`text-xs transition-transform ${menuOpen ? 'rotate-180' : ''}`}>▼</span>
          </button>

          {menuOpen && (
            <div className={`absolute right-0 top-full mt-1 w-44 rounded-lg shadow-lg border py-1 ${
              isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
            }`}>
              <Link
                to="/settings"
                className={`block px-4 py-2 text-sm transition-colors ${
                  isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                }`}
              >
                ⚙️ {t('nav.settings')}
              </Link>
              <Link
                to="/byoa"
                className={`block px-4 py-2 text-sm transition-colors ${
                  isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                }`}
              >
                📖 {t('nav.byoa')}
              </Link>
              <hr className={isDark ? 'border-gray-700' : 'border-gray-200'} />
              <button
                onClick={logout}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  isDark ? 'text-red-300 hover:bg-red-900/30' : 'text-red-600 hover:bg-red-50'
                }`}
              >
                🚪 {t('nav.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};
