import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useChatStore } from '../../stores/chatStore';
import { useSocketStore } from '../../stores/socketStore';
import { useAuthStore } from '../../stores/authStore';
import { Sidebar } from './Sidebar';
import { ChatHeader } from '../chat/ChatHeader';
import { MessageList } from '../chat/MessageList';
import { MessageInput } from '../chat/MessageInput';
import { TypingIndicator } from '../chat/TypingIndicator';
import { UserList } from '../chat/UserList';

export const ChatLayout: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userListOpen, setUserListOpen] = useState(false);
  
  const { 
    currentRoom, 
    messages, 
    loadRoom, 
    loadMessages 
  } = useChatStore();
  
  const { 
    socket, 
    isConnected, 
    typingUsers,
    connect,
    addReaction,
  } = useSocketStore();

  // Initialize socket connection
  useEffect(() => {
    if (!socket) {
      connect();
    }
  }, [socket, connect]);

  // Default to main triologue room if no roomId
  const effectiveRoomId = roomId || 'main-triologue';

  // Load room and messages when roomId changes
  useEffect(() => {
    if (effectiveRoomId && isConnected) {
      loadRoom(effectiveRoomId);
      loadMessages(effectiveRoomId);
    }
  }, [effectiveRoomId, isConnected, loadRoom, loadMessages]);

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      {/* Sidebar */}
      <div className={`${
        sidebarOpen ? 'w-64' : 'w-0'
      } transition-all duration-300 ease-in-out overflow-hidden bg-gray-800 border-r border-gray-700`}>
        <Sidebar onToggle={() => setSidebarOpen(!sidebarOpen)} />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <div className="bg-gray-800 border-b border-gray-700 px-4 py-3">
          <ChatHeader 
            room={currentRoom}
            onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            onToggleUserList={() => setUserListOpen(!userListOpen)}
          />
        </div>

        {/* Messages Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Message List */}
          <div className="flex-1 flex flex-col">
            <div className="flex-1 overflow-y-auto">
              <MessageList 
                messages={messages}
                roomId={effectiveRoomId}
                onReact={addReaction}
              />
            </div>
            
            {/* Typing Indicator */}
            {typingUsers.length > 0 && (
              <div className="px-4 py-2 border-t border-gray-700">
                <TypingIndicator users={typingUsers} />
              </div>
            )}
            
            {/* Message Input */}
            <div className="border-t border-gray-700">
              <MessageInput roomId={effectiveRoomId} />
            </div>
          </div>

          {/* User List (collapsible) */}
          {userListOpen && (
            <div className="w-64 bg-gray-800 border-l border-gray-700">
              <UserList roomId={effectiveRoomId} />
            </div>
          )}
        </div>
      </div>

      {/* Connection Status */}
      {!isConnected && (
        <div className="fixed top-4 right-4 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-red-300 rounded-full animate-pulse"></div>
            Reconnecting...
          </div>
        </div>
      )}
    </div>
  );
};

// AI User Status Indicators
export const AIStatusIndicator: React.FC<{ 
  userType: 'AI_ICE' | 'AI_LAVA',
  isOnline: boolean 
}> = ({ userType, isOnline }) => {
  const icons = {
    AI_ICE: '🧊',
    AI_LAVA: '🌋'
  };

  const names = {
    AI_ICE: 'Ice',
    AI_LAVA: 'Lava'
  };

  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded ${
      isOnline ? 'bg-green-900 text-green-100' : 'bg-gray-600 text-gray-300'
    }`}>
      <span>{icons[userType]}</span>
      <span className="text-sm font-medium">{names[userType]}</span>
      <div className={`w-2 h-2 rounded-full ${
        isOnline ? 'bg-green-400' : 'bg-gray-400'
      }`} />
    </div>
  );
};