/**
 * AppShell — Global side navigation wrapper for all authenticated pages.
 * Desktop: slim persistent sidebar. Mobile: hamburger + slide-out overlay.
 * Ice 🧊 — 2026-02-21
 */
import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../contexts/ThemeContext';
import { useChatStore } from '../../stores/chatStore';
import { Bars3Icon, XMarkIcon, LockClosedIcon } from '@heroicons/react/24/outline';

interface NavItem {
  to: string;
  icon: string;
  label: string;
  badge?: number;
  match: (path: string) => boolean;
  available: boolean;
  adminOnly?: boolean;
}

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuthStore();
  const { theme } = useTheme();
  const location = useLocation();
  const { unreadCounts } = useChatStore();
  const [open, setOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const isDark = theme === 'dark';
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  // Close on navigation
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Close on outside click (mobile)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (open && sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const { rooms, loadRooms, markRoomAsRead } = useChatStore();
  const isInChat = location.pathname.startsWith('/room');

  useEffect(() => { loadRooms(); }, [loadRooms]);

  const nav: NavItem[] = [
    { to: '/', icon: '🏠', label: 'Home', match: p => p === '/', available: true },
    { to: '/room/onboarding', icon: '💬', label: 'Chat', badge: totalUnread, match: p => p.startsWith('/room'), available: true },
    { to: '#', icon: '🧠', label: 'Memory', match: () => false, available: false },
    { to: '#', icon: '⚡', label: 'Workflows', match: () => false, available: false },
    { to: '#', icon: '🏪', label: 'Marketplace', match: () => false, available: false },
    { to: '#', icon: '🚀', label: 'Projects', match: () => false, available: false },
    { to: '/admin', icon: '🔧', label: 'Admin', match: p => p === '/admin', available: true, adminOnly: true },
  ];

  const bottomNav: NavItem[] = [
    { to: '/settings', icon: '⚙️', label: 'Settings', match: p => p === '/settings', available: true },
    { to: '/byoa', icon: '📖', label: 'BYOA Docs', match: p => p === '/byoa', available: true },
  ];

  const filteredNav = nav.filter(n => !n.adminOnly || (user as any)?.isAdmin);

  const renderNavItem = (item: NavItem, compact: boolean) => {
    const active = item.match(location.pathname);
    const disabled = !item.available;

    const cls = [
      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all relative group',
      active
        ? isDark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700'
        : disabled
          ? isDark ? 'text-gray-600 cursor-default' : 'text-gray-400 cursor-default'
          : isDark ? 'text-gray-300 hover:bg-gray-800 hover:text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
    ].join(' ');

    const inner = (
      <>
        <span className="text-base w-5 text-center flex-shrink-0">{item.icon}</span>
        {!compact && <span className="truncate">{item.label}</span>}
        {!compact && disabled && (
          <span className={`ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
            isDark ? 'bg-gray-800 text-gray-500' : 'bg-gray-200 text-gray-400'
          }`}>Soon</span>
        )}
        {item.badge !== undefined && item.badge > 0 && (
          <span className={`${compact ? 'absolute -top-1 -right-1' : 'ml-auto'} min-w-4 h-4 px-1 bg-blue-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold`}>
            {item.badge > 99 ? '99+' : item.badge}
          </span>
        )}
      </>
    );

    if (disabled) {
      return <div key={item.label} className={cls}>{inner}</div>;
    }
    return <Link key={item.label} to={item.to} className={cls}>{inner}</Link>;
  };

  // Room sub-list under Chat
  const renderRoomList = () => {
    if (!isInChat || rooms.length === 0) return null;
    const currentRoomId = location.pathname.split('/room/')[1];
    return (
      <div className="ml-5 pl-3 border-l border-gray-700/50 space-y-0.5 mt-0.5 mb-1">
        {rooms.map(room => {
          const active = room.id === currentRoomId;
          const unread = unreadCounts[room.id] ?? 0;
          return (
            <Link
              key={room.id}
              to={`/room/${room.id}`}
              onClick={() => markRoomAsRead(room.id)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                active
                  ? isDark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700'
                  : isDark ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <span className="truncate flex-1">{room.name}</span>
              {room.isPrivate && <LockClosedIcon className="w-3 h-3 flex-shrink-0 opacity-50" />}
              {unread > 0 && !active && (
                <span className="min-w-4 h-4 px-1 bg-blue-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold flex-shrink-0">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    );
  };

  // Sidebar content (shared between mobile overlay and desktop)
  const sidebarContent = (compact: boolean) => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <Link to="/" className={`flex items-center gap-2 px-3 py-4 ${compact ? 'justify-center' : ''} hover:opacity-80 transition-opacity`}>
        <span className="text-xl">🧊🌋</span>
        {!compact && <span className="font-bold text-sm">Triologue</span>}
      </Link>

      {/* Main nav */}
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {filteredNav.map(n => {
          const item = renderNavItem(n, compact);
          // Insert room list after Chat nav item
          if (n.label === 'Chat' && !compact) {
            return <React.Fragment key={n.label}>{item}{renderRoomList()}</React.Fragment>;
          }
          return item;
        })}
      </nav>

      {/* Bottom nav */}
      <div className={`px-2 pb-2 space-y-0.5 border-t ${isDark ? 'border-gray-800' : 'border-gray-200'} pt-2`}>
        {bottomNav.map(n => renderNavItem(n, compact))}
        {/* User */}
        <button
          onClick={logout}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors w-full ${
            isDark ? 'text-red-400 hover:bg-red-900/20' : 'text-red-600 hover:bg-red-50'
          }`}
        >
          <span className="text-base w-5 text-center flex-shrink-0">🚪</span>
          {!compact && <span>Logout</span>}
        </button>
        {!compact && (
          <div className={`flex items-center gap-2 px-3 py-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
              {user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <span className="text-xs truncate">{user?.username}</span>
          </div>
        )}
      </div>
    </div>
  );

  if (!user) return <>{children}</>;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile hamburger */}
      <button
        onClick={() => setOpen(true)}
        className={`fixed top-2 left-2 z-50 p-2 rounded-lg md:hidden ${
          isDark ? 'bg-gray-800 text-white' : 'bg-white text-gray-900 shadow-md'
        }`}
      >
        <Bars3Icon className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Mobile sidebar */}
      <div
        ref={sidebarRef}
        className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200 md:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        } ${isDark ? 'bg-gray-900 border-r border-gray-800' : 'bg-white border-r border-gray-200'}`}
      >
        <button
          onClick={() => setOpen(false)}
          className={`absolute top-3 right-3 p-1 rounded ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
        {sidebarContent(false)}
      </div>

      {/* Desktop sidebar */}
      <div className={`hidden md:flex flex-col flex-shrink-0 w-48 ${
        isDark ? 'bg-gray-900 border-r border-gray-800' : 'bg-white border-r border-gray-200'
      }`}>
        {sidebarContent(false)}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-auto">
        {children}
      </div>
    </div>
  );
};
