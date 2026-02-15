import React, { useState } from 'react';
import { useSocketStore } from '../../stores/socketStore';

interface MessageInputProps {
  roomId: string;
}

export const MessageInput: React.FC<MessageInputProps> = ({ roomId }) => {
  const [message, setMessage] = useState('');
  const { sendMessage } = useSocketStore();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      sendMessage(roomId, message.trim());
      setMessage('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type your message..."
          className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={!message.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Send
        </button>
      </div>
    </form>
  );
};