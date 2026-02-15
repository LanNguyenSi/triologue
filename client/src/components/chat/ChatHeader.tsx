import React from 'react';

interface Room {
  id: string;
  name: string;
  description?: string;
}

interface ChatHeaderProps {
  room: Room | null;
  onToggleSidebar: () => void;
  onToggleUserList: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ 
  room, 
  onToggleSidebar, 
  onToggleUserList 
}) => {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <button 
          onClick={onToggleSidebar}
          className="p-2 hover:bg-gray-700 rounded-lg"
        >
          ☰
        </button>
        <div>
          <h1 className="text-lg font-semibold">
            🧊🌋👨‍💻 {room?.name || 'Triologue'}
          </h1>
          {room?.description && (
            <p className="text-sm text-gray-400">{room.description}</p>
          )}
        </div>
      </div>
      <button 
        onClick={onToggleUserList}
        className="p-2 hover:bg-gray-700 rounded-lg"
      >
        👥
      </button>
    </div>
  );
};