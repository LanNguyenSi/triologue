import React, { useEffect, useId, useRef, useState } from "react";
import toast from "react-hot-toast";
import { MessageRenderer } from "./MessageRenderer";
import { ReactionSystem, aggregateReactions } from "./ReactionSystem";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "../../stores/chatStore";
import { apiClient } from "../../lib/apiClient";
import { AuthFileImage, AuthFileLink } from "../files/AuthFile";
import { useTheme } from "../../contexts/ThemeContext";
import { useLanguage } from "../../contexts/LanguageContext";
import {
  DocumentIcon,
  ArrowDownTrayIcon,
  MapPinIcon,
} from "@heroicons/react/24/outline";
import { Message } from "../../types/chat";
import { formatTime, getAvatarStyle, getAvatarIcon } from "./chatUtils";
import { MessageActions } from "./MessageActions";

// Interactive elements a row's content can hold (links, code-copy buttons,
// reaction chips, ...). While the row is not active they leave the tab order,
// like the row's own action buttons. Scrollable regions that are focusable
// only through tabindex="0" (code blocks) stay as they are: axe requires a
// scrollable region to be keyboard focusable (scrollable-region-focusable),
// and tabindex -1 does not count.
const CONTENT_FOCUSABLE =
  "a[href], button, input, select, textarea, summary, [contenteditable]";
const SAVED_TABINDEX = "data-row-saved-tabindex";
// Elements whose tab stop is set through a `tabbable` prop (the row's action
// buttons and the add-reaction button) sit in or carry this attribute and are
// left to that prop.
const PROP_MANAGED = "data-tab-managed";

/**
 * Takes the focusable content of an inactive message row out of the tab order
 * (tabindex -1, original value kept in a data attribute) and puts it back
 * while focus is inside the row. A MutationObserver covers content that
 * renders later (code highlighting, images). Prop-managed elements are left
 * alone.
 */
function useRovingContent(
  rowRef: React.RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const sync = () => {
      if (active) {
        row.querySelectorAll<HTMLElement>(`[${SAVED_TABINDEX}]`).forEach((el) => {
          const saved = el.getAttribute(SAVED_TABINDEX);
          if (saved) el.setAttribute("tabindex", saved);
          else el.removeAttribute("tabindex");
          el.removeAttribute(SAVED_TABINDEX);
        });
        return;
      }
      row.querySelectorAll<HTMLElement>(CONTENT_FOCUSABLE).forEach((el) => {
        if (el.hasAttribute(SAVED_TABINDEX) || el.closest(`[${PROP_MANAGED}]`)) return;
        el.setAttribute(SAVED_TABINDEX, el.getAttribute("tabindex") ?? "");
        el.setAttribute("tabindex", "-1");
      });
    };
    sync();
    if (active) return;
    const observer = new MutationObserver(sync);
    observer.observe(row, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [rowRef, active]);
}

