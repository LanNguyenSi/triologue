import { create } from "zustand";
import { io, Socket } from "socket.io-client";
import { useChatStore } from "./chatStore";
import { useAuthStore } from "./authStore";
import { useNotificationStore } from "./notificationStore";

interface TypingUser {
  username: string;
  userType: string;
}

interface SocketState {
  socket: Socket | null;
  isConnected: boolean;
  typingUsers: TypingUser[];
  connect: () => void;
  disconnect: () => void;
  sendMessage: (roomId: string, content: string) => boolean;
  startTyping: (roomId: string) => void;
  stopTyping: (roomId: string) => void;
  addReaction: (messageId: string, emoji: string) => void;
  joinRoom: (roomId: string) => void;
}

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  isConnected: false,
  typingUsers: [],

  connect: () => {
    const existing = get().socket;
    if (existing?.connected) return;
    if (existing) existing.disconnect();

    const token = localStorage.getItem("triologue_token");
    if (!token) return;

    const socket = io({
      path: "/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => {
      console.log("🔌 Connected to socket server");
      set({ isConnected: true });
      // Server auto-joins user to all their authorized rooms on socket connect
    });

    socket.on("disconnect", () => {
      console.log("❌ Disconnected from socket server");
      set({ isConnected: false });
    });

    socket.on("connect_error", (error) => {
      console.error("🔴 Socket connection error:", error.message);
    });

    socket.on("message:new", (message) => {
      console.log("📨 New message received:", message);
      const state = useChatStore.getState();
      const currentUser = useAuthStore.getState().user;
      const activeRoomId = state.currentRoom?.id ?? state.currentRoomId;
      const isOwnMessage = currentUser && message.senderId === currentUser.id;
      const pathname = window.location.pathname;
      const roomRouteMatch = pathname.match(/^\/room\/([^/]+)/);
      const visibleRoomId = roomRouteMatch?.[1] ?? null;
      const isViewingSameRoom = visibleRoomId !== null && visibleRoomId === message.roomId;
      if (activeRoomId && message.roomId === activeRoomId) {
        state.addMessage(message);
      }
      // Increment unread for messages from others only when room is not currently open.
      if (message.roomId && !isOwnMessage && !isViewingSameRoom) {
        state.incrementUnread(message.roomId);
      }
      // Browser notification when tab is hidden
      if (document.hidden && Notification.permission === 'granted' && message.sender?.username) {
        const room = state.rooms.find(r => r.id === message.roomId);
        new Notification(`${message.sender.displayName || message.sender.username}`, {
          body: message.content?.substring(0, 120) || '',
          tag: message.id,
          icon: '/favicon.svg',
        });
      }
    });

    socket.on("message:created", (message) => {
      console.log("✅ Message created:", message);
      const state = useChatStore.getState();
      const currentUser = useAuthStore.getState().user;
      const activeRoomId = state.currentRoom?.id ?? state.currentRoomId;
      const isOwnMessage = currentUser && message.senderId === currentUser.id;
      const pathname = window.location.pathname;
      const roomRouteMatch = pathname.match(/^\/room\/([^/]+)/);
      const visibleRoomId = roomRouteMatch?.[1] ?? null;
      const isViewingSameRoom = visibleRoomId !== null && visibleRoomId === message.roomId;
      if (activeRoomId && message.roomId === activeRoomId) {
        state.addMessage(message);
      }
      if (message.roomId && !isOwnMessage && !isViewingSameRoom) {
        state.incrementUnread(message.roomId);
      }
    });

    // Reactions
    socket.on(
      "reaction:added",
      (data: {
        messageId: string;
        emoji?: string;
        userId?: string;
        reaction?: { emoji?: string; userId?: string };
      }) => {
        console.log("👍 Reaction added:", data);
        const emoji = data.emoji ?? data.reaction?.emoji;
        const userId = data.userId ?? data.reaction?.userId;
        if (!emoji || !userId) return;
        useChatStore.getState().addReaction(data.messageId, { emoji, userId });
      },
    );

    socket.on(
      "reaction:removed",
      (data: { messageId: string; emoji: string; userId: string }) => {
        console.log("👎 Reaction removed:", data);
        useChatStore
          .getState()
          .removeReaction(data.messageId, data.emoji, data.userId);
      },
    );

    socket.on(
      "message:deleted",
      (data: { messageId: string; roomId: string }) => {
        console.log("🗑️ Message deleted:", data);
        useChatStore.getState().deleteMessage(data.messageId);
      },
    );

    socket.on("typing:update", (data) => {
      set((state) => {
        const otherUsers = state.typingUsers.filter(
          (u) => u.username !== data.username,
        );
        return {
          typingUsers: data.isTyping ? [...otherUsers, data] : otherUsers,
        };
      });
    });

    socket.on("inbox:new", (item) => {
      useNotificationStore.getState().upsertServerItem(item);
    });

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
      set({ socket: null, isConnected: false, typingUsers: [] });
    }
  },

  sendMessage: (roomId: string, content: string) => {
    const { socket } = get();
    if (socket?.connected) {
      socket.emit("message:send", { roomId, content });
      return true;
    }
    return false;
  },

  startTyping: (roomId: string) => {
    const { socket } = get();
    if (socket && socket.connected) {
      socket.emit("typing:start", { roomId });
    }
  },

  stopTyping: (roomId: string) => {
    const { socket } = get();
    if (socket && socket.connected) {
      socket.emit("typing:stop", { roomId });
    }
  },

  addReaction: (messageId: string, emoji: string) => {
    const { socket } = get();
    if (socket && socket.connected) {
      socket.emit("reaction:add", { messageId, emoji });
    }
  },

  joinRoom: (roomId: string) => {
    const { socket } = get();
    if (socket && socket.connected) {
      socket.emit("room:join", { roomId });
    }
  },
}));
