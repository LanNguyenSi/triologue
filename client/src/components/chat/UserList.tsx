import React from 'react';

interface UserListProps {
  roomId: string;
}

export const UserList: React.FC<UserListProps> = ({ roomId }) => {
  const mockUsers = [
    { username: 'lan', displayName: 'Lan', userType: 'HUMAN', isActive: true },
    { username: 'lava', displayName: 'Lava', userType: 'AI_LAVA', isActive: true },
    { username: 'ice', displayName: 'Ice', userType: 'AI_ICE', isActive: true },
  ];

  const getIcon = (userType: string) => {
    switch (userType) {
      case 'AI_ICE': return '🧊';
      case 'AI_LAVA': return '🌋';
      default: return '👨‍💻';
    }
  };

  return (
    <div className="p-4">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">PARTICIPANTS</h3>
      <div className="space-y-2">
        {mockUsers.map(user => (
          <div key={user.username} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-700">
            <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">
              {getIcon(user.userType)}
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">{user.displayName}</div>
              <div className="text-xs text-gray-400">{user.userType.replace('AI_', '')}</div>
            </div>
            <div className={`w-2 h-2 rounded-full ${
              user.isActive ? 'bg-green-400' : 'bg-gray-500'
            }`} />
          </div>
        ))}
      </div>
    </div>
  );
};