// Separate component so hooks are called at top level (not inside map)
export const MessageItem: React.FC<{
  message: Message;
  onReact?: (messageId: string, emoji: string) => void;
  isGrouped: boolean;
  canPin: boolean;
  onReplyInThread?: (message: Message) => void;
  /**
   * Whether the row is the one tab stop of its message feed (roving tabindex:
   * the feed makes exactly one row tabIndex 0 and all others -1). A row used
   * outside a feed is its own tab stop.
   */
  rowTabStop?: boolean;
  /** 1-based position of this row in its feed (aria-posinset). */
  posInSet?: number;
  /** Size of the feed (aria-setsize); -1 when more messages can be loaded. */
  setSize?: number;
}> = ({
  message,
  onReact,
  isGrouped,
  canPin,
  onReplyInThread,
  rowTabStop = true,
  posInSet,
  setSize,
}) => {
  const { user } = useAuthStore();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const { deleteMessage, pinMessage, unpinMessage } = useChatStore();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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

  // The row's action buttons (and the add-reaction button) are tab stops
  // only while focus is inside the row: the row itself or one of its
  // buttons. The pointer never changes the tab order. The blur handler
  // ignores focus moves that stay inside the row (row -> its buttons and
  // back), so Tab can walk through the actions and out of the row.
  const [rowFocused, setRowFocused] = useState(false);
  const actionsTabbable = rowFocused;
  const rowRef = useRef<HTMLDivElement>(null);
  useRovingContent(rowRef, rowFocused);

  // The row is named by its sender and time and described by its content.
  const baseId = useId();
  const senderId = `${baseId}-sender`;
  const timeId = `${baseId}-time`;
  const contentId = `${baseId}-content`;

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

  const avatar = getAvatarStyle(message.sender.userType, theme, message.sender.id);

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
        ref={rowRef}
        role="article"
        tabIndex={rowTabStop ? 0 : -1}
        data-message-row={message.id}
        aria-labelledby={`${senderId} ${timeId}`}
        aria-describedby={message.content ? contentId : undefined}
        aria-posinset={posInSet}
        aria-setsize={setSize}
        onFocus={() => setRowFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setRowFocused(false);
          }
        }}
        className={`flex items-start gap-3 group rounded-lg px-2 py-1 -mx-2 outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 ${theme === "dark" ? "focus-visible:ring-offset-gray-900" : "focus-visible:ring-offset-white"} ${ownBg}`}
      >
        {/* Avatar or spacer for grouped messages */}
        {isGrouped ? (
          <div className="w-8 shrink-0" />
        ) : (
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${avatar.className}`}
            style={avatar.style}
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
                id={senderId}
                className={`font-semibold text-sm min-w-0 truncate ${theme === "dark" ? "text-white" : "text-gray-900"}`}
              >
                {message.sender.displayName}
              </span>
              <span
                id={timeId}
                className={`text-xs cursor-default whitespace-nowrap shrink-0 ${theme === "dark" ? "text-gray-400" : "text-gray-600"}`}
                title={new Date(message.createdAt).toLocaleString()}
              >
                {formatTime(message.createdAt, t)}
              </span>
              <div data-tab-managed className="ml-auto shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
                <MessageActions
                  message={message}
                  tabbable={actionsTabbable}
                  canPin={canPin}
                  canDelete={canDelete}
                  isPinning={isPinning}
                  isDeleting={isDeleting}
                  onPin={handlePin}
                  onDelete={() => setShowDeleteConfirm(true)}
                  onReplyInThread={
                    onReplyInThread ? () => onReplyInThread(message) : undefined
                  }
                />
              </div>
            </div>
          )}

          {/* Grouped: show timestamp only on hover */}
          {isGrouped && (
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0"> {/* spacer */}</div>
              {/* The sender is not shown on a grouped row; the accessible name still has it. */}
              <span id={senderId} className="sr-only">
                {message.sender.displayName}
              </span>
              <span
                id={timeId}
                className={`text-xs cursor-default opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity ${theme === "dark" ? "text-gray-500" : "text-gray-400"}`}
                title={new Date(message.createdAt).toLocaleString()}
              >
                {formatTime(message.createdAt, t)}
              </span>
              <div data-tab-managed className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
                <MessageActions
                  message={message}
                  tabbable={actionsTabbable}
                  canPin={canPin}
                  canDelete={canDelete}
                  isPinning={isPinning}
                  isDeleting={isDeleting}
                  onPin={handlePin}
                  onDelete={() => setShowDeleteConfirm(true)}
                  onReplyInThread={
                    onReplyInThread ? () => onReplyInThread(message) : undefined
                  }
                />
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
            <div id={contentId} className="mb-1">
              <MessageRenderer
                content={message.content}
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
                    <AuthFileLink
                      key={att.id}
                      url={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <AuthFileImage
                        url={att.url}
                        alt={att.filename}
                        className={`max-w-sm max-h-80 rounded-lg border object-contain cursor-pointer hover:opacity-90 transition-opacity ${
                          theme === "dark"
                            ? "border-gray-700/40"
                            : "border-gray-200/60"
                        }`}
                        loading="lazy"
                      />
                    </AuthFileLink>
                  );
                }

                return (
                  <AuthFileLink
                    key={att.id}
                    url={att.url}
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
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
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
                      className={`w-4 h-4 shrink-0 ${
                        theme === "dark" ? "text-gray-400" : "text-gray-500"
                      }`}
                    />
                  </AuthFileLink>
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
            tabbable={actionsTabbable}
          />
        </div>
      </div>
    </>
  );
};
