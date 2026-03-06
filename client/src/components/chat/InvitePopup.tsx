import React, { useCallback, useEffect, useId, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAgentStore } from '../../stores/agentStore';

interface InviteUser {
  id: string;
  username: string;
  displayName: string | null;
  userType: string;
}

interface InvitePopupProps {
  roomId: string;
  query: string;
  visible: boolean;
  onSelect: (username: string) => void;
}

export const InvitePopup: React.FC<InvitePopupProps> = ({ roomId, query, visible, onSelect }) => {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isDark = theme === 'dark';
  const [results, setResults] = useState<InviteUser[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const { getAgentEmoji } = useAgentStore();
  const popupId = useId();

  const fetchInvitable = useCallback(async () => {
    if (!visible || !query.trim()) { setResults([]); return; }
    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/rooms/${roomId}/invitable?q=${encodeURIComponent(query)}`, {
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
    const timer = setTimeout(fetchInvitable, 150);
    return () => clearTimeout(timer);
  }, [fetchInvitable]);

  useEffect(() => {
    if (!visible) { setResults([]); setActiveIndex(0); }
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
        if (selected) {
          onSelect(selected.username);
          setResults([]);
          setActiveIndex(0);
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setResults([]);
        setActiveIndex(0);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [visible, results, activeIndex, onSelect]);

  if (!visible || results.length === 0) return null;
  const activeOptionId = `${popupId}-option-${activeIndex}`;

  const getEmoji = (user: InviteUser) => {
    const emoji = getAgentEmoji(user.id, user.userType);
    if (emoji) return emoji;
    if (user.userType === 'HUMAN') return '👤';
    return '🤖';
  };

  return (
    <div
      role="listbox"
      aria-label={t('chat.invite.button')}
      aria-activedescendant={activeOptionId}
      className={`absolute top-full left-0 mt-1 w-full rounded-lg shadow-xl border overflow-hidden z-50 ${
      isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
    }`}
    >
      {results.map((user, idx) => (
        <button
          key={user.id}
          id={`${popupId}-option-${idx}`}
          type="button"
          role="option"
          aria-selected={idx === activeIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(user.username);
            setResults([]);
            setActiveIndex(0);
          }}
          onMouseEnter={() => setActiveIndex(idx)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
            idx === activeIndex
              ? isDark ? 'bg-blue-900/40 text-blue-200' : 'bg-blue-50 text-blue-700'
              : isDark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className="text-sm flex-shrink-0">{getEmoji(user)}</span>
          <span className="font-medium">{user.displayName || user.username}</span>
          <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            @{user.username}
          </span>
        </button>
      ))}
    </div>
  );
};
