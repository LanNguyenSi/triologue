import React, { useState, useRef, useEffect } from 'react';
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react';
import { FaceSmileIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { useSocketStore } from '../../stores/socketStore';

interface MessageInputProps {
  roomId: string;
}

export const MessageInput: React.FC<MessageInputProps> = ({ roomId }) => {
  const [message, setMessage]         = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const { sendMessage }               = useSocketStore();
  const inputRef                      = useRef<HTMLInputElement>(null);
  const pickerRef                     = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    if (!showEmojiPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojiPicker]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      sendMessage(roomId, message.trim());
      setMessage('');
    }
    setShowEmojiPicker(false);
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    const input = inputRef.current;
    if (input) {
      const start = input.selectionStart ?? message.length;
      const end   = input.selectionEnd   ?? message.length;
      const newMsg = message.slice(0, start) + emojiData.emoji + message.slice(end);
      setMessage(newMsg);
      // Restore cursor after emoji
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(start + emojiData.emoji.length, start + emojiData.emoji.length);
      });
    } else {
      setMessage(m => m + emojiData.emoji);
    }
  };

  return (
    <div className="p-4 relative">
      {/* Emoji Picker */}
      {showEmojiPicker && (
        <div
          ref={pickerRef}
          className="absolute bottom-full right-4 mb-2 z-50 shadow-2xl rounded-xl overflow-hidden"
        >
          <EmojiPicker
            theme={Theme.DARK}
            onEmojiClick={onEmojiClick}
            lazyLoadEmojis
            height={380}
            width={320}
            searchPlaceholder="Emoji suchen..."
          />
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="flex gap-2 items-center">
          {/* Emoji Button */}
          <button
            type="button"
            onClick={() => setShowEmojiPicker(s => !s)}
            className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
              showEmojiPicker
                ? 'text-yellow-400 bg-yellow-900/30'
                : 'text-gray-400 hover:text-yellow-400 hover:bg-gray-700'
            }`}
            title="Emoji einfügen"
          >
            <FaceSmileIcon className="w-5 h-5" />
          </button>

          {/* Message Input */}
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowEmojiPicker(false);
            }}
            placeholder="Nachricht schreiben…"
            className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={!message.trim()}
            className="p-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0"
            title="Senden"
          >
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
};
