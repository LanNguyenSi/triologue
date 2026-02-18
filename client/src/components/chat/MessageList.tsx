import React from 'react';
import { MessageRenderer } from './MessageRenderer';
import { ReactionSystem, aggregateReactions } from './ReactionSystem';
import { useAuthStore } from '../../stores/authStore';

interface MessageReaction {
  emoji: string;
  userId: string;
}

interface Message {
  id: string;
  content: string;
  sender: {
    username: string;
    displayName: string;
    userType: string;
  };
  createdAt: string;
  reactions?: MessageReaction[];
}

interface MessageListProps {
  messages: Message[];
  roomId: string;
  onReact?: (messageId: string, emoji: string) => void;
}

// Separate component so hooks are called at top level (not inside map)
const MessageItem: React.FC<{
  message: Message;
  onReact?: (messageId: string, emoji: string) => void;
}> = ({ message, onReact }) => {
  const { user } = useAuthStore();
  const aggregatedReactions = React.useMemo(
    () => message.reactions
      ? aggregateReactions(message.reactions, user?.id)
      : [],
    [message.reactions, user?.id]
  );

  return (
    <div className="flex items-start gap-3 group">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-sm flex-shrink-0">
        {message.sender.userType === 'AI_ICE'  && '🧊'}
        {message.sender.userType === 'AI_LAVA' && '🌋'}
        {message.sender.userType === 'HUMAN'   && '👨‍💻'}
        {!['AI_ICE','AI_LAVA','HUMAN'].includes(message.sender.userType) && '🤖'}
      </div>

      {/* Message content */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm text-white">
            {message.sender.displayName}
          </span>
          <span className="text-xs text-gray-400">
            {new Date(message.createdAt).toLocaleTimeString()}
          </span>
        </div>

        {/* Rich message content */}
        <div className="mb-1">
          <MessageRenderer
            content={message.content}
            messageId={message.id}
            canReact={!!onReact}
          />
        </div>

        {/* Reactions */}
        {onReact && (
          <ReactionSystem
            messageId={message.id}
            reactions={aggregatedReactions}
            onReact={onReact}
            currentUserId={user?.id}
            className="mt-1"
          />
        )}
      </div>
    </div>
  );
};

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  roomId,
  onReact,
}) => {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        <div className="text-center">
          <div className="text-4xl mb-4">🧊🌋👨‍💻</div>
          <div className="text-xl font-semibold">Welcome to Triologue</div>
          <div className="text-sm">AI-to-AI-to-Human conversation starts here</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 space-y-4">
      {messages.map(message => (
        <MessageItem
          key={message.id}
          message={message}
          onReact={onReact}
        />
      ))}
    </div>
  );
};
