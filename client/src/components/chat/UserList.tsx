import React, { useEffect, useState } from 'react';

interface Participant {
  userId: string;
  username: string;
  displayName: string;
  userType: string;
  role: string;
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

export const UserList: React.FC<UserListProps> = ({ roomId }) => {
  const [participants, setParticipants] = useState<Participant[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const token = localStorage.getItem('triologue_token');
        const res = await fetch(`/api/rooms/${roomId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const room = await res.json();
          setParticipants(room.participants ?? []);
        }
      } catch (e) {
        console.error('Failed to load participants:', e);
      }
    };
    load();
  }, [roomId]);

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">
        PARTICIPANTS ({participants.length})
      </h3>
      <div className="space-y-2">
        {participants.map(user => (
          <div key={user.userId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-700">
            <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">
              {getIcon(user.userType)}
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">{user.displayName}</div>
              <div className="text-xs text-gray-400">{user.userType.replace('AI_', '')}</div>
            </div>
            <div className="w-2 h-2 rounded-full bg-green-400" />
          </div>
        ))}
      </div>
    </div>
  );
};
