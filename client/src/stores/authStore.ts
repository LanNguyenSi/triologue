import { create } from 'zustand';
import { useSocketStore } from './socketStore';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  userType: 'HUMAN' | 'AI_ICE' | 'AI_LAVA' | 'AI_OTHER';
  isActive: boolean;
  lastSeen: string;
  createdAt: string;
  avatar?: string;
  isAdmin?: boolean;
  canTriggerAI?: boolean;
  _count?: {
    sentMessages: number;
    reactions: number;
  };
}

export interface LoginData {
  username: string;
  password?: string;
  userType: 'HUMAN' | 'AI_ICE' | 'AI_LAVA' | 'AI_OTHER';
  aiToken?: string;
}

export interface RegisterData {
  username: string;
  email?: string;
  password?: string;
  displayName: string;
  userType: 'HUMAN' | 'AI_ICE' | 'AI_LAVA' | 'AI_OTHER';
  aiToken?: string;
  inviteCode?: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  token: string | null;
  error: string | null;
  
  // Actions
  login: (data: LoginData) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  initializeAuth: () => Promise<void>;
  clearError: () => void;
  getProfile: () => Promise<User>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  
  // Getters
  isAuthenticated: () => boolean;
  isHuman: () => boolean;
  isAI: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,
  token: localStorage.getItem('triologue_token'),
  error: null,

  login: async (data: LoginData) => {
    set({ isLoading: true, error: null });
    
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Login failed');
      }

      const { user, token } = await response.json();
      localStorage.setItem('triologue_token', token);
      set({ user, token, isLoading: false });
      // Reconnect socket with new token
      useSocketStore.getState().disconnect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  register: async (data: RegisterData) => {
    set({ isLoading: true, error: null });
    
    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Registration failed');
      }

      const { user, token } = await response.json();
      localStorage.setItem('triologue_token', token);
      set({ user, token, isLoading: false });
      // Reconnect socket with new token
      useSocketStore.getState().disconnect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Registration failed';
      set({ error: errorMessage, isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    const token = get().token;
    
    try {
      if (token) {
        await fetch(`${API_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } catch (error) {
      console.warn('Logout request failed:', error);
    } finally {
      localStorage.removeItem('triologue_token');
      set({ user: null, token: null, error: null });
    }
  },

  initializeAuth: async () => {
    const token = get().token;
    if (!token) {
      set({ isLoading: false });
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const { user } = await response.json();
        set({ user, isLoading: false });
      } else {
        localStorage.removeItem('triologue_token');
        set({ user: null, token: null, isLoading: false });
      }
    } catch (error) {
      localStorage.removeItem('triologue_token');
      set({ user: null, token: null, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),

  getProfile: async () => {
    const token = get().token;
    if (!token) throw new Error('Not authenticated');

    try {
      const response = await fetch(`${API_BASE_URL}/auth/profile`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch profile');
      }

      const user = await response.json();
      set({ user });
      return user;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch profile';
      set({ error: errorMessage });
      throw error;
    }
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const token = get().token;
    if (!token) throw new Error('Not authenticated');

    try {
      const response = await fetch(`${API_BASE_URL}/auth/change-password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Password change failed');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Password change failed';
      set({ error: errorMessage });
      throw error;
    }
  },

  // Getters
  isAuthenticated: () => {
    const state = get();
    return !!state.token && !!state.user;
  },

  isHuman: () => {
    const state = get();
    return state.user?.userType === 'HUMAN';
  },

  isAI: () => {
    const state = get();
    return ['AI_ICE', 'AI_LAVA', 'AI_OTHER'].includes(state.user?.userType || '');
  }
}));