import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

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
}

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  isConnected: false,
  typingUsers: [],

  connect: () => {
    const token = localStorage.getItem('triologue_token');
    if (!token) return;

    const socket = io(process.env.VITE_SOCKET_URL || 'http://localhost:4001', {
      auth: { token }
    });

    socket.on('connect', () => {
      console.log('🔌 Connected to socket server');
      set({ isConnected: true });
    });

    socket.on('disconnect', () => {
      console.log('❌ Disconnected from socket server');
      set({ isConnected: false });
    });

    socket.on('message:new', (message) => {
      // Add message to chat store
      // This would integrate with useChatStore
      console.log('📨 New message:', message);
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
      socket.emit('message:send', { roomId, content });
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
  }
}));