/**
 * AppShell — Global side navigation wrapper for all authenticated pages.
 * Desktop: slim persistent sidebar. Mobile: hamburger + slide-out overlay.
 * Ice 🧊 — 2026-02-21
 */
import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useChatStore } from '../../stores/chatStore';
import { useSocketStore } from '../../stores/socketStore';
import { Bars3Icon, XMarkIcon, LockClosedIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { CreateRoomModal } from '../chat/CreateRoomModal';

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
  const { t } = useLanguage();
  const location = useLocation();
  const { unreadCounts } = useChatStore();
  const [open, setOpen] = useState(false);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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

  const { rooms, loadRooms, markRoomAsRead, createRoom, deleteRoom } = useChatStore();
  const { joinRoom } = useSocketStore();

  useEffect(() => { loadRooms(); }, [loadRooms]);

  const handleCreateRoom = async (name: string, description: string, roomType: string, isPrivate: boolean) => {
    const room = await createRoom(name, description, roomType, isPrivate);
    if (room) {
      joinRoom(room.id);
      navigate(`/room/${room.id}`);
      setShowCreateRoom(false);
    } else {
      throw new Error('Failed to create room');
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (!confirm('Delete this room?')) return;
    const ok = await deleteRoom(roomId);
    if (ok && location.pathname === `/room/${roomId}`) navigate('/room/onboarding');
  };

  const nav: NavItem[] = [
    { to: '/', icon: '🏠', label: t('nav.home'), match: p => p === '/', available: true },
    { to: '/room/onboarding', icon: '💬', label: t('nav.chat'), badge: totalUnread, match: p => p.startsWith('/room'), available: true },
    { to: '/admin', icon: '🔧', label: t('nav.admin'), match: p => p === '/admin', available: true, adminOnly: true },
  ];

  const bottomNav: NavItem[] = [
    { to: '/settings', icon: '⚙️', label: t('nav.settings'), match: p => p === '/settings', available: true },
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

  // Rooms section — always visible, own group
  const PROTECTED_ROOMS = ['main-triologue'];
  const currentRoomId = location.pathname.startsWith('/room/') ? location.pathname.split('/room/')[1] : null;

  const renderRoomsSection = (compact: boolean) => {
    if (compact || rooms.length === 0) return null;
    return (
      <div className={`px-2 mt-1 pt-2 border-t ${isDark ? 'border-gray-800' : 'border-gray-200'}`}>
        {/* Section header */}
        <div className="flex items-center justify-between px-2 mb-1">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {t('nav.rooms')}
          </span>
          <button
            onClick={() => setShowCreateRoom(true)}
            className={`p-0.5 rounded transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
            title="New Room"
          >
            <PlusIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Room list — scrollable */}
        <div className="space-y-0.5 max-h-52 overflow-y-auto">
          {rooms.map(room => {
            const active = room.id === currentRoomId;
            const unread = unreadCounts[room.id] ?? 0;
            const canDelete = !PROTECTED_ROOMS.includes(room.id);
            return (
              <div key={room.id} className="group flex items-center">
                <Link
                  to={`/room/${room.id}`}
                  onClick={() => markRoomAsRead(room.id)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors flex-1 min-w-0 ${
                    active
                      ? isDark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700'
                      : isDark ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-blue-400' : unread > 0 ? 'bg-blue-500' : isDark ? 'bg-gray-600' : 'bg-gray-300'}`} />
                  <span className={`truncate flex-1 ${unread > 0 && !active ? 'font-semibold text-white' : ''}`}>{room.name}</span>
                  {room.isPrivate && <LockClosedIcon className="w-3 h-3 flex-shrink-0 opacity-40" />}
                  {unread > 0 && !active && (
                    <span className="min-w-4 h-4 px-1 bg-blue-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold flex-shrink-0">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </Link>
                {canDelete && (
                  <button
                    onClick={() => handleDeleteRoom(room.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-600 hover:text-red-400 transition-all flex-shrink-0"
                  >
                    <TrashIcon className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Sidebar content (shared between mobile overlay and desktop)
  const sidebarContent = (compact: boolean, isMobile = false) => (
    <div className="flex flex-col h-full">
      {/* Logo + close button row */}
      <div className={`flex items-center ${compact ? 'justify-center' : 'justify-between'} px-3 py-3`}>
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <span className="text-xl">🧊🌋</span>
          {!compact && <span className="font-bold text-sm">OpenTriologue</span>}
        </Link>
        {isMobile && (
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(false); }}
            className={`p-1.5 rounded-lg ${isDark ? 'text-gray-400 hover:text-white hover:bg-gray-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Main nav */}
      <nav className="px-2 space-y-0.5">
        {filteredNav.map(n => renderNavItem(n, compact))}
      </nav>

      {/* Rooms section */}
      <div className="flex-1 overflow-y-auto">
        {renderRoomsSection(compact)}
      </div>

      {/* Bottom — User + Settings + Logout */}
      <div className={`px-2 pb-2 border-t ${isDark ? 'border-gray-800' : 'border-gray-200'} pt-2 space-y-0.5`}>
        {!compact && (
          <div className={`flex items-center gap-2 px-3 py-1.5 mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
              {user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <span className="text-xs font-medium truncate">{user?.username}</span>
          </div>
        )}
        {bottomNav.map(n => renderNavItem(n, compact))}
        <button
          onClick={logout}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-colors w-full ${
            isDark ? 'text-gray-500 hover:text-red-400 hover:bg-red-900/20' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
          }`}
        >
          <span className="text-sm w-5 text-center flex-shrink-0">🚪</span>
          {!compact && <span>{t('nav.logout')}</span>}
        </button>
      </div>
    </div>
  );

  if (!user) return <>{children}</>;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Mobile top bar with hamburger */}
      <div className={`md:hidden flex items-center h-10 px-2 flex-shrink-0 border-b ${
        isDark ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
      }`}>
        <button
          onClick={() => setOpen(true)}
          className={`p-1.5 rounded-lg ${isDark ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <Bars3Icon className="w-5 h-5" />
        </button>
        <span className={`ml-2 text-sm font-medium truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>OpenTriologue</span>
      </div>

      {/* Desktop + Content row */}
      <div className="flex flex-1 overflow-hidden">

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
        {sidebarContent(false, true)}
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

      </div>{/* end Desktop + Content row */}

      {/* Create Room Modal */}
      {showCreateRoom && (
        <CreateRoomModal
          onClose={() => setShowCreateRoom(false)}
          onCreate={handleCreateRoom}
        />
      )}
    </div>
  );
};
