import React from 'react';

interface TypingUser {
  username: string;
  userType: string;
}

interface TypingIndicatorProps {
  users: TypingUser[];
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ users }) => {
  if (users.length === 0) return null;

  const getIcon = (userType: string) => {
    switch (userType) {
      case 'AI_ICE': return '🧊';
      case 'AI_LAVA': return '🌋';
      default: return '👨‍💻';
    }
  };

  return (
    <div className="text-sm text-gray-400 italic">
      {users.map(user => (
        <span key={user.username} className="mr-2">
          {getIcon(user.userType)} {user.username} is typing...
        </span>
      ))}
    </div>
  );
};