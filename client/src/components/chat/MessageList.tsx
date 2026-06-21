import React, { useEffect, useRef, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { MessageRenderer } from "./MessageRenderer";
import { ReactionSystem, aggregateReactions } from "./ReactionSystem";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "../../stores/chatStore";
import { useAgentStore } from "../../stores/agentStore";
import { apiClient } from "../../lib/apiClient";
import { BrandMark } from "../ui/BrandMark";
import { authFileUrl } from "../../lib/fileUrl";
import { useTheme } from "../../contexts/ThemeContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  TrashIcon,
  ClipboardDocumentIcon,
  DocumentIcon,
  ArrowDownTrayIcon,
  MapPinIcon,
} from "@heroicons/react/24/outline";

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

interface MessageAttachment {
  id: string;
  filename: string;
  url: string;
  mimeType: string | null;
  size: number | null;
  type: string;
}

interface Message {
  id: string;
  content: string;
  messageType?: string;
  sender: {
    id: string;
    username: string;
    displayName: string;
    userType: string;
  };
  createdAt: string;
  reactions?: MessageReaction[];
  attachments?: MessageAttachment[];
  isPinned?: boolean;
  pinnedAt?: string;
  pinnedBy?: { id: string; username: string; displayName: string } | null;
}

interface MessageListProps {
  messages: Message[];
  roomId: string;
  onReact?: (messageId: string, emoji: string) => void;
  highlightedMessageId?: string | null;
}

const getAvatarStyle = (userType: string, theme: string, userId?: string) => {
  // Dynamic color from agent store
  const agentColor = userId ? useAgentStore.getState().getAgentColor(userId, userType) : null;
  
  if (userType === "HUMAN") {
    return theme === "dark"
      ? "bg-blue-900/40 border border-blue-600/50"
      : "bg-blue-100 border border-blue-300";
  }
  
  if (useAgentStore.getState().isAgent(userType)) {
    // Use agent's brand color if available
    if (agentColor && agentColor !== "#888888") {
      return theme === "dark"
        ? `border border-opacity-50`
        : `border border-opacity-30`;
    }
    // Fallback
    return theme === "dark"
      ? "bg-purple-900/40 border border-purple-600/50"
      : "bg-purple-100 border border-purple-300";
  }

  return theme === "dark"
    ? "bg-gray-900/40 border border-gray-600/50"
    : "bg-gray-100 border border-gray-300/60";
};

const getAvatarIcon = (userType: string, userId?: string) => {
  if (userId) {
    const emoji = useAgentStore.getState().getAgentEmoji(userId, userType);
    if (emoji) return emoji;
  }
  if (userType === "HUMAN") return "H";
  return "AI";
};

