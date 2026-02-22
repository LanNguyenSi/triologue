import React, { useRef, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useChatStore } from '../../stores/chatStore';
import { BellIcon, CheckIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore } from '../../stores/notificationStore';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuthStore();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const { unreadCounts } = useChatStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const isDark = theme === 'dark';
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  // Notification store
  const notifItems = useNotificationStore((s) => s.items);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const remove = useNotificationStore((s) => s.remove);
  const clear = useNotificationStore((s) => s.clear);

  const unreadNotifCount = notifItems.filter((item) => !item.read).length;

  const typeDotClass: Record<string, string> = {
    info: 'bg-blue-500',
    success: 'bg-green-500',
    warning: 'bg-yellow-500',
    error: 'bg-red-500',
  };

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close menus on navigation
  useEffect(() => { 
    setMenuOpen(false); 
    setNotifOpen(false);
  }, [location.pathname]);

  // Mark all as read when notification panel opens
  useEffect(() => {
    if (notifOpen) markAllRead();
  }, [notifOpen, markAllRead]);

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

        {/* Right: Notifications + User menu */}
        <div className="flex items-center gap-2">
          {/* Notification Center (inline in header) */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setNotifOpen(o => !o)}
              className={`relative p-2 rounded-lg transition-colors ${
                isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
              }`}
              title={notifOpen ? t('notifications.close') : t('notifications.open')}
            >
              <BellIcon className="w-5 h-5" />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
                  {unreadNotifCount > 99 ? '99+' : unreadNotifCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className={`absolute right-0 top-full mt-1 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border shadow-2xl ${
                isDark ? 'bg-gray-900 border-gray-700 text-gray-100' : 'bg-white border-gray-200 text-gray-900'
              }`}>
                <div className={`flex items-center justify-between px-3 py-2 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                  <div className="text-sm font-semibold">{t('notifications.title')}</div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => markAllRead()}
                      className={`rounded p-1 text-xs ${isDark ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}
                      title={t('notifications.markAllRead')}
                    >
                      <CheckIcon className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => clear()}
                      className={`rounded p-1 text-xs ${isDark ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}
                      title={t('notifications.clearAll')}
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {notifItems.length === 0 ? (
                  <div className={`px-3 py-6 text-sm text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {t('notifications.empty')}
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    {notifItems.map((item) => (
                      <div
                        key={item.id}
                        className={`px-3 py-2 border-b last:border-b-0 ${isDark ? 'border-gray-800' : 'border-gray-100'} ${
                          item.read ? '' : isDark ? 'bg-gray-800/40' : 'bg-blue-50/60'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className={`mt-1 inline-block w-2 h-2 rounded-full ${typeDotClass[item.type] || typeDotClass.info}`} />
                          <button
                            type="button"
                            className="flex-1 text-left min-w-0"
                            onClick={() => {
                              markRead(item.id);
                              if (item.link) {
                                navigate(item.link);
                                setNotifOpen(false);
                              }
                            }}
                          >
                            <div className="text-sm font-medium truncate">{item.title}</div>
                            {item.message && (
                              <div className={`text-xs mt-0.5 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{item.message}</div>
                            )}
                            <div className={`text-[10px] mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                              {new Date(item.createdAt).toLocaleString()}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(item.id)}
                            className={`rounded p-0.5 ${isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
                            title={t('notifications.remove')}
                          >
                            <XMarkIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* User Menu */}
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
      </div>
    </nav>
  );
};
