import React from 'react';
import { Link } from 'react-router-dom';
import { PlusIcon, LockClosedIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../../stores/authStore';
import { useTheme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { Input } from '../ui/primitives/Input';
import { useRoomList, PROTECTED_ROOMS } from '../../hooks/useRoomList';

interface SidebarRoomListProps {
  roomSearchQuery: string;
  onSearchChange: (value: string) => void;
  onOpenCreateRoom: () => void;
  onRequestDeleteRoom: (room: { id: string; name: string }) => void;
}

export const SidebarRoomList: React.FC<SidebarRoomListProps> = ({
  roomSearchQuery,
  onSearchChange,
  onOpenCreateRoom,
  onRequestDeleteRoom,
}) => {
  const { user } = useAuthStore();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isDark = theme === 'dark';

  const {
    rooms,
    filteredRooms,
    getRoomPreview,
    formatRoomActivityTime,
    currentRoomId,
    unreadCounts,
    markRoomAsRead,
  } = useRoomList(roomSearchQuery);

  if (rooms.length === 0) return null;

  return (
    <div className={`px-2 mt-1 pt-2 border-t ${isDark ? 'border-gray-800/60' : 'border-gray-200/60'}`}>
      {/* Section header */}
      <div className="flex items-center justify-between px-2 mb-1">
        <span className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {t('nav.rooms')}
        </span>
        <button
          onClick={onOpenCreateRoom}
          className={`p-1 rounded transition-colors duration-200 ${isDark ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
          title={t('chat.createRoom')}
        >
          <PlusIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="px-1 mb-2">
        <Input
          type="text"
          value={roomSearchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('nav.roomsSearchPlaceholder')}
          className="px-2.5 py-1.5 text-xs"
        />
      </div>

      {/* Room list */}
      <div className="space-y-0.5">
        {filteredRooms.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400">
            {t('nav.roomsNoResults')}
          </div>
        )}
        {filteredRooms.map(room => {
          const active = room.id === currentRoomId;
          const unread = unreadCounts[room.id] ?? 0;
          const roomRole = room.role;
          const isOwnerOrAdmin = roomRole === 'OWNER' || roomRole === 'ADMIN' || user?.isAdmin;
          const canDelete = isOwnerOrAdmin && !PROTECTED_ROOMS.includes(room.id);
          const preview = getRoomPreview(room);
          const activityTime = formatRoomActivityTime(room.lastMessage?.timestamp);
          return (
            <div key={room.id} className="group flex items-center">
              <Link
                to={`/room/${room.id}`}
                onClick={() => markRoomAsRead(room.id)}
                className={`flex items-start gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors duration-200 flex-1 min-w-0 ${
                  active
                    ? isDark ? 'bg-blue-950/30 border border-blue-700/40 text-blue-300' : 'bg-blue-50 border border-blue-200 text-blue-700'
                    : isDark ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <span className={`w-1.5 h-1.5 mt-1.5 rounded-full flex-shrink-0 ${active ? 'bg-blue-400' : unread > 0 ? 'bg-blue-500' : isDark ? 'bg-gray-600' : 'bg-gray-300'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className={`truncate flex-1 ${unread > 0 && !active ? 'font-semibold text-white' : ''}`}>{room.name}</span>
                    {room.isPrivate && <LockClosedIcon className="w-3 h-3 flex-shrink-0 opacity-60" />}
                    {activityTime && (
                      <span className={`text-[11px] flex-shrink-0 ${unread > 0 && !active ? 'text-blue-200' : isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {activityTime}
                      </span>
                    )}
                  </div>
                  {preview && (
                    <div className={`text-[11px] truncate ${unread > 0 && !active ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
                      {preview}
                    </div>
                  )}
                </div>
                {unread > 0 && !active && (
                  <span className="min-w-4 h-4 px-1 mt-0.5 bg-blue-500/80 text-white text-[10px] rounded-full flex items-center justify-center font-medium flex-shrink-0">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
              {canDelete && (
                <button
                  onClick={() => onRequestDeleteRoom({ id: room.id, name: room.name })}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-600 dark:text-gray-400 hover:text-red-400 transition-[color,opacity] flex-shrink-0"
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
