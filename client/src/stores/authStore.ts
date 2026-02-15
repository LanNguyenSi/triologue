import { create } from 'zustand';

interface User {
  id: string;
  username: string;
  displayName: string;
  userType: string;
  avatar?: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  token: string | null;
  login: (username: string, password: string, userType?: string) => Promise<void>;
  logout: () => void;
  initializeAuth: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,
  token: localStorage.getItem('triologue_token'),

  login: async (username: string, password: string, userType = 'HUMAN') => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, userType })
      });

      if (!response.ok) {
        throw new Error('Login failed');
      }

      const { user, token } = await response.json();
      localStorage.setItem('triologue_token', token);
      set({ user, token });
    } catch (error) {
      throw error;
    }
  },

  logout: () => {
    localStorage.removeItem('triologue_token');
    set({ user: null, token: null });
  },

  initializeAuth: async () => {
    const token = get().token;
    if (!token) {
      set({ isLoading: false });
      return;
    }

    try {
      const response = await fetch('/api/auth/verify', {
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
  }
}));