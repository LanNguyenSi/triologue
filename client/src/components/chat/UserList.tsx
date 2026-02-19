import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';

interface Participant {
  userId: string;
  username: string;
  displayName: string;
  userType: string;
  role: string;
  isOnline: boolean;
}

interface UserListProps {
  roomId: string;
}

const getIcon = (userType: string) => {
  switch (userType) {
    case 'AI_ICE':  return '🧊';
    case 'AI_LAVA': return '🌋';
    default:        return '👨💻';
  }
};

const getRoleBadge = (role: string) => {
  if (role === 'OWNER') return <span className="text-xs text-yellow-400 ml-1">👑</span>;
  if (role === 'ADMIN') return <span className="text-xs text-blue-400 ml-1">⚡</span>;
  return null;
};

export const UserList: React.FC<UserListProps> = ({ roomId }) => {
  const { user: currentUser } = useAuthStore();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [myRole, setMyRole] = useState<string>('MEMBER');
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [isInviting, setIsInviting] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/rooms/${roomId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const room = await res.json();
        const parts: Participant[] = room.participants ?? [];
        setParticipants(parts);
        // Find current user's role
        const me = parts.find(p => p.username === currentUser?.username);
        if (me) setMyRole(me.role);
      }
    } catch (e) {
      console.error('Failed to load participants:', e);
    }
  }, [roomId, currentUser?.username]);

  useEffect(() => { load(); }, [load]);

  const canInvite = ['OWNER', 'ADMIN', 'MODERATOR'].includes(myRole) || currentUser?.isAdmin;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteUsername.trim()) return;
    setIsInviting(true);
    setInviteError('');
    setInviteSuccess('');
    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/rooms/${roomId}/invite`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: inviteUsername.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setInviteSuccess(`${data.invitedUser} added!`);
        setInviteUsername('');
        setTimeout(() => setInviteSuccess(''), 3000);
        load(); // refresh participants
      } else {
        setInviteError(data.error ?? 'Failed to invite');
      }
    } catch {
      setInviteError('Network error');
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <div className="p-4 flex flex-col h-full">
      {/* Header */}
      <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wide">
        Participants ({participants.length})
      </h3>

      {/* Participant list */}
      <div className="space-y-2 flex-1 overflow-y-auto scrollbar-hide">
        {participants.map(p => (
          <div key={p.userId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-700">
            <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-sm">
              {getIcon(p.userType)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm flex items-center gap-1 truncate">
                {p.displayName}
                {getRoleBadge(p.role)}
              </div>
              <div className="text-xs text-gray-400">{p.userType.replace('AI_', '')}</div>
            </div>
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${p.isOnline ? 'bg-green-400' : 'bg-gray-600'}`} />
          </div>
        ))}
      </div>

      {/* Invite by username (owner/admin only) */}
      {canInvite && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Add participant</p>
          <form onSubmit={handleInvite} className="flex flex-col gap-2">
            <input
              type="text"
              value={inviteUsername}
              onChange={e => { setInviteUsername(e.target.value); setInviteError(''); }}
              placeholder="Username…"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={isInviting || !inviteUsername.trim()}
              className="w-full py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {isInviting ? 'Adding…' : '+ Add'}
            </button>
            {inviteError  && <p className="text-xs text-red-400">{inviteError}</p>}
            {inviteSuccess && <p className="text-xs text-green-400">{inviteSuccess}</p>}
          </form>
        </div>
      )}
    </div>
  );
};
