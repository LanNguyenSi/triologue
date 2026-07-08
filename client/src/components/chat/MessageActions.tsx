import React from "react";
import toast from "react-hot-toast";
import {
  ClipboardDocumentIcon,
  MapPinIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { Message } from "../../types/chat";

interface MessageActionsProps {
  message: Message;
  canPin: boolean;
  canDelete: boolean | null | undefined;
  isPinning: boolean;
  isDeleting: boolean;
  onPin: () => void;
  onDelete: () => void;
}

export const MessageActions: React.FC<MessageActionsProps> = ({
  message,
  canPin,
  canDelete,
  isPinning,
  isDeleting,
  onPin,
  onDelete,
}) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <>
      <button
        onClick={() => { navigator.clipboard.writeText(message.content || ''); toast.success(t("chat.copied")); }}
        className={`rounded p-1 outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 ${
          isDark
            ? "focus-visible:ring-offset-gray-900 text-gray-400 hover:text-gray-200"
            : "focus-visible:ring-offset-white text-gray-500 hover:text-gray-700"
        }`}
        title={t("chat.copy")}
      >
        <ClipboardDocumentIcon className="w-4 h-4" />
      </button>
      {canPin && (
        <button
          onClick={onPin}
          disabled={isPinning}
          className={`rounded p-1 outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 disabled:opacity-50 ${
            isDark ? "focus-visible:ring-offset-gray-900" : "focus-visible:ring-offset-white"
          } ${
            message.isPinned
              ? "text-amber-400 hover:text-amber-300"
              : isDark
                ? "text-gray-400 hover:text-amber-400"
                : "text-gray-500 hover:text-amber-500"
          }`}
          title={message.isPinned ? t("chat.unpinMessage") : t("chat.pinMessage")}
        >
          <MapPinIcon className="w-4 h-4" />
        </button>
      )}
      {canDelete && (
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className={`rounded p-1 outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:ring-offset-1 disabled:opacity-50 ${
            isDark
              ? "focus-visible:ring-offset-gray-900 text-gray-400 hover:text-red-400"
              : "focus-visible:ring-offset-white text-gray-500 hover:text-red-600"
          }`}
          title={t("chat.deleteMessage")}
        >
          <TrashIcon className="w-4 h-4" />
        </button>
      )}
    </>
  );
};