// Separate component so hooks are called at top level (not inside map)
const MessageItem: React.FC<{
  message: Message;
  onReact?: (messageId: string, emoji: string) => void;
  isGrouped: boolean;
  canPin: boolean;
}> = ({ message, onReact, isGrouped, canPin }) => {
  const { user } = useAuthStore();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const { deleteMessage, pinMessage, unpinMessage } = useChatStore();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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
    setIsDeleting(true);
    try {
      const res = await apiClient(`/api/messages/${message.id}`, { method: "DELETE" });
      if (res.ok) {
        deleteMessage(message.id);
      } else {
        const err = await res.json();
        console.error("Failed to delete:", err);
        toast.error(t("chat.deleteMessageFailed"));
      }
    } catch (error) {
      console.error("Delete error:", error);
      toast.error(t("chat.deleteMessageError"));
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const [isPinning, setIsPinning] = useState(false);

  const handlePin = async () => {
    setIsPinning(true);
    try {
      const endpoint = message.isPinned ? "unpin" : "pin";
      const res = await apiClient(`/api/messages/${message.id}/${endpoint}`, { method: "PATCH" });
      if (res.ok) {
        if (message.isPinned) {
          unpinMessage(message.id);
        } else {
          const data = await res.json();
          pinMessage(message.id, new Date().toISOString(), data.pinnedBy);
        }
      } else {
        const err = await res.json();
        console.error("Failed to pin/unpin:", err);
        toast.error(message.isPinned ? t("chat.unpinFailed") : t("chat.pinFailed"));
      }
    } catch (error) {
      console.error("Pin/unpin error:", error);
      toast.error(message.isPinned ? t("chat.unpinFailed") : t("chat.pinFailed"));
    } finally {
      setIsPinning(false);
    }
  };

  // Own-message subtle tint
  const ownBg = isOwnMessage
    ? theme === "dark"
      ? "bg-blue-900/10"
      : "bg-blue-50"
    : "";

  return (
    <>
      <ConfirmDialog
        open={showDeleteConfirm}
        title={t("chat.deleteMessageTitle")}
        message={t("chat.deleteMessageConfirm")}
        confirmLabel={t("chat.delete")}
        cancelLabel={t("chat.cancel")}
        variant="danger"
        loading={isDeleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
      <div
        className={`flex items-start gap-3 group rounded-lg px-2 py-1 -mx-2 ${ownBg}`}
      >
        {/* Avatar or spacer for grouped messages */}
        {isGrouped ? (
          <div className="w-8 flex-shrink-0" />
        ) : (
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${getAvatarStyle(message.sender.userType, theme, message.sender.id)}`}
          >
            {getAvatarIcon(message.sender.userType, message.sender.id)}
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
              <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => { navigator.clipboard.writeText(message.content || ''); toast.success(t("chat.copied")); }}
                  className="p-1 text-gray-400 hover:text-gray-200"
                  title={t("chat.copy")}
                >
                  <ClipboardDocumentIcon className="w-4 h-4" />
                </button>
                {canPin && (
                  <button
                    onClick={handlePin}
                    disabled={isPinning}
                    className={`p-1 disabled:opacity-50 ${message.isPinned ? "text-amber-400 hover:text-amber-300" : "text-gray-400 hover:text-amber-400"}`}
                    title={message.isPinned ? t("chat.unpinMessage") : t("chat.pinMessage")}
                  >
                    <MapPinIcon className="w-4 h-4" />
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isDeleting}
                    className="p-1 text-gray-400 hover:text-red-400 disabled:opacity-50"
                    title={t("chat.deleteMessage")}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                )}
              </div>
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
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => { navigator.clipboard.writeText(message.content || ''); toast.success(t("chat.copied")); }}
                  className="p-1 text-gray-400 hover:text-gray-200"
                  title={t("chat.copy")}
                >
                  <ClipboardDocumentIcon className="w-4 h-4" />
                </button>
                {canPin && (
                  <button
                    onClick={handlePin}
                    disabled={isPinning}
                    className={`p-1 disabled:opacity-50 ${message.isPinned ? "text-amber-400 hover:text-amber-300" : "text-gray-400 hover:text-amber-400"}`}
                    title={message.isPinned ? t("chat.unpinMessage") : t("chat.pinMessage")}
                  >
                    <MapPinIcon className="w-4 h-4" />
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isDeleting}
                    className="p-1 text-gray-400 hover:text-red-400 disabled:opacity-50"
                    title={t("chat.deleteMessage")}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}


          {/* Pinned indicator */}
          {message.isPinned && (
            <div className={`flex items-center gap-1.5 mb-1 text-xs ${theme === "dark" ? "text-amber-400/70" : "text-amber-600/70"}`}>
              <MapPinIcon className="w-3 h-3" />
              <span>
                {t("chat.pinnedBy").replace("{name}", message.pinnedBy?.displayName || message.pinnedBy?.username || "")}
              </span>
            </div>
          )}

          {message.content && (
            <div className="mb-1">
              <MessageRenderer
                content={message.content}
                messageId={message.id}
                canReact={!!onReact}
              />
            </div>
          )}

          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-1 space-y-2">
              {message.attachments.map((att) => {
                const isImage = att.mimeType?.startsWith("image/");
                const sizeStr = att.size
                  ? att.size < 1024 * 1024
                    ? `${(att.size / 1024).toFixed(1)} KB`
                    : `${(att.size / (1024 * 1024)).toFixed(1)} MB`
                  : "";

                if (isImage) {
                  return (
                    <a
                      key={att.id}
                      href={authFileUrl(att.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <img
                        src={authFileUrl(att.url)}
                        alt={att.filename}
                        className="max-w-sm max-h-80 rounded-lg border border-gray-700/40 object-contain cursor-pointer hover:opacity-90 transition-opacity"
                        loading="lazy"
                      />
                    </a>
                  );
                }

                return (
                  <a
                    key={att.id}
                    href={authFileUrl(att.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={att.filename}
                    className={`flex items-center gap-3 p-3 rounded-lg border max-w-sm transition-colors duration-200 ${
                      theme === "dark"
                        ? "bg-gray-700/50 border-gray-600/50 hover:bg-gray-700"
                        : "bg-gray-50 border-gray-200/60 hover:bg-gray-100"
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        att.mimeType === "application/pdf"
                          ? "bg-red-900/30 text-red-400"
                          : theme === "dark"
                            ? "bg-gray-600 text-gray-300"
                            : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      <DocumentIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${
                          theme === "dark" ? "text-white" : "text-gray-900"
                        }`}
                      >
                        {att.filename}
                      </p>
                      {sizeStr && (
                        <p
                          className={`text-xs ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}
                        >
                          {sizeStr}
                        </p>
                      )}
                    </div>
                    <ArrowDownTrayIcon
                      className={`w-4 h-4 flex-shrink-0 ${
                        theme === "dark" ? "text-gray-400" : "text-gray-500"
                      }`}
                    />
                  </a>
                );
              })}
            </div>
          )}

          <ReactionSystem
            messageId={message.id}
            reactions={aggregatedReactions}
            onReact={onReact ?? (() => { /* intentionally empty: no-op fallback when no reaction handler is provided */ })}
            currentUserId={user?.id}
            className="mt-1"
          />
        </div>
      </div>
    </>
  );
};

