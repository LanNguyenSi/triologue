import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MessageRenderer } from './MessageRenderer';
import { ReactionSystem, aggregateReactions } from './ReactionSystem';
import { useAuthStore } from '../../stores/authStore';

/** Format timestamp: relative for <1h, absolute for older messages */
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // Older than 24h: show date + time
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

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
  // Tick every minute so relative timestamps stay fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const aggregatedReactions = React.useMemo(
    () => message.reactions
      ? aggregateReactions(message.reactions, user?.id)
      : [],
    [message.reactions, user?.id]
  );

  return (
    // B2 Fix: `group` on the outermost div so hover propagates to ReactionSystem button
    <div className="flex items-start gap-3 group">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-sm flex-shrink-0">
        {message.sender.userType === 'AI_ICE'  && '🧊'}
        {message.sender.userType === 'AI_LAVA' && '🌋'}
        {message.sender.userType === 'HUMAN'   && '👨‍💻'}
        {!['AI_ICE','AI_LAVA','HUMAN'].includes(message.sender.userType) && '🤖'}
      </div>

      {/* Message content */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm text-white">
            {message.sender.displayName}
          </span>
          <span
            className="text-xs text-gray-400 cursor-default"
            title={new Date(message.createdAt).toLocaleString()}
          >
            {formatTime(message.createdAt)}
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

        {/* Reactions — always render so hover-button is reachable */}
        <ReactionSystem
          messageId={message.id}
          reactions={aggregatedReactions}
          onReact={onReact ?? (() => {})}
          currentUserId={user?.id}
          className="mt-1"
        />
      </div>
    </div>
  );
};

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  roomId,
  onReact,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const isAtBottomRef = useRef(true);

  // Check if user is near the bottom (within 100px threshold)
  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior });
    setShowScrollButton(false);
    setUnreadCount(0);
    isAtBottomRef.current = true;
  }, []);

  // Track scroll position
  const handleScroll = useCallback(() => {
    const atBottom = checkIfAtBottom();
    isAtBottomRef.current = atBottom;
    if (atBottom) {
      setShowScrollButton(false);
      setUnreadCount(0);
    }
  }, [checkIfAtBottom]);

  // On new messages: auto-scroll only if already at bottom
  useEffect(() => {
    if (messages.length === 0) return;
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      setShowScrollButton(true);
      setUnreadCount(prev => prev + 1);
    }
  }, [messages.length]);

  // Initial scroll to bottom (instant, no animation)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
  }, [roomId]);

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
    <div className="flex-1 relative overflow-hidden">
      {/* Message list */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full p-4 space-y-4 overflow-y-auto [scrollbar-gutter:stable]"
      >
        {messages.map(message => (
          <MessageItem
            key={message.id}
            message={message}
            onReact={onReact}
          />
        ))}
        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* "Jump to latest" button — only shown when user has scrolled up */}
      {showScrollButton && (
        <button
          onClick={() => scrollToBottom('smooth')}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-full shadow-lg transition-all duration-200 z-10"
        >
          <span>↓</span>
          {unreadCount > 0 ? (
            <span>{unreadCount} neue Nachricht{unreadCount > 1 ? 'en' : ''}</span>
          ) : (
            <span>Zum Ende springen</span>
          )}
        </button>
      )}
    </div>
  );
};
