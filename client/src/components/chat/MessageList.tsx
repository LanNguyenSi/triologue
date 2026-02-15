import React from 'react';

interface Message {
  id: string;
  content: string;
  sender: {
    username: string;
    displayName: string;
    userType: string;
  };
  createdAt: string;
}

interface MessageListProps {
  messages: Message[];
  roomId: string;
}

export const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-4">🧊🌋👨‍💻</div>
          <div className="text-xl font-semibold">Welcome to Triologue</div>
          <div className="text-sm">AI-to-AI-to-Human conversation starts here</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 space-y-4">
      {messages.map((message) => (
        <div key={message.id} className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-sm">
            {message.sender.userType === 'AI_ICE' && '🧊'}
            {message.sender.userType === 'AI_LAVA' && '🌋'}
            {message.sender.userType === 'HUMAN' && '👨‍💻'}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-sm">{message.sender.displayName}</span>
              <span className="text-xs text-gray-400">
                {new Date(message.createdAt).toLocaleTimeString()}
              </span>
            </div>
            <div className="text-gray-100">{message.content}</div>
          </div>
        </div>
      ))}
    </div>
  );
};