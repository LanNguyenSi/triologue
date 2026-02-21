import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useChatStore } from "../../stores/chatStore";
import { useSocketStore } from "../../stores/socketStore";
import { useAuthStore } from "../../stores/authStore";
import { useAgentStore } from "../../stores/agentStore";
import { useTheme } from "../../contexts/ThemeContext";
import { Sidebar } from "./Sidebar";
import { ChatHeader } from "../chat/ChatHeader";
import { MessageList } from "../chat/MessageList";
import { MessageInput } from "../chat/MessageInput";
import { TypingIndicator } from "../chat/TypingIndicator";
import { UserList } from "../chat/UserList";

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
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.innerWidth >= 768,
  );
  const [userListOpen, setUserListOpen] = useState(false);

  const { currentRoom, messages, loadRoom, loadMessages } = useChatStore();

  const { socket, isConnected, typingUsers, connect, disconnect, addReaction } =
    useSocketStore();

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // Close sidebar automatically when switching to mobile
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
      setUserListOpen(false);
    }
  }, [isMobile]);

  // Default to main triologue room if no roomId
  const effectiveRoomId = roomId || "main-triologue";

  // Load room details when roomId or socket connection changes
  useEffect(() => {
    if (effectiveRoomId && isConnected) {
      loadRoom(effectiveRoomId);
    }
  }, [effectiveRoomId, isConnected, loadRoom]);

  // Load messages only when roomId changes — NOT on every socket reconnect
  // (socket state doesn't affect REST API; re-triggering causes message flicker)
  useEffect(() => {
    if (effectiveRoomId) {
      loadMessages(effectiveRoomId);
    }
  }, [effectiveRoomId, loadMessages]);

  return (
    <div
      className={`flex h-screen overflow-hidden ${
        theme === "dark" ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-900"
      }`}
    >
      {/* ── Mobile backdrop: sidebar ── */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Mobile backdrop: user list ── */}
      {isMobile && userListOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setUserListOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <div
        className={[
          "transition-all duration-300 ease-in-out overflow-hidden",
          theme === "dark"
            ? "bg-gray-800 border-r border-gray-700"
            : "bg-white border-r border-gray-200",
          isMobile
            ? `fixed inset-y-0 left-0 z-50 ${sidebarOpen ? "w-72" : "w-0"}`
            : `${sidebarOpen ? "w-64" : "w-0"}`,
        ].join(" ")}
      >
        <div className="w-72 md:w-64 h-full">
          <Sidebar onToggle={() => setSidebarOpen(false)} />
        </div>
      </div>

      {/* ── Main Chat Area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat Header */}
        <div
          className={`px-4 py-3 flex-shrink-0 ${
            theme === "dark"
              ? "bg-gray-800 border-b border-gray-700"
              : "bg-white border-b border-gray-200"
          }`}
        >
          <ChatHeader
            room={currentRoom}
            onToggleSidebar={() => setSidebarOpen((o) => !o)}
            onToggleUserList={() => setUserListOpen((o) => !o)}
          />
        </div>

        {/* Messages Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Message List + Input */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <MessageList
              messages={messages}
              roomId={effectiveRoomId}
              onReact={addReaction}
            />

            {/* Typing Indicator */}
            {typingUsers.length > 0 && (
              <div
                className={`px-4 py-2 flex-shrink-0 ${
                  theme === "dark"
                    ? "border-t border-gray-700"
                    : "border-t border-gray-200"
                }`}
              >
                <TypingIndicator users={typingUsers} />
              </div>
            )}

            {/* Message Input */}
            <div
              className={`flex-shrink-0 ${
                theme === "dark"
                  ? "border-t border-gray-700"
                  : "border-t border-gray-200"
              }`}
            >
              <MessageInput roomId={effectiveRoomId} />
            </div>
          </div>

          {/* ── User List ── */}
          {userListOpen && (
            <div
              className={[
                theme === "dark"
                  ? "bg-gray-800 border-l border-gray-700"
                  : "bg-white border-l border-gray-200",
                isMobile
                  ? "fixed inset-y-0 right-0 z-50 w-72"
                  : "w-64 flex-shrink-0",
              ].join(" ")}
            >
              <UserList roomId={effectiveRoomId} />
            </div>
          )}
        </div>
      </div>

      {/* ── Connection Status ── */}
      {!isConnected && (
        <div className="fixed top-4 right-4 z-50 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-red-300 rounded-full animate-pulse" />
            Reconnecting...
          </div>
        </div>
      )}
    </div>
  );
};

// AI User Status Indicators
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
    <div
      className={`flex items-center gap-2 px-2 py-1 rounded ${
        isOnline ? "bg-green-900 text-green-100" : "bg-gray-600 text-gray-300"
      }`}
    >
      <span>{emoji}</span>
      <span className="text-sm font-medium">{name}</span>
      <div
        className={`w-2 h-2 rounded-full ${isOnline ? "bg-green-400" : "bg-gray-400"}`}
      />
    </div>
  );
};
