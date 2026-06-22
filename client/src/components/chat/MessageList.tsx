import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "../../stores/chatStore";
import { BrandMark } from "../ui/BrandMark";
import { useTheme } from "../../contexts/ThemeContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { Message } from "../../types/chat";
import { SystemMessageBanner } from "./SystemMessageBanner";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
  messages: Message[];
  roomId: string;
  onReact?: (messageId: string, emoji: string) => void;
  highlightedMessageId?: string | null;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  roomId,
  onReact,
  highlightedMessageId = null,
}) => {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuthStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const isAtBottomRef = useRef(true);
  const { hasMoreMessages, isLoadingMore, loadMoreMessages, currentRoom } = useChatStore();

  // Single relative-time tick — re-renders MessageList (and thus all MessageItems)
  // every 60 s so formatTime stays fresh. Placed before the early return so
  // rules-of-hooks hold regardless of message count.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Pin permission: room OWNER/ADMIN or global admin
  const canPin = !!(user && (
    ["OWNER", "ADMIN"].includes(currentRoom?.role || "") || user.isAdmin
  ));

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
          <BrandMark className="w-12 h-12 mx-auto mb-4" />
          <div className="text-sm">{t("chat.emptyRoom")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative overflow-hidden overflow-x-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full px-2 py-4 sm:px-4 overflow-y-auto [scrollbar-gutter:stable]"
      >
        {hasMoreMessages && (
          <div className="flex justify-center py-2">
            <button
              onClick={() => loadMoreMessages(roomId)}
              disabled={isLoadingMore}
              className={`px-4 py-1.5 text-xs rounded-full transition-colors duration-200 disabled:opacity-50 ${
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
          const isHighlighted = highlightedMessageId === message.id;
          return (
            <div
              id={`message-${message.id}`}
              key={message.id}
              className={`${isGrouped ? "mt-0.5" : "mt-4 first:mt-0"} rounded-md transition-colors duration-200 ${
                isHighlighted
                  ? theme === "dark"
                    ? "bg-yellow-500/15 ring-1 ring-yellow-500/40"
                    : "bg-yellow-100 ring-1 ring-yellow-300"
                  : ""
              }`}
            >
              {message.messageType === 'SYSTEM' ? (
                <SystemMessageBanner content={message.content} />
              ) : (
                <MessageItem
                  message={message}
                  onReact={onReact}
                  isGrouped={isGrouped}
                  canPin={canPin}
                />
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {showScrollButton && (
        <button
          onClick={() => scrollToBottom("smooth")}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-sm font-medium rounded-full shadow-elevated transition-colors duration-200 z-10"
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
