import React, { useState } from "react";
import toast from "react-hot-toast";
import { MessageRenderer } from "./MessageRenderer";
import { ReactionSystem, aggregateReactions } from "./ReactionSystem";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "../../stores/chatStore";
import { apiClient } from "../../lib/apiClient";
import { authFileUrl } from "../../lib/fileUrl";
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

// Separate component so hooks are called at top level (not inside map)
export const MessageItem: React.FC<{
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
        className={`flex items-start gap-3 group rounded-lg px-2 py-1 -mx-2 ${ownBg}`}
      >
        {/* Avatar or spacer for grouped messages */}
        {isGrouped ? (
          <div className="w-8 flex-shrink-0" />
        ) : (
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${avatar.className}`}
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
                className={`font-semibold text-sm ${theme === "dark" ? "text-white" : "text-gray-900"}`}
              >
                {message.sender.displayName}
              </span>
              <span
                className={`text-xs cursor-default ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}
                title={new Date(message.createdAt).toLocaleString()}
              >
                {formatTime(message.createdAt, t)}
              </span>
              <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <MessageActions
                  message={message}
                  canPin={canPin}
                  canDelete={canDelete}
                  isPinning={isPinning}
                  isDeleting={isDeleting}
                  onPin={handlePin}
                  onDelete={() => setShowDeleteConfirm(true)}
                />
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
                {formatTime(message.createdAt, t)}
              </span>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <MessageActions
                  message={message}
                  canPin={canPin}
                  canDelete={canDelete}
                  isPinning={isPinning}
                  isDeleting={isDeleting}
                  onPin={handlePin}
                  onDelete={() => setShowDeleteConfirm(true)}
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
