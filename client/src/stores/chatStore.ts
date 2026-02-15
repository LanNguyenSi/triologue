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
      // Fallback to basic room data
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
      set({ isLoading: true });
      const token = localStorage.getItem('triologue_token');
      
      // Fixed: correct API endpoint
      const response = await fetch(`/api/messages/${roomId}`, {
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
      // Fallback
      set({ 
        rooms: [
          { id: 'main-triologue', name: 'Main Triologue', roomType: 'TRIOLOGUE' }
        ] 
      });
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
  }
}));
