import { create } from 'zustand';

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
  reactions: any[];
}

interface Room {
  id: string;
  name: string;
  description?: string;
  roomType: string;
}

interface ChatState {
  currentRoom: Room | null;
  messages: Message[];
  rooms: Room[];
  isLoading: boolean;
  loadRoom: (roomId: string) => Promise<void>;
  loadMessages: (roomId: string) => Promise<void>;
  loadRooms: () => Promise<void>;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  currentRoom: null,
  messages: [],
  rooms: [],
  isLoading: false,

  loadRoom: async (roomId: string) => {
    // Mock implementation - replace with actual API call
    set({ 
      currentRoom: { 
        id: roomId, 
        name: 'Triologue Chat', 
        roomType: 'TRIOLOGUE' 
      } 
    });
  },

  loadMessages: async (roomId: string) => {
    try {
      set({ isLoading: true });
      const token = localStorage.getItem('triologue_token');
      
      const response = await fetch(`/api/messages/${roomId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const messages = await response.json();
        set({ messages });
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  loadRooms: async () => {
    // Mock implementation
    set({ 
      rooms: [
        { id: 'main-triologue', name: 'Main Triologue', roomType: 'TRIOLOGUE' }
      ] 
    });
  },

  addMessage: (message: Message) => {
    set(state => ({ messages: [...state.messages, message] }));
  },

  updateMessage: (messageId: string, updates: Partial<Message>) => {
    set(state => ({
      messages: state.messages.map(msg =>
        msg.id === messageId ? { ...msg, ...updates } : msg
      )
    }));
  }
}));