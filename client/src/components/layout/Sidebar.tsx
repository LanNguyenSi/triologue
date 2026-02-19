import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { PlusIcon, LockClosedIcon, TrashIcon } from '@heroicons/react/24/outline';
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
  role: string;
  isOnline: boolean;
}

const getParticipantIcon = (userType: string) => {
  if (userType === 'AI_ICE')  return '🧊';
  if (userType === 'AI_LAVA') return '🌋';
  return '👨💻';
};

export const Sidebar: React.FC<SidebarProps> = ({ onToggle }) => {
  const { user, logout }             = useAuthStore();
  const location = useLocation();
  const { isConnected, joinRoom }    = useSocketStore();
  const { rooms, loadRooms, createRoom, deleteRoom, currentRoom } = useChatStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingRoom, setDeletingRoom] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [myRole, setMyRole] = useState<string>('MEMBER');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteStatus, setInviteStatus] = useState<{type:'ok'|'err', msg:string}|null>(null);
  const [isInviting, setIsInviting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();

  // Load rooms on mount
  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  // Load participants — called on room change + every 10s for reactivity
  const loadParticipants = useCallback(async (roomId: string) => {
    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/rooms/${roomId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const room = await res.json();
        const parts: Participant[] = room.participants ?? [];
        setParticipants(parts);
        const me = parts.find(p => p.username === user?.username);
        setMyRole(me?.role ?? 'MEMBER');
      }
    } catch { /* silent */ }
  }, [user?.username]);

  useEffect(() => {
    if (!currentRoom) return;
    loadParticipants(currentRoom.id);
    // Poll every 10s for reactivity (no socket event for joins yet)
    pollRef.current = setInterval(() => loadParticipants(currentRoom.id), 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [currentRoom?.id, loadParticipants]);

  const canInvite = ['OWNER', 'ADMIN', 'MODERATOR'].includes(myRole) || user?.isAdmin;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteUsername.trim() || !currentRoom) return;
    setIsInviting(true);
    setInviteStatus(null);
    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/rooms/${currentRoom.id}/invite`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: inviteUsername.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteStatus({ type: 'ok', msg: `${data.invitedUser} hinzugefügt!` });
        setInviteUsername('');
        loadParticipants(currentRoom.id); // immediate refresh
        setTimeout(() => { setInviteStatus(null); setShowInvite(false); }, 2500);
      } else {
        setInviteStatus({ type: 'err', msg: data.error ?? 'Fehler' });
      }
    } catch {
      setInviteStatus({ type: 'err', msg: 'Netzwerkfehler' });
    } finally {
      setIsInviting(false);
    }
  };

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
              rooms.map(room => {
                const PROTECTED = ['main-triologue', 'onboarding'];
                const canDelete = !PROTECTED.includes(room.id);
                return (
                  <div
                    key={room.id}
                    className={`flex items-center gap-1 rounded-lg transition-colors group ${
                      currentRoom?.id === room.id
                        ? 'bg-blue-900/40 border border-blue-700/50'
                        : 'hover:bg-gray-700/50'
                    }`}
                  >
                    <Link
                      to={`/room/${room.id}`}
                      className="flex items-center gap-3 p-3 flex-1 min-w-0"
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
                    {/* Delete button — hover only, not for protected rooms */}
                    {canDelete && (
                      <button
                        onClick={async (e) => {
                          e.preventDefault();
                          if (!window.confirm(`Raum "${room.name}" wirklich löschen?`)) return;
                          setDeletingRoom(room.id);
                          const ok = await deleteRoom(room.id);
                          setDeletingRoom(null);
                          if (ok && currentRoom?.id === room.id) navigate('/');
                        }}
                        disabled={deletingRoom === room.id}
                        className="opacity-0 group-hover:opacity-100 mr-2 p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-all flex-shrink-0 disabled:opacity-30"
                        title={`Raum löschen`}
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Participants Section */}
        <div className="p-4 border-t border-gray-700">
          {/* Header with + button for owners */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Participants ({participants.length})
            </h2>
            {canInvite && (
              <button
                onClick={() => { setShowInvite(v => !v); setInviteStatus(null); setInviteUsername(''); }}
                className="w-5 h-5 flex items-center justify-center rounded bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-colors text-sm leading-none"
                title="Teilnehmer hinzufügen"
              >
                {showInvite ? '✕' : '+'}
              </button>
            )}
          </div>

          {/* Inline invite form */}
          {showInvite && canInvite && (
            <form onSubmit={handleInvite} className="mb-3 flex flex-col gap-1.5">
              <input
                autoFocus
                type="text"
                value={inviteUsername}
                onChange={e => { setInviteUsername(e.target.value); setInviteStatus(null); }}
                placeholder="Username eingeben…"
                className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-xs text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={isInviting || !inviteUsername.trim()}
                className="w-full py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 rounded text-xs font-medium transition-colors"
              >
                {isInviting ? 'Lädt…' : '+ Hinzufügen'}
              </button>
              {inviteStatus && (
                <p className={`text-xs ${inviteStatus.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                  {inviteStatus.msg}
                </p>
              )}
            </form>
          )}

          {/* Participant list */}
          <div className="space-y-1 max-h-44 overflow-y-auto scrollbar-hide">
            {participants.map(p => (
              <div key={p.userId} className="flex items-center gap-2 p-1.5 rounded-lg">
                <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center text-xs flex-shrink-0">
                  {getParticipantIcon(p.userType)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-xs truncate flex items-center gap-1">
                    {p.displayName}
                    {p.role === 'OWNER' && <span className="text-yellow-400">👑</span>}
                  </div>
                  <div className="text-xs text-gray-500">{p.userType.replace('AI_', '')}</div>
                </div>
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.isOnline ? 'bg-green-400' : 'bg-gray-600'}`} />
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
        {(user as any)?.isAdmin && (
          <Link
            to="/admin"
            className={`block w-full px-3 py-2 mb-2 rounded-lg text-sm font-medium text-center transition-colors ${
              location.pathname === '/admin'
                ? 'bg-yellow-700 text-white'
                : 'bg-yellow-900/40 text-yellow-300 hover:bg-yellow-800/60'
            }`}
          >
            🔧 Admin Panel
          </Link>
        )}
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
