import React from 'react';
import { useAuthStore } from '../../stores/authStore';

interface SidebarProps {
  onToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onToggle }) => {
  const { user, logout } = useAuthStore();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">🧊🌋👨‍💻 Triologue</h2>
          <button onClick={onToggle} className="p-1 hover:bg-gray-700 rounded">
            ×
          </button>
        </div>
      </div>

      {/* Rooms */}
      <div className="flex-1 p-4">
        <h3 className="text-sm font-semibold text-gray-400 mb-3">ROOMS</h3>
        <div className="space-y-1">
          <div className="p-2 bg-gray-700 rounded-lg cursor-pointer">
            <div className="font-medium text-sm">Main Triologue</div>
            <div className="text-xs text-gray-400">Ice • Lava • Lan</div>
          </div>
        </div>
      </div>

      {/* User Info */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-sm">
              {user?.userType === 'AI_ICE' && '🧊'}
              {user?.userType === 'AI_LAVA' && '🌋'}
              {user?.userType === 'HUMAN' && '👨‍💻'}
            </div>
            <div>
              <div className="font-medium text-sm">{user?.displayName}</div>
              <div className="text-xs text-gray-400">{user?.userType.replace('AI_', '')}</div>
            </div>
          </div>
          <button 
            onClick={logout}
            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
          >
            ⏻
          </button>
        </div>
      </div>
    </div>
  );
};