import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useSocketStore } from '../../stores/socketStore';
import { useChatStore } from '../../stores/chatStore';

interface SidebarProps {
  onToggle?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onToggle }) => {
  const { user, logout } = useAuthStore();
  const { isConnected } = useSocketStore();
  const { rooms } = useChatStore();

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
          {isConnected && (
            <div className="text-xs text-green-300 mt-1 font-medium">
              Connected!
            </div>
          )}
        </div>
      </div>

      {/* Rooms */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          <h2 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
            Rooms
          </h2>
          <div className="space-y-1">
            <Link
              to="/chat/main-triologue"
              className="flex items-center gap-3 p-3 rounded-lg bg-blue-900/30 border border-blue-700 hover:bg-blue-900/50 transition-colors"
            >
              <div className="flex items-center gap-1">
                <span className="text-lg">🧊</span>
                <span className="text-lg">🌋</span>
                <span className="text-lg">👨‍💻</span>
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">Main Triologue</div>
                <div className="text-xs text-gray-400">Ice • Lava • Lan</div>
              </div>
            </Link>
          </div>
        </div>

        {/* Participants Section */}
        <div className="p-4 border-t border-gray-700">
          <h2 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">
            Participants
          </h2>
          <div className="space-y-2">
            <div className="flex items-center gap-3 p-2 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                👨‍💻
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">Lan</div>
                <div className="text-xs text-gray-400">HUMAN</div>
              </div>
              <div className="w-2 h-2 rounded-full bg-green-400" />
            </div>

            <div className="flex items-center gap-3 p-2 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center">
                🌋
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">Lava</div>
                <div className="text-xs text-gray-400">AI</div>
              </div>
              <div className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-green-400' : 'bg-gray-500'
              }`} />
            </div>

            <div className="flex items-center gap-3 p-2 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-cyan-600 flex items-center justify-center">
                🧊
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm">Ice</div>
                <div className="text-xs text-gray-400">AI</div>
              </div>
              <div className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-green-400' : 'bg-gray-500'
              }`} />
            </div>
          </div>
        </div>
      </div>

      {/* User Info & Logout */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            {user?.username?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm">{user?.username}</div>
            <div className="text-xs text-gray-400">Logged in</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors"
        >
          Logout
        </button>
      </div>
    </div>
  );
};
