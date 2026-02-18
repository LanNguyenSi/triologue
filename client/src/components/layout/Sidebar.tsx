import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PlusIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../../stores/authStore';
import { useSocketStore } from '../../stores/socketStore';
import { useChatStore } from '../../stores/chatStore';
import { CreateRoomModal } from '../chat/CreateRoomModal';

interface SidebarProps {
  onToggle?: () => void;
}

const ROOM_TYPE_ICONS: Record<string, string> = {
  TRIOLOGUE: '🧊🌋',
  HUMAN_AI:  '🤝',
  AI_ONLY:   '🤖',
  PUBLIC:    '🌐',
  PRIVATE:   '🔒',
};

interface Participant {
  userId: string;
  username: string;
  displayName: string;
  userType: string;
}

const getParticipantIcon = (userType: string) => {
  if (userType === 'AI_ICE')  return '🧊';
  if (userType === 'AI_LAVA') return '🌋';
  return '👨💻';
};

export const Sidebar: React.FC<SidebarProps> = ({ onToggle }) => {
  const { user, logout }             = useAuthStore();
  const { isConnected, joinRoom }    = useSocketStore();
  const { rooms, loadRooms, createRoom, currentRoom } = useChatStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const navigate = useNavigate();

  // Load rooms on mount
  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  // Load participants when current room changes
  useEffect(() => {
    if (!currentRoom) return;
    const load = async () => {
      try {
        const token = localStorage.getItem('triologue_token');
        const res = await fetch(`/api/rooms/${currentRoom.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const room = await res.json();
          setParticipants(room.participants ?? []);
        }
      } catch (e) { /* silent */ }
    };
    load();
  }, [currentRoom?.id]);

  const handleCreateRoom = async (
    name: string,
    description: string,
    roomType: string,
    isPrivate: boolean,
  ) => {
    const room = await createRoom(name, description, roomType, isPrivate);
    if (room) {
      // Join via socket & navigate
      joinRoom(room.id);
      navigate(`/room/${room.id}`);
    } else {
      throw new Error('Failed to create room');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl">🧊🌋👨‍💻</span>
          <h1 className="text-xl font-bold">Triologue</h1>
        </div>

        {/* Connection Status */}
        <div className={`px-3 py-2 rounded-lg ${
          isConnected
            ? 'bg-green-900/30 border border-green-700'
            : 'bg-red-900/30 border border-red-700'
        }`}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'
            }`} />
            <span className={`text-sm font-semibold ${
              isConnected ? 'text-green-200' : 'text-red-200'
            }`}>
              {isConnected ? 'AI-to-AI-to-Human Chat' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      {/* Rooms */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          {/* Rooms header with + button */}
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Rooms
            </h2>
            <button
              onClick={() => setShowCreateModal(true)}
              className="p-1 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
              title="Create new room"
            >
              <PlusIcon className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1">
            {rooms.length === 0 ? (
              /* Fallback: always show main room */
              <Link
                to="/room/main-triologue"
                className="flex items-center gap-3 p-3 rounded-lg bg-blue-900/30 border border-blue-700 hover:bg-blue-900/50 transition-colors"
              >
                <span className="text-lg">🧊🌋</span>
                <div className="flex-1">
                  <div className="font-medium text-sm">Main Triologue</div>
                  <div className="text-xs text-gray-400">Ice • Lava • Lan</div>
                </div>
              </Link>
            ) : (
              rooms.map(room => (
                <Link
                  key={room.id}
                  to={`/room/${room.id}`}
                  className={`flex items-center gap-3 p-3 rounded-lg transition-colors group ${
                    currentRoom?.id === room.id
                      ? 'bg-blue-900/40 border border-blue-700/50'
                      : 'hover:bg-gray-700/50'
                  }`}
                >
                  <span className="text-lg flex-shrink-0">
                    {ROOM_TYPE_ICONS[room.roomType] ?? '💬'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-sm truncate">{room.name}</span>
                      {room.isPrivate && (
                        <LockClosedIcon className="w-3 h-3 text-gray-500 flex-shrink-0" />
                      )}
                    </div>
                    {room.description && (
                      <div className="text-xs text-gray-400 truncate">{room.description}</div>
                    )}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Participants Section */}
        <div className="p-4 border-t border-gray-700">
          <h2 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">
            Participants ({participants.length})
          </h2>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {participants.map(p => (
              <div key={p.userId} className="flex items-center gap-3 p-2 rounded-lg">
                <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-sm">
                  {getParticipantIcon(p.userType)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{p.displayName}</div>
                  <div className="text-xs text-gray-400">{p.userType.replace('AI_', '')}</div>
                </div>
                <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* User Info & Logout */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold">
            {user?.username?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm">{user?.username}</div>
            <div className="text-xs text-gray-400">{user?.userType ?? 'Logged in'}</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors"
        >
          Logout
        </button>
      </div>

      {/* Create Room Modal */}
      {showCreateModal && (
        <CreateRoomModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateRoom}
        />
      )}
    </div>
  );
};
