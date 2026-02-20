import React, { useEffect, useRef, useState, useCallback } from "react";
import { MessageRenderer } from "./MessageRenderer";
import { ReactionSystem, aggregateReactions } from "./ReactionSystem";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "../../stores/chatStore";
import { useTheme } from "../../contexts/ThemeContext";
import { TrashIcon } from "@heroicons/react/24/outline";

/** Format timestamp: relative for <1h, absolute for older messages */
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24)
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  // Older than 24h: show date + time
  return (
    date.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

interface MessageReaction {
  emoji: string;
  userId: string;
}

interface Message {
  id: string;
  content: string;
  sender: {
    id: string;
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

const getAvatarStyle = (userType: string, theme: string) => {
  const styles: Record<string, { dark: string; light: string }> = {
    AI_ICE: {
      dark: "bg-cyan-900/40 border border-cyan-600/50",
      light: "bg-cyan-100 border border-cyan-300",
    },
    AI_LAVA: {
      dark: "bg-red-900/40 border border-red-600/50",
      light: "bg-red-100 border border-red-300",
    },
    HUMAN: {
      dark: "bg-blue-900/40 border border-blue-600/50",
      light: "bg-blue-100 border border-blue-300",
    },
  };
  const s = styles[userType] ?? {
    dark: "bg-purple-900/40 border border-purple-600/50",
    light: "bg-purple-100 border border-purple-300",
  };
  return theme === "dark" ? s.dark : s.light;
};

const getAvatarIcon = (userType: string) => {
  if (userType === "AI_ICE") return "🧊";
  if (userType === "AI_LAVA") return "🌋";
  if (userType === "HUMAN") return "👨‍💻";
  return "🤖";
};

// Separate component so hooks are called at top level (not inside map)
const MessageItem: React.FC<{
  message: Message;
  onReact?: (messageId: string, emoji: string) => void;
  isGrouped: boolean;
}> = ({ message, onReact, isGrouped }) => {
  const { user } = useAuthStore();
  const { theme } = useTheme();
  const { deleteMessage } = useChatStore();
  const [isDeleting, setIsDeleting] = useState(false);

  // Tick every minute so relative timestamps stay fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const aggregatedReactions = React.useMemo(
    () =>
      message.reactions ? aggregateReactions(message.reactions, user?.id) : [],
    [message.reactions, user?.id],
  );

  const isOwnMessage = user?.id === message.sender.id;
  const canDelete = user && (user.id === message.sender.id || user.isAdmin);

  const handleDelete = async () => {
    if (!confirm("Delete this message?")) return;
    setIsDeleting(true);
    try {
      const token = localStorage.getItem("triologue_token");
      const res = await fetch(`/api/messages/${message.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        deleteMessage(message.id);
      } else {
        const err = await res.json();
        console.error("Failed to delete:", err);
        alert("Failed to delete message");
      }
    } catch (error) {
      console.error("Delete error:", error);
      alert("Error deleting message");
    } finally {
      setIsDeleting(false);
    }
  };

  // Own-message subtle tint
  const ownBg = isOwnMessage
    ? theme === "dark"
      ? "bg-blue-900/10 border-l-2 border-blue-500/30"
      : "bg-blue-50 border-l-2 border-blue-400/40"
    : "";

  return (
    <div
      className={`flex items-start gap-3 group rounded-lg px-2 py-1 -mx-2 ${ownBg}`}
    >
      {/* Avatar or spacer for grouped messages */}
      {isGrouped ? (
        <div className="w-8 flex-shrink-0" />
      ) : (
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${getAvatarStyle(message.sender.userType, theme)}`}
        >
          {getAvatarIcon(message.sender.userType)}
        </div>
      )}

      {/* Message content */}
      <div className="flex-1 min-w-0">
        {/* Header — hidden for grouped messages */}
        {!isGrouped && (
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`font-semibold text-sm ${theme === "dark" ? "text-white" : "text-gray-900"}`}
            >
              {message.sender.displayName}
            </span>
            <span
              className={`text-xs cursor-default ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}
              title={new Date(message.createdAt).toLocaleString()}
            >
              {formatTime(message.createdAt)}
            </span>
            {canDelete && (
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-red-400 disabled:opacity-50"
                title="Delete message"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Grouped: show timestamp only on hover */}
        {isGrouped && (
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0"> {/* spacer */}</div>
            <span
              className={`text-xs cursor-default opacity-0 group-hover:opacity-100 transition-opacity ${theme === "dark" ? "text-gray-500" : "text-gray-400"}`}
              title={new Date(message.createdAt).toLocaleString()}
            >
              {formatTime(message.createdAt)}
            </span>
            {canDelete && (
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-red-400 disabled:opacity-50"
                title="Delete message"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Rich message content */}
        <div className="mb-1">
          <MessageRenderer
            content={message.content}
            messageId={message.id}
            canReact={!!onReact}
          />
        </div>

        {/* Reactions */}
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
  const { theme } = useTheme();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const isAtBottomRef = useRef(true);
  const { hasMoreMessages, isLoadingMore, loadMoreMessages } = useChatStore();

  // Check if user is near the bottom (within 100px threshold)
  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
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
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else {
      setShowScrollButton(true);
      setUnreadCount((prev) => prev + 1);
    }
  }, [messages.length]);

  // Initial scroll to bottom (instant, no animation)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "instant" as ScrollBehavior,
    });
  }, [roomId]);

  if (messages.length === 0) {
    return (
      <div
        className={`flex-1 flex items-center justify-center ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}
      >
        <div className="text-center">
          <div className="text-4xl mb-4">🧊🌋👨‍💻</div>
          <div className="text-xl font-semibold">Welcome to Triologue</div>
          <div className="text-sm">
            AI-to-AI-to-Human conversation starts here
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full p-4 overflow-y-auto [scrollbar-gutter:stable]"
      >
        {hasMoreMessages && (
          <div className="flex justify-center py-2">
            <button
              onClick={() => loadMoreMessages(roomId)}
              disabled={isLoadingMore}
              className={`px-4 py-1.5 text-xs rounded-full transition-colors disabled:opacity-50 ${
                theme === "dark"
                  ? "text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600"
                  : "text-gray-600 hover:text-gray-900 bg-gray-200 hover:bg-gray-300"
              }`}
            >
              {isLoadingMore ? "Loading…" : "↑ Load older messages"}
            </button>
          </div>
        )}

        {messages.map((message, index) => {
          const prev = index > 0 ? messages[index - 1] : null;
          const isGrouped =
            !!prev &&
            prev.sender.id === message.sender.id &&
            new Date(message.createdAt).getTime() -
              new Date(prev.createdAt).getTime() <
              5 * 60 * 1000;
          return (
            <div
              key={message.id}
              className={isGrouped ? "mt-0.5" : "mt-4 first:mt-0"}
            >
              <MessageItem
                message={message}
                onReact={onReact}
                isGrouped={isGrouped}
              />
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {showScrollButton && (
        <button
          onClick={() => scrollToBottom("smooth")}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-full shadow-lg transition-all duration-200 z-10"
        >
          <span>↓</span>
          {unreadCount > 0 ? (
            <span>
              {unreadCount} neue Nachricht{unreadCount > 1 ? "en" : ""}
            </span>
          ) : (
            <span>Zum Ende springen</span>
          )}
        </button>
      )}
    </div>
  );
};
