/**
 * AppShell — Global side navigation wrapper for all authenticated pages.
 * Desktop: slim persistent sidebar. Mobile: hamburger + slide-out overlay.
 * Ice 🧊 — 2026-02-21
 */
import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useChatStore } from '../../stores/chatStore';
import { useSocketStore } from '../../stores/socketStore';
import {
  Bars3Icon, XMarkIcon, HomeIcon, InboxIcon, ChatBubbleLeftRightIcon,
  ClipboardDocumentListIcon, CubeTransparentIcon, FolderIcon, KeyIcon,
  PuzzlePieceIcon, WrenchIcon, BookOpenIcon, Cog6ToothIcon, ShieldExclamationIcon,
} from '@heroicons/react/24/outline';
import { usePendingApprovals } from '../../hooks/usePendingApprovals';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { CreateRoomModal } from '../chat/CreateRoomModal';
import { ConfirmDialog } from '../ui';
import { useNotificationStore } from '../../stores/notificationStore';
import { NotificationCenter } from '../ui/NotificationCenter';
import { BrandMark } from '../ui/BrandMark';
import { usePluginStore } from '../../stores/pluginStore';
import type { NavItem } from './sidebarTypes';
import { SidebarNavItem } from './SidebarNavItem';
import { SidebarRoomList } from './SidebarRoomList';
import { SidebarUserMenu } from './SidebarUserMenu';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuthStore();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const location = useLocation();
  const { unreadCounts, loadRooms, createRoom, deleteRoom } = useChatStore();
  const plugins = usePluginStore((state) => state.plugins);
  const loadPlugins = usePluginStore((state) => state.loadPlugins);
  const resetPlugins = usePluginStore((state) => state.resetPlugins);
  const notificationItems = useNotificationStore((state) => state.items);
  const addNotification = useNotificationStore((state) => state.add);
  const [open, setOpen] = useState(false);
  // Owned here (not in the sidebar components) so the always-mounted mobile and
  // desktop sidebars share one value, matching the pre-decomposition behavior.
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const isDark = theme === 'dark';
  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
  const inboxUnread = notificationItems.filter((item) => item.source === 'server' && !item.read).length;
  const pendingApprovals = usePendingApprovals();

  // Close mobile sidebar + user menu on navigation
  useEffect(() => {
    setOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

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

  // Trap focus + close on Escape while the mobile sidebar drawer is open.
  // When the user menu is open, let its own trap handle Escape first so one
  // press unwinds a single layer (menu first, then the drawer).
  useFocusTrap(sidebarRef, open, () => {
    if (!userMenuOpen) setOpen(false);
  });

  const { joinRoom, connect, disconnect } = useSocketStore();

  useEffect(() => {
    if (!user) {
      disconnect();
      return;
    }
    connect();
  }, [user?.id, connect, disconnect]);

  useEffect(() => {
    if (!user) return;
    loadRooms();
  }, [loadRooms, user?.id]);

  useEffect(() => {
    if (!user) {
      resetPlugins();
      return;
    }
    void loadPlugins();
  }, [user?.id, loadPlugins, resetPlugins]);

  const handleCreateRoom = async (name: string, description: string, roomType: string, isPrivate: boolean) => {
    const room = await createRoom(name, description, roomType, isPrivate);
    if (room) {
      if (room.projectId) {
        const text = t('chat.notice.projectCreatedFromRoom').replace('{projectId}', room.projectId);
        toast.success(text);
        addNotification({
          type: 'success',
          title: t('notifications.roomCreatedTitle'),
          message: text,
          link: `/projects/${room.projectId}`,
        });
      }
      joinRoom(room.id);
      navigate(`/room/${room.id}`);
      setShowCreateRoom(false);
    } else {
      throw new Error(t('chat.createFailed'));
    }
  };

  const [confirmDeleteRoom, setConfirmDeleteRoom] = useState<{ id: string; name: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleDeleteRoom = async (roomId: string) => {
    setDeleteLoading(true);
    const ok = await deleteRoom(roomId);
    if (ok && location.pathname === `/room/${roomId}`) navigate('/');
    setDeleteLoading(false);
    setConfirmDeleteRoom(null);
  };

  const pluginNav: NavItem[] = plugins.flatMap((plugin) =>
    (plugin.ui?.navItems ?? []).map((entry) => {
      const exact = entry.match === 'exact';
      return {
        key: `plugin:${plugin.id}:${entry.to}`,
        to: entry.to,
        icon: entry.icon
          ? <span className="text-base w-5 text-center">{entry.icon}</span>
          : <PuzzlePieceIcon className="w-4 h-4" />,
        label: entry.labelKey ? t(entry.labelKey) : entry.label,
        match: exact
          ? (path: string) => path === entry.to
          : (path: string) => path === entry.to || path.startsWith(`${entry.to}/`),
        available: true,
        adminOnly: entry.adminOnly,
      };
    }),
  );

  const nav: NavItem[] = [
    { key: 'home', to: '/', icon: <HomeIcon className="w-4 h-4" />, label: t('nav.home'), match: p => p === '/', available: true },
    { key: 'inbox', to: '/inbox', icon: <InboxIcon className="w-4 h-4" />, label: t('nav.inbox'), badge: inboxUnread, match: p => p === '/inbox', available: true },
    { key: 'approvals', to: '/approvals', icon: <ShieldExclamationIcon className="w-4 h-4" />, label: t('nav.approvals'), badge: pendingApprovals, match: p => p === '/approvals', available: true },
    { key: 'chat', to: '/room/onboarding', icon: <ChatBubbleLeftRightIcon className="w-4 h-4" />, label: t('nav.chat'), badge: totalUnread, match: p => p.startsWith('/room'), available: true },
    { key: 'projects', to: '/projects', icon: <ClipboardDocumentListIcon className="w-4 h-4" />, label: t('nav.projects'), match: p => p.startsWith('/projects'), available: true },
    { key: 'files', to: '/files', icon: <FolderIcon className="w-4 h-4" />, label: t('nav.files'), match: p => p === '/files' || p.startsWith('/files/'), available: true },
    { key: 'memory', to: '/memory', icon: <CubeTransparentIcon className="w-4 h-4" />, label: t('nav.memory'), match: p => p === '/memory' || p.startsWith('/memory/'), available: true },
    { key: 'secrets', to: '/secrets', icon: <KeyIcon className="w-4 h-4" />, label: t('nav.secrets'), match: p => p === '/secrets' || p.startsWith('/secrets/'), available: true },
    ...pluginNav,
  ];

  const bottomNav: NavItem[] = [
    { to: '/admin', icon: <WrenchIcon className="w-4 h-4" />, label: t('nav.admin'), match: p => p === '/admin', available: true, adminOnly: true },
    { to: '/docs', icon: <BookOpenIcon className="w-4 h-4" />, label: t('nav.docs'), match: p => p === '/docs', available: true },
    { to: '/settings', icon: <Cog6ToothIcon className="w-4 h-4" />, label: t('nav.settings'), match: p => p === '/settings', available: true },
  ];

  const filteredNav = nav.filter(n => !n.adminOnly || user?.isAdmin);
  const filteredBottomNav = bottomNav.filter(n => !n.adminOnly || user?.isAdmin);

  // Sidebar content (shared between mobile overlay and desktop)
  const sidebarContent = (isMobile = false) => (
    <div className="flex flex-col h-full">
      {/* Logo + close button row */}
      <div className="flex items-center justify-between px-3 py-3">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <BrandMark className="w-5 h-5" />
          <span className="font-bold text-sm">OpenTriologue</span>
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
        {filteredNav.map(n => <SidebarNavItem key={n.key ?? `${n.to}:${n.label}`} item={n} />)}
      </nav>

      {/* Rooms section */}
      <div className="flex-1 overflow-y-auto">
        <SidebarRoomList
          roomSearchQuery={roomSearchQuery}
          onSearchChange={setRoomSearchQuery}
          onOpenCreateRoom={() => setShowCreateRoom(true)}
          onRequestDeleteRoom={setConfirmDeleteRoom}
        />
      </div>

      {/* Bottom — User + Settings + Logout */}
      <div className={`px-2 pb-2 border-t ${isDark ? 'border-gray-800/60' : 'border-gray-200/60'} pt-2 space-y-1`}>
        <SidebarUserMenu
          open={userMenuOpen}
          onToggle={() => setUserMenuOpen((prev) => !prev)}
          onClose={() => setUserMenuOpen(false)}
          filteredBottomNav={filteredBottomNav}
          user={user}
          onLogout={logout}
        />
      </div>
    </div>
  );

  if (!user) return <>{children}</>;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Mobile top bar with hamburger */}
      <div className={`md:hidden flex items-center h-10 px-2 flex-shrink-0 border-b ${
        isDark ? 'bg-dark-base border-gray-800/60' : 'bg-white border-gray-200/60'
      }`}>
        <button
          onClick={() => setOpen(true)}
          className={`p-1.5 rounded-lg ${isDark ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <Bars3Icon className="w-5 h-5" />
        </button>
        <BrandMark className="w-4 h-4 ml-2" />
        <span className={`ml-1.5 text-sm font-medium truncate flex-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>OpenTriologue</span>
        <NotificationCenter mode="inline" />
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
        tabIndex={-1}
        className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200 md:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        } ${isDark ? 'bg-dark-base border-r border-gray-800/60' : 'bg-white border-r border-gray-200/60'}`}
      >
        {sidebarContent(true)}
      </div>

      {/* Desktop sidebar */}
      <div className={`hidden md:flex flex-col flex-shrink-0 w-48 ${
        isDark ? 'bg-dark-base border-r border-gray-800/60' : 'bg-white border-r border-gray-200/60'
      }`}>
        {sidebarContent()}
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

      {/* Delete Room Confirm Dialog */}
      <ConfirmDialog
        open={!!confirmDeleteRoom}
        title={t('nav.deleteRoom.title')}
        message={t('nav.deleteRoom.message').replace('{name}', confirmDeleteRoom?.name ?? '')}
        confirmLabel={t('nav.deleteConfirm')}
        cancelLabel={t('nav.deleteCancel')}
        variant="danger"
        loading={deleteLoading}
        onConfirm={() => confirmDeleteRoom && handleDeleteRoom(confirmDeleteRoom.id)}
        onCancel={() => setConfirmDeleteRoom(null)}
      />
    </div>
  );
};