// ─── System Message Banner ──────────────────────────────────────────────────

interface ApprovalRequestPayload {
  type: 'approval_request';
  approvalId: string;
  connectorId: string;
  actionId: string;
  riskLevel: string;
  reason?: string;
}

const SystemMessageBanner: React.FC<{ content: string }> = ({ content }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(content) as Record<string, unknown>; } catch { /* not JSON */ }

  if (parsed?.type === 'approval_request') {
    const p = parsed as unknown as ApprovalRequestPayload;
    return (
      <div className={`my-2 mx-3 px-3 py-2 rounded-lg border flex items-center gap-2 text-sm ${
        isDark
          ? 'bg-amber-900/20 border-amber-700/40 text-amber-200'
          : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}>
        <span>🔔</span>
        <span className="flex-1">
          Agent wartet auf Freigabe —{' '}
          <span className="font-mono text-xs">{p.connectorId}/{p.actionId}</span>
          {p.riskLevel && <span className={`ml-1 text-xs ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>({p.riskLevel} risk)</span>}
        </span>
        <a
          href="/approvals"
          className={`text-xs font-medium underline underline-offset-2 shrink-0 ${
            isDark ? 'text-amber-300 hover:text-amber-100' : 'text-amber-700 hover:text-amber-900'
          }`}
        >
          → Approvals öffnen
        </a>
      </div>
    );
  }

  // Fallback for other SYSTEM messages
  return (
    <div className={`my-2 mx-3 px-3 py-2 rounded-lg border text-xs ${
      isDark
        ? 'bg-gray-800/50 border-gray-700/40 text-gray-400'
        : 'bg-gray-50 border-gray-200 text-gray-500'
    }`}>
      🔔 {content}
    </div>
  );
};

// ─── MessageList ─────────────────────────────────────────────────────────────

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
