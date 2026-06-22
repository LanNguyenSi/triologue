import React from "react";
import toast from "react-hot-toast";
import {
  ClipboardDocumentIcon,
  MapPinIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useLanguage } from "../../contexts/LanguageContext";
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
  return (
    <>
      <button
        onClick={() => { navigator.clipboard.writeText(message.content || ''); toast.success(t("chat.copied")); }}
        className="p-1 text-gray-400 hover:text-gray-200"
        title={t("chat.copy")}
      >
        <ClipboardDocumentIcon className="w-4 h-4" />
      </button>
      {canPin && (
        <button
          onClick={onPin}
          disabled={isPinning}
          className={`p-1 disabled:opacity-50 ${message.isPinned ? "text-amber-400 hover:text-amber-300" : "text-gray-400 hover:text-amber-400"}`}
          title={message.isPinned ? t("chat.unpinMessage") : t("chat.pinMessage")}
        >
          <MapPinIcon className="w-4 h-4" />
        </button>
      )}
      {canDelete && (
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="p-1 text-gray-400 hover:text-red-400 disabled:opacity-50"
          title={t("chat.deleteMessage")}
        >
          <TrashIcon className="w-4 h-4" />
        </button>
      )}
    </>
  );
};
