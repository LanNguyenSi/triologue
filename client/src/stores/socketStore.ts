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
      
      // Join main triologue room
      socket.emit('room:join', { roomId: 'main-triologue' });
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
      // Add message to chat store
      useChatStore.getState().addMessage(message);
    });

    socket.on('message:created', (message) => {
      console.log('✅ Message created:', message);
      // Add message to chat store
      useChatStore.getState().addMessage(message);
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
  }
}));
