import React, { useState, useRef, useEffect } from "react";
import TextareaAutosize from "react-textarea-autosize";
import EmojiPicker, { EmojiClickData, Theme } from "emoji-picker-react";
import { FaceSmileIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import { useSocketStore } from "../../stores/socketStore";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";

interface MessageInputProps {
  roomId: string;
}

export const MessageInput: React.FC<MessageInputProps> = ({ roomId }) => {
  const [message, setMessage] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [sendError, setSendError] = useState(false);
  const { sendMessage, isConnected } = useSocketStore();
  const { t } = useLanguage();
  const { theme } = useTheme();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  // Close picker on outside click — exclude the toggle button itself
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
      // Restore cursor after emoji
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
    <div className="p-4 relative">
      {/* Emoji Picker */}
      {showEmojiPicker && (
        <div
          ref={pickerRef}
          className="absolute bottom-full left-4 mb-2 z-50 shadow-2xl rounded-xl overflow-hidden"
        >
          <EmojiPicker
            theme={theme === "dark" ? Theme.DARK : Theme.LIGHT}
            onEmojiClick={onEmojiClick}
            lazyLoadEmojis
            height={380}
            width={320}
            searchPlaceholder={t("chat.emojiSearch")}
          />
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="flex gap-2 items-center">
          {/* Emoji Button */}
          <button
            ref={emojiButtonRef}
            type="button"
            onClick={() => setShowEmojiPicker((s) => !s)}
            className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
              showEmojiPicker
                ? "text-yellow-400 bg-yellow-900/30"
                : theme === "dark"
                  ? "text-gray-400 hover:text-yellow-400 hover:bg-gray-700"
                  : "text-gray-600 hover:text-yellow-500 hover:bg-gray-100"
            }`}
            title={t("chat.emojiInsert")}
          >
            <FaceSmileIcon className="w-5 h-5" />
          </button>

          {/* Message Input */}
          <TextareaAutosize
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
              if (e.key === "Escape") setShowEmojiPicker(false);
            }}
            placeholder={t("chat.messagePlaceholder")}
            className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${
              theme === "dark"
                ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                : "bg-white border-gray-300 text-gray-900 placeholder-gray-500"
            }`}
            minRows={1}
            maxRows={6}
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={!message.trim()}
            className="p-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0"
            title={t("chat.send")}
          >
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
        </div>
        {sendError && (
          <p className="text-xs text-red-400 mt-1 ml-10">
            {t("chat.sendFailed")}
          </p>
        )}
      </form>
    </div>
  );
};
