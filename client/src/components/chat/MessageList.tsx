import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "../../stores/chatStore";
import { BrandMark } from "../ui/BrandMark";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { Button } from "../ui/primitives/Button";
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
  onReplyInThread?: (message: Message) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  roomId,
  onReact,
  highlightedMessageId = null,
  onReplyInThread,
}) => {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const { user } = useAuthStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  // Roving tabindex: the row the user last focused (null until then).
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  // Whether focus is inside the feed (or in a dialog opened from a row), and
  // the row ids of the previous render: when the focused row is removed the
  // browser drops focus to the body without a focusout, and the neighbouring
  // row takes it over.
  const focusInFeedRef = useRef(false);
  const previousRowIdsRef = useRef<string[]>([]);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const isAtBottomRef = useRef(true);
  const {
    hasMoreMessages,
    isLoadingMore,
    loadMoreMessages,
    currentRoom,
    isLoading,
    messagesError,
    loadMessages,
  } = useChatStore();

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

  // Feed rows are the user messages (system banners are not articles). Exactly
  // one of them is the tab stop: the last one focused, else the newest.
  const feedRowIds = useMemo(
    () => messages.filter((m) => m.messageType !== "SYSTEM").map((m) => m.id),
    [messages],
  );
  const feedPosition = useMemo(
    () => new Map(feedRowIds.map((id, i) => [id, i + 1])),
    [feedRowIds],
  );
  const activeRowId =
    focusedRowId !== null && feedRowIds.includes(focusedRowId)
      ? focusedRowId
      : (feedRowIds[feedRowIds.length - 1] ?? null);

  useEffect(() => {
    const previous = previousRowIdsRef.current;
    previousRowIdsRef.current = feedRowIds;
    if (!focusInFeedRef.current || focusedRowId === null) return;
    if (feedRowIds.includes(focusedRowId)) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const at = previous.indexOf(focusedRowId);
    if (at === -1) return;
    const neighbourId =
      previous.slice(at + 1).find((id) => feedRowIds.includes(id)) ??
      previous
        .slice(0, at)
        .reverse()
        .find((id) => feedRowIds.includes(id));
    if (!neighbourId) return;
    Array.from(
      feedRef.current?.querySelectorAll<HTMLElement>("[data-message-row]") ?? [],
    )
      .find((row) => row.dataset.messageRow === neighbourId)
      ?.focus();
  }, [feedRowIds, focusedRowId]);

  const handleFeedFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    focusInFeedRef.current = true;
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-message-row]");
    if (row?.dataset.messageRow) setFocusedRowId(row.dataset.messageRow);
  };

  // Any focus move out of the focused element clears the flag; the focus that
  // follows inside the feed (or in a dialog opened from a row, whose React
  // events reach this handler through the portal) sets it again.
  const handleFeedBlur = () => {
    focusInFeedRef.current = false;
  };

  // Arrow keys, PageUp, PageDown, Home and End move between rows while a row itself has focus;
  // Tab is never intercepted, and keys pressed inside a row's buttons keep
  // their meaning.
  const handleFeedKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.hasAttribute("data-message-row")) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const rows = Array.from(
      feedRef.current?.querySelectorAll<HTMLElement>("[data-message-row]") ?? [],
    );
    const index = rows.indexOf(target);
    let next: HTMLElement | undefined;
    switch (event.key) {
      case "ArrowDown":
      case "PageDown":
        next = rows[index + 1] ?? target;
        break;
      case "ArrowUp":
      case "PageUp":
        next = rows[index - 1] ?? target;
        break;
      case "Home":
        next = rows[0];
        break;
      case "End":
        next = rows[rows.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    next.focus();
  };

  if (messages.length === 0) {
    const containerClass = `flex-1 flex items-center justify-center ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`;

    // Load failed: show the error and a retry control instead of the empty art,
    // so a transient/socket failure never looks like a genuinely empty room.
    if (messagesError) {
      return (
        <div className={containerClass}>
          <div className="text-center">
            <BrandMark className="w-12 h-12 mx-auto mb-4" />
            <div className="text-sm">{t("chat.loadError")}</div>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => loadMessages(roomId)}
            >
              {t("chat.retry")}
            </Button>
          </div>
        </div>
      );
    }

    // Still loading / connecting: show a spinner, not the empty-room art.
    if (isLoading) {
      return (
        <div className={containerClass}>
          <div className="text-center">
            <LoadingSpinner className="mx-auto mb-4" />
            <div className="text-sm">{t("chat.loadingMessages")}</div>
          </div>
        </div>
      );
    }

    // Nothing top-level yet, but older messages exist: the newest page held
    // only thread replies. Offer "load older" instead of the empty-room art.
    if (hasMoreMessages) {
      return (
        <div className={containerClass}>
          <div className="text-center">
            <div className="mb-3 text-sm">{t("threads.onlyReplies")}</div>
            <button
              onClick={() => loadMoreMessages(roomId)}
              disabled={isLoadingMore}
              className={`px-4 py-1.5 text-xs rounded-full transition-colors duration-200 disabled:opacity-50 ${
                theme === "dark"
                  ? "text-gray-200 hover:text-white bg-gray-700 hover:bg-gray-600"
                  : "text-gray-700 hover:text-gray-900 bg-gray-200 hover:bg-gray-300"
              }`}
            >
              {isLoadingMore ? t("chat.loadingMessages") : `↑ ${t("chat.loadOlder")}`}
            </button>
          </div>
        </div>
      );
    }

    // Genuinely loaded and empty.
    return (
      <div className={containerClass}>
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
        className="h-full px-2 py-2 sm:px-4 overflow-y-auto [scrollbar-gutter:stable]"
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
              {isLoadingMore ? t("chat.loadingMessages") : `↑ ${t("chat.loadOlder")}`}
            </button>
          </div>
        )}

        <div
          ref={feedRef}
          role="feed"
          aria-label={t("chat.messageFeedAriaLabel")}
          aria-busy={isLoadingMore}
          onFocus={handleFeedFocus}
          onBlur={handleFeedBlur}
          onKeyDown={handleFeedKeyDown}
        >
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
                className={`${isGrouped ? "mt-0.5" : index === 0 && !hasMoreMessages ? "mt-0" : "mt-4"} rounded-md transition-colors duration-200 ${
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
                    onReplyInThread={onReplyInThread}
                    rowTabStop={message.id === activeRowId}
                    posInSet={feedPosition.get(message.id)}
                    setSize={hasMoreMessages ? -1 : feedRowIds.length}
                  />
                )}
              </div>
            );
          })}
        </div>
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
              {(unreadCount > 1 ? t("chat.unreadMany") : t("chat.unreadOne")).replace("{count}", String(unreadCount))}
            </span>
          ) : (
            <span>{t("chat.jumpToBottom")}</span>
          )}
        </button>
      )}
    </div>
  );
};
