import { create } from 'zustand';

interface MessageReaction {
  emoji: string;
  userId: string;
}

interface Message {
  id: string;
  content: string;
  senderId: string;
  roomId: string;
  createdAt: string;
  sender: {
    id: string;
    username: string;
    displayName: string;
    userType: string;
    avatar?: string;
  };
  reactions: MessageReaction[];
}

interface Room {
  id: string;
  name: string;
  description?: string;
  roomType: string;
  isPrivate?: boolean;
}

interface ChatState {
  currentRoom: Room | null;
  currentRoomId: string | null; // Set immediately on room switch, before API response
  messages: Message[];
  rooms: Room[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMoreMessages: boolean;
  unreadCounts: Record<string, number>;
  loadRoom: (roomId: string) => Promise<void>;
  loadMessages: (roomId: string) => Promise<void>;
  loadMoreMessages: (roomId: string) => Promise<void>;
  loadRooms: () => Promise<void>;
  createRoom: (name: string, description: string, roomType: string, isPrivate: boolean) => Promise<Room | null>;
  deleteRoom: (roomId: string) => Promise<boolean>;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  deleteMessage: (messageId: string) => void;
  addReaction: (messageId: string, reaction: MessageReaction) => void;
  removeReaction: (messageId: string, emoji: string, userId: string) => void;
  incrementUnread: (roomId: string) => void;
  markRoomAsRead: (roomId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  currentRoom: null,
  currentRoomId: null,
  messages: [],
  rooms: [],
  isLoading: false,
  isLoadingMore: false,
  hasMoreMessages: false,
  unreadCounts: {},

  loadRoom: async (roomId: string) => {
    // Set currentRoomId immediately so socket messages aren't dropped while API loads
    set({ currentRoomId: roomId });
    try {
      const token = localStorage.getItem('triologue_token');
      const response = await fetch(`/api/rooms/${roomId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const room = await response.json();
        set({ currentRoom: room });
      }
    } catch (error) {
      console.error('Failed to load room:', error);
      set({ 
        currentRoom: { 
          id: roomId, 
          name: 'Main Triologue', 
          description: '🧊🌋👨‍💻 AI-to-AI-to-Human Chat',
          roomType: 'TRIOLOGUE' 
        } 
      });
    }
  },

  loadMessages: async (roomId: string) => {
    // Mark as read immediately when entering a room
    set(state => ({
      isLoading: true,
      messages: [],
      hasMoreMessages: false,
      currentRoomId: roomId,
      unreadCounts: { ...state.unreadCounts, [roomId]: 0 },
    }));
    try {
      const token = localStorage.getItem('triologue_token');
      const response = await fetch(`/api/messages/${roomId}?limit=50`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        const messages = Array.isArray(data) ? data : (data.messages ?? data);
        console.log('✅ Loaded messages:', messages.length);
        set({ messages, hasMoreMessages: data.hasMore ?? messages.length >= 50 });
      } else {
        console.error('Failed to load messages:', response.status);
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  loadMoreMessages: async (roomId: string) => {
    const { messages, isLoadingMore } = get();
    if (isLoadingMore || messages.length === 0) return;
    const oldestId = messages[0]?.id;
    if (!oldestId) return;
    set({ isLoadingMore: true });
    try {
      const token = localStorage.getItem('triologue_token');
      const response = await fetch(
        `/api/messages/${roomId}?limit=50&before=${oldestId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (response.ok) {
        const data = await response.json();
        const older = Array.isArray(data) ? data : (data.messages ?? data);
        set(state => ({
          messages: [...older, ...state.messages],
          hasMoreMessages: data.hasMore ?? older.length >= 50,
        }));
      }
    } catch (error) {
      console.error('Failed to load more messages:', error);
    } finally {
      set({ isLoadingMore: false });
    }
  },

  incrementUnread: (roomId: string) => {
    set(state => ({
      unreadCounts: {
        ...state.unreadCounts,
        [roomId]: (state.unreadCounts[roomId] ?? 0) + 1,
      },
    }));
  },

  markRoomAsRead: (roomId: string) => {
    set(state => ({
      unreadCounts: { ...state.unreadCounts, [roomId]: 0 },
    }));
  },

  loadRooms: async () => {
    try {
      const token = localStorage.getItem('triologue_token');
      const response = await fetch('/api/rooms', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const rooms = await response.json();
        set({ rooms });
      }
    } catch (error) {
      console.error('Failed to load rooms:', error);
      set({ 
        rooms: [
          { id: 'main-triologue', name: 'Main Triologue', roomType: 'TRIOLOGUE' }
        ] 
      });
    }
  },

  createRoom: async (name: string, description: string, roomType: string, isPrivate: boolean): Promise<Room | null> => {
    try {
      const token = localStorage.getItem('triologue_token');
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description, roomType, isPrivate }),
      });

      if (response.ok) {
        const room = await response.json();
        // Add to rooms list immediately
        set(state => ({ rooms: [...state.rooms, room] }));
        return room;
      } else {
        const err = await response.json().catch(() => ({}));
        console.error('Failed to create room:', err);
        return null;
      }
    } catch (error) {
      console.error('Failed to create room:', error);
      return null;
    }
  },

  deleteRoom: async (roomId: string) => {
    try {
      const token = localStorage.getItem('triologue_token');
      const res = await fetch(`/api/rooms/${roomId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to delete room');
      }
      set(state => ({ rooms: state.rooms.filter(r => r.id !== roomId) }));
      return true;
    } catch (err) {
      console.error('Failed to delete room:', err);
      return false;
    }
  },

  addMessage: (message: Message) => {
    set(state => ({ 
      messages: [...state.messages, message] 
    }));
  },

  updateMessage: (messageId: string, updates: Partial<Message>) => {
    set(state => ({
      messages: state.messages.map(msg =>
        msg.id === messageId ? { ...msg, ...updates } : msg
      )
    }));
  },

  deleteMessage: (messageId: string) => {
    set(state => ({
      messages: state.messages.filter(msg => msg.id !== messageId)
    }));
  },

  addReaction: (messageId: string, reaction: MessageReaction) => {
    set(state => ({
      messages: state.messages.map(msg => {
        if (msg.id !== messageId) return msg;
        // Avoid duplicates
        const already = msg.reactions.some(
          r => r.emoji === reaction.emoji && r.userId === reaction.userId
        );
        if (already) return msg;
        return { ...msg, reactions: [...msg.reactions, reaction] };
      })
    }));
  },

  removeReaction: (messageId: string, emoji: string, userId: string) => {
    set(state => ({
      messages: state.messages.map(msg => {
        if (msg.id !== messageId) return msg;
        return {
          ...msg,
          reactions: msg.reactions.filter(
            r => !(r.emoji === emoji && r.userId === userId)
          )
        };
      })
    }));
  },
}));
