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

export const MessageList: React.FC<MessageListProps> = ({ 
  messages, 
  roomId, 
  onReact 
}) => {
  const { user } = useAuthStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const previousMessageCountRef = useRef(messages.length);

  // Check if user is scrolled to bottom
  const checkIfAtBottom = () => {
    if (!containerRef.current) return true;
    
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const threshold = 100; // pixels from bottom
    return scrollHeight - scrollTop - clientHeight < threshold;
  };

  // Handle scroll events
  const handleScroll = () => {
    const atBottom = checkIfAtBottom();
    setIsAtBottom(atBottom);
    
    if (atBottom) {
      setUnreadCount(0);
    }
  };

  // Auto-scroll to bottom on new messages (only if already at bottom)
  useEffect(() => {
    const newMessageCount = messages.length;
    const previousCount = previousMessageCountRef.current;
    
    if (newMessageCount > previousCount) {
      if (isAtBottom) {
        // User was at bottom, scroll to new message
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        setUnreadCount(0);
      } else {
        // User is scrolled up, increment unread count
        setUnreadCount(prev => prev + (newMessageCount - previousCount));
      }
    }
    
    previousMessageCountRef.current = newMessageCount;
  }, [messages.length, isAtBottom]);

  // Initial scroll to bottom on mount
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setUnreadCount(0);
  };

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

  const handleReaction = (messageId: string, emoji: string) => {
    if (onReact) {
      onReact(messageId, emoji);
    }
  };

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      {/* Messages Container */}
      <div 
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 p-4 space-y-4 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800"
        style={{ 
          overflowY: 'auto',
          maxHeight: '100%',
          WebkitOverflowScrolling: 'touch'
        }}
      >
        {messages.map((message) => {
          // Don't use useMemo inside map - it's a hook violation
          const aggregatedReactions = message.reactions 
            ? aggregateReactions(message.reactions, user?.id)
            : [];

          return (
            <div key={message.id} className="flex items-start gap-3 group">
              {/* Avatar */}
              <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-sm flex-shrink-0">
                {message.sender.userType === 'AI_ICE' && '🧊'}
                {message.sender.userType === 'AI_LAVA' && '🌋'}
                {message.sender.userType === 'HUMAN' && '👨‍💻'}
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
                <div className="mb-2">
                  <MessageRenderer 
                    content={message.content}
                    messageId={message.id}
                    canReact={true}
                  />
                </div>
                
                {/* Reactions */}
                {(aggregatedReactions.length > 0 || onReact) && (
                  <ReactionSystem
                    messageId={message.id}
                    reactions={aggregatedReactions}
                    onReact={handleReaction}
                    currentUserId={user?.id}
                    className="mt-1"
                  />
                )}
              </div>
            </div>
          );
        })}
        
        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* "Neue Nachrichten" Button */}
      {!isAtBottom && unreadCount > 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 transform -translate-x-1/2 
                     bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full 
                     shadow-lg flex items-center gap-2 transition-all duration-200
                     animate-bounce"
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
