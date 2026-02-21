import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useChatStore } from "../../stores/chatStore";
import { useSocketStore } from "../../stores/socketStore";
import { useAuthStore } from "../../stores/authStore";
import { useAgentStore } from "../../stores/agentStore";
import { useTheme } from "../../contexts/ThemeContext";
import { MessageList } from "../chat/MessageList";
import { MessageInput } from "../chat/MessageInput";
import { TypingIndicator } from "../chat/TypingIndicator";
import { UserList } from "../chat/UserList";
import { UsersIcon } from "@heroicons/react/24/outline";

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

  const { currentRoom, messages, loadRoom, loadMessages } = useChatStore();
  const { isConnected, typingUsers, connect, disconnect, addReaction } = useSocketStore();

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

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

  const isDark = theme === "dark";

  return (
    <div className={`flex flex-col h-full overflow-hidden ${isDark ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-900"}`}>
      {/* Chat Header — compact, just room info + user list toggle */}
      <div className={`px-4 py-2 flex-shrink-0 flex items-center justify-between ${isDark ? "bg-gray-800 border-b border-gray-700" : "bg-white border-b border-gray-200"}`}>
        <div className="min-w-0">
          <h1 className={`text-sm font-semibold truncate ${isDark ? "text-white" : "text-gray-900"}`}>
            {currentRoom?.name || "Chat"}
          </h1>
          {currentRoom?.description && (
            <p className={`text-xs truncate ${isDark ? "text-gray-400" : "text-gray-500"}`}>
              {currentRoom.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isConnected && (
            <span className="text-xs text-red-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
              Reconnecting
            </span>
          )}
          <button
            onClick={() => setUserListOpen(o => !o)}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-gray-700 text-gray-300" : "hover:bg-gray-100 text-gray-600"}`}
          >
            <UsersIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages + Input + User List */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <MessageList messages={messages} roomId={effectiveRoomId} onReact={addReaction} />

          {typingUsers.length > 0 && (
            <div className={`px-4 py-1.5 flex-shrink-0 ${isDark ? "border-t border-gray-700" : "border-t border-gray-200"}`}>
              <TypingIndicator users={typingUsers} />
            </div>
          )}

          <div className={`flex-shrink-0 ${isDark ? "border-t border-gray-700" : "border-t border-gray-200"}`}>
            <MessageInput roomId={effectiveRoomId} />
          </div>
        </div>

        {/* Mobile backdrop */}
        {isMobile && userListOpen && (
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setUserListOpen(false)} />
        )}

        {/* User List panel */}
        {userListOpen && (
          <div className={[
            isDark ? "bg-gray-800 border-l border-gray-700" : "bg-white border-l border-gray-200",
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
}> = ({ userType, userId, displayName, isOnline }) => {
  let emoji = "🤖";
  let name = displayName || "Agent";
  if (userId) {
    emoji = useAgentStore.getState().getAgentEmoji(userId, userType);
    const agent = useAgentStore.getState().getAgent(userId);
    if (agent) name = agent.displayName;
  }

  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded ${isOnline ? "bg-green-900 text-green-100" : "bg-gray-600 text-gray-300"}`}>
      <span>{emoji}</span>
      <span className="text-sm font-medium">{name}</span>
      <div className={`w-2 h-2 rounded-full ${isOnline ? "bg-green-400" : "bg-gray-400"}`} />
    </div>
  );
};
