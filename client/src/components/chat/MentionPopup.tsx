import React, { useCallback, useEffect, useId, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useAgentStore } from '../../stores/agentStore';

interface MentionUser {
  id: string;
  username: string;
  displayName: string | null;
  userType: string;
  mentionKey?: string | null;
}

interface MentionPopupProps {
  roomId: string;
  query: string; // text after @
  onSelect: (username: string) => void;
  onClose: () => void;
  visible: boolean;
}

export const MentionPopup: React.FC<MentionPopupProps> = ({ roomId, query, onSelect, onClose, visible }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [results, setResults] = useState<MentionUser[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const { getAgentEmoji } = useAgentStore();
  const popupId = useId();

  // Fetch mentions
  const fetchMentions = useCallback(async () => {
    if (!visible) return;
    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/rooms/${roomId}/mentions?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setResults(data);
        setActiveIndex(0);
      }
    } catch { /* silent */ }
  }, [roomId, query, visible]);

  useEffect(() => {
    const timer = setTimeout(fetchMentions, 100); // small debounce
    return () => clearTimeout(timer);
  }, [fetchMentions]);

  // Keyboard navigation is handled by parent via onKeyDown

  useEffect(() => {
    if (!visible) {
      setResults([]);
      setActiveIndex(0);
    }
  }, [visible]);

  // Keyboard navigation + enter-select while popup is visible
  useEffect(() => {
    if (!visible || results.length === 0) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((prev) => (prev + 1) % results.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const selected = results[activeIndex] ?? results[0];
        if (selected) onSelect(selected.mentionKey || selected.username);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [visible, results, activeIndex, onClose, onSelect]);

  if (!visible || results.length === 0) return null;
  const activeOptionId = `${popupId}-option-${activeIndex}`;

  const getEmoji = (user: MentionUser) => {
    const emoji = getAgentEmoji(user.id, user.userType);
    if (emoji) return emoji;
    if (user.userType === 'HUMAN') return 'H';
    return 'AI';
  };

  return (
    <div
      role="listbox"
      aria-label="Mention"
      aria-activedescendant={activeOptionId}
      className={`absolute bottom-full left-0 mb-1 w-64 rounded-lg shadow-elevated border overflow-hidden z-50 ${
        isDark ? 'bg-gray-800 border-gray-700/50' : 'bg-white border-gray-200/60'
      }`}
    >
      <div className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold ${
        isDark ? 'text-gray-500 bg-gray-800/80' : 'text-gray-400 bg-gray-50'
      }`}>
        Mention
      </div>
      {results.map((user, idx) => (
        <button
          key={user.id}
          id={`${popupId}-option-${idx}`}
          type="button"
          role="option"
          aria-selected={idx === activeIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(user.mentionKey || user.username);
          }}
          onMouseEnter={() => setActiveIndex(idx)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-all duration-200 ${
            idx === activeIndex
              ? isDark ? 'bg-blue-900/40 text-blue-200' : 'bg-blue-50 text-blue-700'
              : isDark ? 'text-gray-300 hover:bg-gray-700/60' : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className="text-base flex-shrink-0">{getEmoji(user)}</span>
          <div className="min-w-0 text-left">
            <span className="font-medium">{user.displayName || user.mentionKey || user.username}</span>
            <span className={`ml-1.5 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              @{user.mentionKey || user.username}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
};

// Hook for parent to manage mention state
export function useMention() {
  const [mentionState, setMentionState] = useState<{ active: boolean; query: string; startPos: number }>({
    active: false, query: '', startPos: 0,
  });

  const checkForMention = (text: string, cursorPos: number) => {
    // Find the @ before cursor
    const textBeforeCursor = text.substring(0, cursorPos);
    const atIdx = textBeforeCursor.lastIndexOf('@');
    
    if (atIdx === -1) {
      if (mentionState.active) setMentionState({ active: false, query: '', startPos: 0 });
      return;
    }

    // @ must be at start or preceded by whitespace
    if (atIdx > 0 && !/\s/.test(textBeforeCursor[atIdx - 1])) {
      if (mentionState.active) setMentionState({ active: false, query: '', startPos: 0 });
      return;
    }

    const query = textBeforeCursor.substring(atIdx + 1);
    
    // No spaces in query (means user finished typing the mention)
    if (query.includes(' ')) {
      if (mentionState.active) setMentionState({ active: false, query: '', startPos: 0 });
      return;
    }

    setMentionState({ active: true, query, startPos: atIdx });
  };

  const closeMention = () => setMentionState({ active: false, query: '', startPos: 0 });

  return { mentionState, checkForMention, closeMention };
}
