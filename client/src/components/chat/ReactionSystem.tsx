import React, { useState, useRef, useEffect } from 'react';
import EmojiPicker, { EmojiClickData, Theme, Categories, SkinTonePickerLocation } from 'emoji-picker-react';
import { FaceSmileIcon } from '@heroicons/react/24/outline';

interface Reaction {
  emoji: string;
  count: number;
  users: string[];
  hasReacted: boolean; // Whether current user has reacted with this emoji
}

interface ReactionSystemProps {
  messageId: string;
  reactions?: Reaction[];
  onReact: (messageId: string, emoji: string) => void;
  currentUserId?: string;
  className?: string;
}

export const ReactionSystem: React.FC<ReactionSystemProps> = ({
  messageId,
  reactions = [],
  onReact,
  currentUserId,
  className = ''
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        pickerRef.current && 
        !pickerRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    onReact(messageId, emojiData.emoji);
    setShowPicker(false);
  };

  const handleReactionClick = (emoji: string) => {
    onReact(messageId, emoji);
  };

  return (
    <div className={`relative ${className}`}>
      {/* Existing reactions */}
      <div className="flex items-center gap-1 mb-1">
        {reactions.map((reaction) => (
          <button
            key={`${messageId}-${reaction.emoji}`}
            onClick={() => handleReactionClick(reaction.emoji)}
            className={`
              flex items-center gap-1 px-2 py-1 rounded-full text-xs
              transition-all duration-200 hover:scale-105
              ${reaction.hasReacted 
                ? 'bg-blue-600 text-white border border-blue-500' 
                : 'bg-gray-700 text-gray-300 border border-gray-600 hover:bg-gray-600'
              }
            `}
            title={`${reaction.emoji} — ${reaction.count} ${reaction.count === 1 ? 'Person' : 'Personen'}${reaction.hasReacted ? ' (du auch)' : ''}`}
          >
            <span className="text-base leading-none">{reaction.emoji}</span>
            <span className="font-medium">{reaction.count}</span>
          </button>
        ))}
        
        {/* Add reaction button */}
        <button
          ref={buttonRef}
          onClick={() => setShowPicker(!showPicker)}
          className="
            p-1 rounded-full text-gray-400 hover:text-gray-200 
            hover:bg-gray-700 transition-all duration-200
            opacity-0 group-hover:opacity-100 focus:opacity-100
            group-focus-within:opacity-100
          "
          title="Add reaction"
          aria-label="Add reaction"
          aria-expanded={showPicker}
        >
          <FaceSmileIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Emoji picker */}
      {showPicker && (
        <div 
          ref={pickerRef}
          className="absolute top-full left-0 z-50 mt-2"
          style={{ 
            transform: 'translateY(0)',
            maxWidth: '350px'
          }}
        >
          <EmojiPicker
            onEmojiClick={handleEmojiClick}
            theme={Theme.DARK}
            width={300}
            height={400}
            searchDisabled={false}
            skinTonePickerLocation={SkinTonePickerLocation.SEARCH}
            previewConfig={{
              defaultEmoji: '1f60a',
              defaultCaption: 'Choose your reaction',
              showPreview: true
            }}
            lazyLoadEmojis={true}
            categories={[
              {
                name: 'Smileys and People',
                category: Categories.SMILEYS_PEOPLE
              },
              {
                name: 'Objects', 
                category: Categories.OBJECTS
              },
              {
                name: 'Nature',
                category: Categories.ANIMALS_NATURE
              },
              {
                name: 'Food',
                category: Categories.FOOD_DRINK
              },
              {
                name: 'Activities',
                category: Categories.ACTIVITIES
              },
              {
                name: 'Travel',
                category: Categories.TRAVEL_PLACES
              },
              {
                name: 'Symbols',
                category: Categories.SYMBOLS
              }
            ]}
          />
        </div>
      )}
    </div>
  );
};

// Utility function to aggregate reactions
export const aggregateReactions = (
  reactions: Array<{ emoji: string; userId: string }>,
  currentUserId?: string
): Reaction[] => {
  const reactionMap = new Map<string, Reaction>();

  reactions.forEach(({ emoji, userId }) => {
    const existing = reactionMap.get(emoji);
    if (existing) {
      existing.count += 1;
      existing.users.push(userId);
      if (userId === currentUserId) {
        existing.hasReacted = true;
      }
    } else {
      reactionMap.set(emoji, {
        emoji,
        count: 1,
        users: [userId],
        hasReacted: userId === currentUserId
      });
    }
  });

  return Array.from(reactionMap.values()).sort((a, b) => b.count - a.count);
};