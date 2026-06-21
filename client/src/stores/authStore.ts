import { create } from 'zustand';
import { useSocketStore } from './socketStore';
import { API_BASE } from '../lib/apiBase';

interface ApiValidationDetail {
  field: string;
  message: string;
}

class ApiRequestError extends Error {
  details: ApiValidationDetail[];

  constructor(message: string, details: ApiValidationDetail[] = []) {
    super(message);
    this.name = 'ApiRequestError';
    this.details = details;
  }
}

async function readApiError(response: Response, fallback: string): Promise<ApiRequestError> {
  try {
    const errorData = await response.json();
    const detailsRaw = Array.isArray(errorData?.details) ? errorData.details : [];
    const details: ApiValidationDetail[] = detailsRaw
      .map((entry: Record<string, unknown> | null) => ({
        field: String(entry?.field || '').trim(),
        message: String(entry?.message || '').trim(),
      }))
      .filter((entry: ApiValidationDetail) => entry.field && entry.message);

    if (details.length > 0) {
      const summary = details.map((entry) => `${entry.field}: ${entry.message}`).join('\n');
      return new ApiRequestError(summary, details);
    }

    return new ApiRequestError(String(errorData?.error || fallback));
  } catch {
    return new ApiRequestError(fallback);
  }
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  userType: 'HUMAN' | 'AI_AGENT' | 'AI_ICE' | 'AI_LAVA' | 'AI_OTHER';
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
  userType: 'HUMAN' | 'AI_AGENT' | 'AI_ICE' | 'AI_LAVA' | 'AI_OTHER';
  aiToken?: string;
}

export interface RegisterData {
  username: string;
  email?: string;
  password?: string;
  displayName: string;
  userType: 'HUMAN' | 'AI_AGENT' | 'AI_ICE' | 'AI_LAVA' | 'AI_OTHER';
  aiToken?: string;
  inviteCode?: string;
}

interface AuthState {
  user: User | null;
  isInitializing: boolean;
  isSubmitting: boolean;
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
  isInitializing: true,
  isSubmitting: false,
  token: localStorage.getItem('triologue_token'),
  error: null,

  login: async (data: LoginData) => {
    set({ isSubmitting: true, error: null });
    
    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) throw await readApiError(response, 'Login failed');

      const { user, token } = await response.json();
      localStorage.setItem('triologue_token', token);
      set({ user, token, isSubmitting: false });
      // Reconnect socket with new token
      useSocketStore.getState().disconnect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      set({ error: errorMessage, isSubmitting: false });
      throw error;
    }
  },

  register: async (data: RegisterData) => {
    set({ isSubmitting: true, error: null });
    
    try {
      const response = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) throw await readApiError(response, 'Registration failed');

      const { user, token } = await response.json();
      localStorage.setItem('triologue_token', token);
      set({ user, token, isSubmitting: false });
      // Reconnect socket with new token
      useSocketStore.getState().disconnect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Registration failed';
      set({ error: errorMessage, isSubmitting: false });
      throw error;
    }
  },

  logout: async () => {
    const token = get().token;
    
    try {
      if (token) {
        await fetch(`${API_BASE}/api/auth/logout`, {
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
      set({ isInitializing: false });
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        const { user } = await response.json();
        set({ user, isInitializing: false });
      } else {
        localStorage.removeItem('triologue_token');
        set({ user: null, token: null, isInitializing: false });
      }
    } catch {
      localStorage.removeItem('triologue_token');
      set({ user: null, token: null, isInitializing: false });
    }
  },

  clearError: () => set({ error: null }),

  getProfile: async () => {
    const token = get().token;
    if (!token) throw new Error('Not authenticated');

    try {
      const response = await fetch(`${API_BASE}/api/auth/profile`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        throw await readApiError(response, 'Failed to fetch profile');
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
      const response = await fetch(`${API_BASE}/api/auth/change-password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      if (!response.ok) {
        throw await readApiError(response, 'Password change failed');
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
    return ['AI_AGENT', 'AI_ICE', 'AI_LAVA', 'AI_OTHER'].includes(state.user?.userType || '');
  }
}));
