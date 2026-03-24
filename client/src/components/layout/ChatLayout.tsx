import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useChatStore } from "../../stores/chatStore";
import { useSocketStore } from "../../stores/socketStore";
import { useAuthStore } from "../../stores/authStore";
import { useAgentStore } from "../../stores/agentStore";
import { useTheme } from "../../contexts/ThemeContext";
import { useLanguage } from "../../contexts/LanguageContext";
import { MessageList } from "../chat/MessageList";
import { MessageInput } from "../chat/MessageInput";
import { TypingIndicator } from "../chat/TypingIndicator";
import { UserList } from "../chat/UserList";
import { ChatHeader } from "../chat/ChatHeader";

const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return isMobile;
};

export const ChatLayout: React.FC = () => {
  const { roomId } = useParams<{ roomId: string }>();
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const [userListOpen, setUserListOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  const { currentRoom, messages, loadRoom, loadMessages, loadMoreMessages } = useChatStore();
  const { isConnected, typingUsers, addReaction } = useSocketStore();

  useEffect(() => {
    if (isMobile) setUserListOpen(false);
  }, [isMobile]);

  const effectiveRoomId = roomId || "main-triologue";

  useEffect(() => {
    if (effectiveRoomId && isConnected) loadRoom(effectiveRoomId);
  }, [effectiveRoomId, isConnected, loadRoom]);

  useEffect(() => {
    if (effectiveRoomId) loadMessages(effectiveRoomId);
  }, [effectiveRoomId, loadMessages]);

  const jumpToMessage = async (messageId: string) => {
    const hasMessage = (items: Array<{ id: string }>) =>
      items.some((message) => message.id === messageId);

    let state = useChatStore.getState();
    let guard = 0;
    while (!hasMessage(state.messages) && state.hasMoreMessages && guard < 40) {
      await loadMoreMessages(effectiveRoomId);
      state = useChatStore.getState();
      guard += 1;
    }

    if (!hasMessage(state.messages)) {
      setHighlightedMessageId(null);
      return;
    }

    setHighlightedMessageId(messageId);
  };

  useEffect(() => {
    if (!highlightedMessageId) return;
    const target = messages.find((message) => message.id === highlightedMessageId);
    if (!target) return;
    const node = document.getElementById(`message-${highlightedMessageId}`);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const timer = window.setTimeout(() => {
      setHighlightedMessageId((current) =>
        current === highlightedMessageId ? null : current,
      );
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [highlightedMessageId, messages]);

  const isDark = theme === "dark";

  return (
    <div className={`flex flex-col h-full overflow-hidden ${isDark ? "bg-dark-base text-white" : "bg-gray-50 text-gray-900"}`}>
      {/* Chat Header — room info + invite + user list toggle */}
      <div className={`px-4 py-2 flex-shrink-0 ${isDark ? "bg-gray-800/80 border-b border-gray-800/60" : "bg-white border-b border-gray-200/60"}`}>
        <ChatHeader
          room={currentRoom}
          onToggleUserList={() => setUserListOpen(o => !o)}
          onJumpToMessage={jumpToMessage}
        />
      </div>

      {/* Messages + Input + User List */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <MessageList
            messages={messages}
            roomId={effectiveRoomId}
            onReact={addReaction}
            highlightedMessageId={highlightedMessageId}
          />

          {typingUsers.length > 0 && (
            <div className={`px-4 py-1.5 flex-shrink-0 ${isDark ? "border-t border-gray-800/60" : "border-t border-gray-200/60"}`}>
              <TypingIndicator users={typingUsers} />
            </div>
          )}

          <div className={`flex-shrink-0 ${isDark ? "border-t border-gray-800/60" : "border-t border-gray-200/60"}`}>
            <MessageInput
              roomId={effectiveRoomId}
              canSendMessages={currentRoom?.canSendMessages !== false}
            />
          </div>
        </div>

        {/* Mobile backdrop */}
        {isMobile && userListOpen && (
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setUserListOpen(false)} />
        )}

        {/* User List panel */}
        {userListOpen && (
          <div className={[
            isDark ? "bg-gray-800/80 border-l border-gray-800/60" : "bg-white border-l border-gray-200/60",
            isMobile ? "fixed inset-y-0 right-0 z-50 w-64" : "w-56 flex-shrink-0",
          ].join(" ")}>
            <UserList roomId={effectiveRoomId} />
          </div>
        )}
      </div>
    </div>
  );
};

// AI User Status Indicators (used by other components)
export const AIStatusIndicator: React.FC<{
  userType: string;
  userId?: string;
  displayName?: string;
  isOnline: boolean;
  presenceStatus?: 'online' | 'active' | 'offline';
}> = ({ userType, userId, displayName, isOnline, presenceStatus }) => {
  const { t } = useLanguage();
  let emoji = "AI";
  let name = displayName || t("chat.agent");
  if (userId) {
    emoji = useAgentStore.getState().getAgentEmoji(userId, userType);
    const agent = useAgentStore.getState().getAgent(userId);
    if (agent) name = agent.displayName;
  }

  const status = presenceStatus || (isOnline ? 'online' : 'offline');
  const bgClass = status === 'online' ? "bg-green-900 text-green-100"
    : status === 'active' ? "bg-yellow-900 text-yellow-100"
    : "bg-gray-600 text-gray-300";
  const dotClass = status === 'online' ? "bg-green-400"
    : status === 'active' ? "bg-yellow-400"
    : "bg-gray-400";

  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded ${bgClass}`}>
      <span>{emoji}</span>
      <span className="text-sm font-medium">{name}</span>
      <div className={`w-2 h-2 rounded-full ${dotClass}`} />
    </div>
  );
};
