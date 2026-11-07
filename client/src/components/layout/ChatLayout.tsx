import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useChatStore } from "../../stores/chatStore";
import { useSocketStore } from "../../stores/socketStore";
import { useTheme } from "../../contexts/ThemeContext";
import { MessageList } from "../chat/MessageList";
import { MessageInput } from "../chat/MessageInput";
import { TypingIndicator } from "../chat/TypingIndicator";
import { UserList } from "../chat/UserList";
import { ChatHeader } from "../chat/ChatHeader";
import { ThreadSidebar } from "../chat/ThreadSidebar";
import { useThreadStore } from "../../stores/threadStore";
import { jumpToMessageTarget } from "./jumpToMessage";
import type { Message } from "../../types/chat";

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

  const { currentRoom, messages, loadRoom, loadMessages } = useChatStore();
  const { isConnected, typingUsers, addReaction } = useSocketStore();
  const threadView = useThreadStore((s) => s.view);
  const threadsOpen = threadView !== "closed";

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

  // The thread panel follows the room: threads load per room, and leaving the
  // room (or the page) closes the panel.
  useEffect(() => {
    const { setRoom, loadThreads, closePanel } = useThreadStore.getState();
    setRoom(effectiveRoomId);
    void loadThreads(effectiveRoomId);
    return () => closePanel();
  }, [effectiveRoomId]);

  const toggleThreads = () => {
    const { view, openList, closePanel } = useThreadStore.getState();
    if (view === "closed") {
      setUserListOpen(false);
      openList();
    } else {
      closePanel();
    }
  };

  const toggleUserList = () => {
    const next = !userListOpen;
    setUserListOpen(next);
    if (next) useThreadStore.getState().closePanel();
  };

  const replyInThread = (message: Message) => {
    setUserListOpen(false);
    useThreadStore.getState().replyInThread(message);
  };

  const jumpToMessage = async (messageId: string, threadId?: string | null) => {
    const result = await jumpToMessageTarget(effectiveRoomId, messageId, threadId);
    if (result.kind === "thread") {
      setUserListOpen(false);
      setHighlightedMessageId(null);
      return;
    }
    setHighlightedMessageId(result.kind === "message" ? messageId : null);
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
    <main className={`flex flex-col h-full overflow-hidden ${isDark ? "bg-dark-base text-white" : "bg-gray-50 text-gray-900"}`}>
      {/* Chat Header: room info + invite + user list toggle. A <header>
          nested inside the page's <main> is not a banner landmark, so the
          only banner on the page stays AppShell's mobile top bar. */}
      <header className={`px-4 py-2 shrink-0 ${isDark ? "bg-gray-800/80 border-b border-gray-800/60" : "bg-white border-b border-gray-200/60"}`}>
        <ChatHeader
          room={currentRoom}
          onToggleUserList={toggleUserList}
          onToggleThreads={toggleThreads}
          threadsOpen={threadsOpen}
          onJumpToMessage={jumpToMessage}
        />
      </header>

      {/* Messages + Input + User List */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <MessageList
            messages={messages}
            roomId={effectiveRoomId}
            onReact={addReaction}
            highlightedMessageId={highlightedMessageId}
            onReplyInThread={currentRoom?.canSendMessages === false ? undefined : replyInThread}
          />

          {typingUsers.length > 0 && (
            <div className={`px-4 py-1.5 shrink-0 ${isDark ? "border-t border-gray-800/60" : "border-t border-gray-200/60"}`}>
              <TypingIndicator users={typingUsers} />
            </div>
          )}

          <div className={`shrink-0 ${isDark ? "border-t border-gray-800/60" : "border-t border-gray-200/60"}`}>
            <MessageInput
              roomId={effectiveRoomId}
              canSendMessages={currentRoom?.canSendMessages !== false}
            />
          </div>
        </div>

        {threadsOpen && <ThreadSidebar isMobile={isMobile} />}

        {/* Mobile backdrop */}
        {isMobile && userListOpen && (
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs" onClick={() => setUserListOpen(false)} />
        )}

        {/* User List panel */}
        {userListOpen && (
          <div className={[
            isDark ? "bg-gray-800/80 border-l border-gray-800/60" : "bg-white border-l border-gray-200/60",
            isMobile ? "fixed inset-y-0 right-0 z-50 w-64" : "w-56 shrink-0",
          ].join(" ")}>
            <UserList roomId={effectiveRoomId} />
          </div>
        )}
      </div>
    </main>
  );
};
