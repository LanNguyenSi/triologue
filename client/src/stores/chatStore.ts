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
  loadRoom: (roomId: string) => Promise<void>;
  loadMessages: (roomId: string) => Promise<void>;
  loadRooms: () => Promise<void>;
  createRoom: (name: string, description: string, roomType: string, isPrivate: boolean) => Promise<Room | null>;
  deleteRoom: (roomId: string) => Promise<boolean>;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  addReaction: (messageId: string, reaction: MessageReaction) => void;
  removeReaction: (messageId: string, emoji: string, userId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  currentRoom: null,
  currentRoomId: null,
  messages: [],
  rooms: [],
  isLoading: false,

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
    try {
      set({ isLoading: true, messages: [] }); // B6: clear old messages immediately
      const token = localStorage.getItem('triologue_token');
      const response = await fetch(`/api/rooms/${roomId}/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const messages = await response.json();
        console.log('✅ Loaded messages:', messages.length);
        set({ messages });
      } else {
        console.error('Failed to load messages:', response.status);
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      set({ isLoading: false });
    }
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
