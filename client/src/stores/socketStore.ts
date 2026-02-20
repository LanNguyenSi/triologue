import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { useChatStore } from './chatStore';

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
  sendMessage: (roomId: string, content: string) => void;
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
    const token = localStorage.getItem('triologue_token');
    if (!token) {
      console.error('❌ No auth token found');
      return;
    }

    // Use relative path for socket.io (goes through nginx proxy)
    const socket = io({
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      console.log('🔌 Connected to socket server');
      set({ isConnected: true });
      // Server auto-joins user to all their authorized rooms on socket connect
    });

    socket.on('disconnect', () => {
      console.log('❌ Disconnected from socket server');
      set({ isConnected: false });
    });

    socket.on('connect_error', (error) => {
      console.error('🔴 Socket connection error:', error.message);
    });

    socket.on('message:new', (message) => {
      console.log('📨 New message received:', message);
      const state = useChatStore.getState();
      const activeRoomId = state.currentRoom?.id ?? state.currentRoomId;
      if (activeRoomId && message.roomId === activeRoomId) {
        state.addMessage(message);
      } else if (message.roomId) {
        // Message is for a different room — increment unread badge
        state.incrementUnread(message.roomId);
      }
    });

    socket.on('message:created', (message) => {
      console.log('✅ Message created:', message);
      const state = useChatStore.getState();
      const activeRoomId = state.currentRoom?.id ?? state.currentRoomId;
      if (activeRoomId && message.roomId === activeRoomId) {
        state.addMessage(message);
      } else if (message.roomId) {
        // Message is for a different room — increment unread badge
        state.incrementUnread(message.roomId);
      }
    });

    // Reactions
    socket.on('reaction:added', (data: { messageId: string; emoji: string; userId: string }) => {
      console.log('👍 Reaction added:', data);
      useChatStore.getState().addReaction(data.messageId, { emoji: data.emoji, userId: data.userId });
    });

    socket.on('reaction:removed', (data: { messageId: string; emoji: string; userId: string }) => {
      console.log('👎 Reaction removed:', data);
      useChatStore.getState().removeReaction(data.messageId, data.emoji, data.userId);
    });

    socket.on('message:deleted', (data: { messageId: string; roomId: string }) => {
      console.log('🗑️ Message deleted:', data);
      useChatStore.getState().deleteMessage(data.messageId);
    });

    socket.on('typing:update', (data) => {
      set(state => {
        const otherUsers = state.typingUsers.filter(u => u.username !== data.username);
        return {
          typingUsers: data.isTyping ? [...otherUsers, data] : otherUsers
        };
      });
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
    if (socket && socket.connected) {
      console.log('📤 Sending message:', { roomId, content });
      socket.emit('message:send', { roomId, content });
    } else {
      console.error('❌ Socket not connected');
    }
  },

  startTyping: (roomId: string) => {
    const { socket } = get();
    if (socket && socket.connected) {
      socket.emit('typing:start', { roomId });
    }
  },

  stopTyping: (roomId: string) => {
    const { socket } = get();
    if (socket && socket.connected) {
      socket.emit('typing:stop', { roomId });
    }
  },

  addReaction: (messageId: string, emoji: string) => {
    const { socket } = get();
    if (socket && socket.connected) {
      socket.emit('reaction:add', { messageId, emoji });
    }
  },

  joinRoom: (roomId: string) => {
    const { socket } = get();
    if (socket && socket.connected) {
      socket.emit('room:join', { roomId });
    }
  },
}));
