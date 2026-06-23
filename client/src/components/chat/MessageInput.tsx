import React, { useState, useRef, useEffect } from "react";
import TextareaAutosize from "react-textarea-autosize";
import EmojiPicker, { EmojiClickData, Theme } from "emoji-picker-react";
import toast from "react-hot-toast";
import {
  FaceSmileIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
  XMarkIcon,
  DocumentIcon,
} from "@heroicons/react/24/outline";
import { useSocketStore } from "../../stores/socketStore";
import { useAuthStore } from "../../stores/authStore";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { MentionPopup, useMention } from "./MentionPopup";

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface MessageInputProps {
  roomId: string;
  canSendMessages?: boolean;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  roomId,
  canSendMessages = true,
}) => {
  const [message, setMessage] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { sendMessage } = useSocketStore();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { mentionState, checkForMention, closeMention } = useMention();

  const handleMentionSelect = (username: string) => {
    const { startPos } = mentionState;
    const before = message.substring(0, startPos);
    const afterCursor = message.substring(inputRef.current?.selectionStart ?? message.length);
    const newMsg = `${before}@${username} ${afterCursor}`;
    setMessage(newMsg);
    closeMention();
    requestAnimationFrame(() => {
      const pos = before.length + username.length + 2; // @username + space
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  };

  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const outsidePicker =
        pickerRef.current && !pickerRef.current.contains(target);
      const outsideButton =
        emojiButtonRef.current && !emojiButtonRef.current.contains(target);
      if (outsidePicker && outsideButton) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showEmojiPicker]);

  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    };
  }, [filePreview]);

  useEffect(() => {
    if (!canSendMessages) {
      setShowEmojiPicker(false);
    }
  }, [canSendMessages]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canSendMessages) return;

    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error(t("chat.fileTypeNotAllowed"));
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error(t("chat.fileTooLarge"));
      return;
    }

    setSelectedFile(file);
    if (file.type.startsWith("image/")) {
      setFilePreview(URL.createObjectURL(file));
    } else {
      setFilePreview(null);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearFile = () => {
    if (filePreview) URL.revokeObjectURL(filePreview);
    setSelectedFile(null);
    setFilePreview(null);
  };

  const handleUpload = async (): Promise<boolean> => {
    if (!canSendMessages) {
      toast.error(t("chat.readOnlyClosedProjectHint"));
      return false;
    }
    if (!selectedFile) return false;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const token = useAuthStore.getState().token;
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("roomId", roomId);
      if (message.trim()) formData.append("caption", message.trim());

      const xhr = new XMLHttpRequest();

      await new Promise<unknown>(
        (resolve, reject) => {
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              setUploadProgress(Math.round((e.loaded / e.total) * 100));
            }
          });

          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(JSON.parse(xhr.responseText));
            } else {
              try {
                const err = JSON.parse(xhr.responseText);
                reject(new Error(err.error || "Upload failed"));
              } catch {
                reject(new Error("Upload failed"));
              }
            }
          });

          xhr.addEventListener("error", () =>
            reject(new Error("Network error")),
          );

          xhr.open("POST", "/api/upload");
          xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          xhr.send(formData);
        },
      );

      clearFile();
      setMessage("");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("chat.uploadFailed"));
      return false;
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canSendMessages) return;

    if (selectedFile) {
      await handleUpload();
      setShowEmojiPicker(false);
      return;
    }

    if (!message.trim()) return;
    const sent = sendMessage(roomId, message.trim());
    if (sent) {
      setMessage("");
      setSendError(false);
    } else {
      setSendError(true);
      setTimeout(() => setSendError(false), 3000);
    }
    setShowEmojiPicker(false);
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    const input = inputRef.current;
    if (input) {
      const start = input.selectionStart ?? message.length;
      const end = input.selectionEnd ?? message.length;
      const newMsg =
        message.slice(0, start) + emojiData.emoji + message.slice(end);
      setMessage(newMsg);
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(
          start + emojiData.emoji.length,
          start + emojiData.emoji.length,
        );
      });
    } else {
      setMessage((m) => m + emojiData.emoji);
    }
  };

  return (
    <div className="px-3 py-2 relative">
      {showEmojiPicker && (
        <div
          ref={pickerRef}
          className="absolute bottom-full left-4 mb-2 z-50 shadow-elevated rounded-xl overflow-hidden"
        >
          <EmojiPicker
            theme={isDark ? Theme.DARK : Theme.LIGHT}
            onEmojiClick={onEmojiClick}
            lazyLoadEmojis
            height={380}
            width={320}
            searchPlaceholder={t("chat.emojiSearch")}
          />
        </div>
      )}

      {selectedFile && (
        <div
          className={`mb-2 p-3 rounded-lg border flex items-center gap-3 ${
            isDark
              ? "bg-gray-800/60 border-gray-700/50"
              : "bg-gray-50 border-gray-200/80 shadow-subtle"
          }`}
        >
          {filePreview ? (
            <img
              src={filePreview}
              alt={selectedFile.name}
              className="w-16 h-16 object-cover rounded-lg"
            />
          ) : (
            <div
              className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                isDark
                  ? "bg-gray-600 text-gray-300"
                  : "bg-gray-200 text-gray-600"
              }`}
            >
              <DocumentIcon className="w-6 h-6" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p
              className={`text-sm font-medium truncate ${
                isDark ? "text-white" : "text-gray-900"
              }`}
            >
              {selectedFile.name}
            </p>
            <p
              className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              {formatFileSize(selectedFile.size)}
            </p>
          </div>

          {isUploading ? (
            <div className="flex items-center gap-2">
              <div className="w-20 h-1.5 rounded-full bg-gray-600 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-colors duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <span className="text-xs text-gray-400">{uploadProgress}%</span>
            </div>
          ) : (
            <button
              onClick={clearFile}
              className={`p-1 rounded-lg transition-colors duration-200 ${
                isDark
                  ? "text-gray-400 hover:text-white hover:bg-gray-800/60"
                  : "text-gray-400 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="flex gap-2 items-center relative">
          <MentionPopup
            roomId={roomId}
            query={mentionState.query}
            onSelect={handleMentionSelect}
            onClose={closeMention}
            visible={mentionState.active}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_TYPES.join(",")}
            onChange={handleFileSelect}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || !canSendMessages}
            className={`p-2 rounded-lg transition-colors duration-200 flex-shrink-0 disabled:opacity-50 ${
              selectedFile
                ? "text-blue-400 bg-blue-900/30"
                : isDark
                  ? "text-gray-400 hover:text-blue-400 hover:bg-gray-800/60"
                  : "text-gray-500 hover:text-blue-500 hover:bg-gray-50"
            }`}
            title={t("chat.attachFile")}
          >
            <PaperClipIcon className="w-5 h-5" />
          </button>

          <button
            ref={emojiButtonRef}
            type="button"
            disabled={!canSendMessages}
            onClick={() => setShowEmojiPicker((s) => !s)}
            className={`p-2 rounded-lg transition-colors duration-200 flex-shrink-0 disabled:opacity-50 ${
              showEmojiPicker
                ? "text-yellow-400 bg-yellow-900/30"
                : isDark
                  ? "text-gray-400 hover:text-yellow-400 hover:bg-gray-800/60"
                  : "text-gray-500 hover:text-yellow-500 hover:bg-gray-50"
            }`}
            title={t("chat.emojiInsert")}
          >
            <FaceSmileIcon className="w-5 h-5" />
          </button>

          <TextareaAutosize
            ref={inputRef}
            value={message}
            onChange={(e) => {
              if (!canSendMessages) return;
              setMessage(e.target.value);
              checkForMention(e.target.value, e.target.selectionStart ?? 0);
            }}
            onKeyDown={(e) => {
              if (mentionState.active && e.key === "Escape") {
                e.preventDefault();
                closeMention();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (mentionState.active) {
                  closeMention();
                }
                handleSubmit(e);
              }
              if (e.key === "Escape") setShowEmojiPicker(false);
            }}
            placeholder={
              !canSendMessages
                ? t("chat.readOnlyClosedProject")
                : selectedFile
                  ? t("chat.captionPlaceholder")
                  : t("chat.messagePlaceholder")
            }
            className={`flex-1 px-3.5 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-1 ${isDark ? "focus:ring-offset-gray-900" : "focus:ring-offset-white"} focus:border-blue-500 resize-none transition-colors duration-200 ${
              isDark
                ? "bg-gray-800/60 border-gray-600/80 text-white placeholder-gray-500"
                : "bg-white border-gray-200/60 text-gray-900 placeholder-gray-400 shadow-subtle"
            }`}
            readOnly={!canSendMessages}
            disabled={!canSendMessages}
            minRows={1}
            maxRows={6}
          />

          <button
            type="submit"
            disabled={
              !canSendMessages || (!message.trim() && !selectedFile) || isUploading
            }
            className="p-2.5 bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-500 shadow-subtle focus:outline-none focus:ring-2 focus:ring-blue-500/40 flex-shrink-0 transition-colors duration-200"
            title={selectedFile ? t("chat.upload") : t("chat.send")}
          >
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
        </div>
        {!canSendMessages && (
          <p className={`text-xs mt-1 ml-10 ${isDark ? "text-amber-300" : "text-amber-700"}`}>
            {t("chat.readOnlyClosedProjectHint")}
          </p>
        )}
        {sendError && (
          <p className="text-xs text-red-400 mt-1 ml-10">
            {t("chat.sendFailed")}
          </p>
        )}
      </form>
    </div>
  );
};
