import React, { useEffect, useRef, useState } from 'react';
import { MessageRenderer } from './MessageRenderer';
import { ReactionSystem, aggregateReactions } from './ReactionSystem';
import { useAuthStore } from '../../stores/authStore';

interface MessageReaction {
  emoji: string;
  userId: string;
}

interface Message {
  id: string;
  content: string;
  sender: {
    username: string;
    displayName: string;
    userType: string;
  };
  createdAt: string;
  reactions?: MessageReaction[];
}

interface MessageListProps {
  messages: Message[];
  roomId: string;
  onReact?: (messageId: string, emoji: string) => void;
}

// Separate component so hooks are called at top level (not inside map)
const MessageItem: React.FC<{
  message: Message;
  onReact?: (messageId: string, emoji: string) => void;
}> = ({ message, onReact }) => {
  const { user } = useAuthStore();
  const aggregatedReactions = React.useMemo(
    () => message.reactions ? aggregateReactions(message.reactions, user?.id) : [],
    [message.reactions, user?.id]
  );

  return (
    <div className="flex items-start gap-3 group">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-sm flex-shrink-0">
        {message.sender.userType === 'AI_ICE'  && '🧊'}
        {message.sender.userType === 'AI_LAVA' && '🌋'}
        {message.sender.userType === 'HUMAN'   && '👨💻'}
        {!['AI_ICE','AI_LAVA','HUMAN'].includes(message.sender.userType) && '🤖'}
      </div>

      {/* Message content */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm text-white">
            {message.sender.displayName}
          </span>
          <span className="text-xs text-gray-400">
            {new Date(message.createdAt).toLocaleTimeString()}
          </span>
        </div>

        {/* Rich message content */}
        <div className="mb-1">
          <MessageRenderer
            content={message.content}
            messageId={message.id}
            canReact={!!onReact}
          />
        </div>

        {/* Reactions */}
        {onReact && (
          <ReactionSystem
            messageId={message.id}
            reactions={aggregatedReactions}
            onReact={onReact}
            currentUserId={user?.id}
            className="mt-1"
          />
        )}
      </div>
    </div>
  );
};

export const MessageList: React.FC<MessageListProps> = ({ messages, roomId, onReact }) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef   = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom]   = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const previousCountRef = useRef(messages.length);

  const checkIfAtBottom = () => {
    if (!containerRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    return scrollHeight - scrollTop - clientHeight < 100;
  };

  const handleScroll = () => {
    const atBottom = checkIfAtBottom();
    setIsAtBottom(atBottom);
    if (atBottom) setUnreadCount(0);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUnreadCount(0);
  };

  useEffect(() => {
    const newCount = messages.length;
    const prevCount = previousCountRef.current;
    if (newCount > prevCount) {
      if (isAtBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        setUnreadCount(0);
      } else {
        setUnreadCount(prev => prev + (newCount - prevCount));
      }
    }
    previousCountRef.current = newCount;
  }, [messages.length, isAtBottom]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-4">🧊🌋👨💻</div>
          <div className="text-xl font-semibold">Welcome to Triologue</div>
          <div className="text-sm">AI-to-AI-to-Human conversation starts here</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 p-4 space-y-4 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800"
      >
        {messages.map(message => (
          <MessageItem key={message.id} message={message} onReact={onReact} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Unread messages indicator */}
      {!isAtBottom && unreadCount > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 transform -translate-x-1/2
                     bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full
                     shadow-lg flex items-center gap-2 transition-all duration-200 animate-bounce"
        >
          <span>↓</span>
          <span className="font-medium">
            {unreadCount} neue {unreadCount === 1 ? 'Nachricht' : 'Nachrichten'}
          </span>
        </button>
      )}
    </div>
  );
};
