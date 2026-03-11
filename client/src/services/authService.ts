import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  userType: 'HUMAN' | 'AI_AGENT' | 'AI_ICE' | 'AI_LAVA' | 'AI_OTHER';
  isActive: boolean;
  lastSeen: string;
  createdAt: string;
  _count?: {
    sentMessages: number;
    reactions: number;
  };
}

export interface AuthResponse {
  message: string;
  user: User;
  token: string;
}

export interface RegisterData {
  username: string;
  email?: string;
  password?: string;
  displayName: string;
  userType: 'HUMAN' | 'AI_AGENT' | 'AI_ICE' | 'AI_LAVA' | 'AI_OTHER';
  aiToken?: string;
}

export interface LoginData {
  username: string;
  password?: string;
  userType: 'HUMAN' | 'AI_AGENT' | 'AI_ICE' | 'AI_LAVA' | 'AI_OTHER';
  aiToken?: string;
}

class AuthService {
  private token: string | null = null;
  private user: User | null = null;

  constructor() {
    // Load token from localStorage on init
    this.token = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('auth_user');
    if (storedUser) {
      try {
        this.user = JSON.parse(storedUser);
      } catch (e) {
        localStorage.removeItem('auth_user');
      }
    }

    // Set up axios interceptor for auth token
    axios.defaults.baseURL = API_BASE_URL;
    axios.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });

    // Handle 401 responses (token expired)
    axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          this.logout();
        }
        return Promise.reject(error);
      }
    );
  }

  async register(data: RegisterData): Promise<AuthResponse> {
    try {
      const response = await axios.post<AuthResponse>('/auth/register', data);
      this.setAuthData(response.data);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.error || 'Registration failed');
      }
      throw new Error('Registration failed');
    }
  }

  async login(data: LoginData): Promise<AuthResponse> {
    try {
      const response = await axios.post<AuthResponse>('/auth/login', data);
      this.setAuthData(response.data);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.error || 'Login failed');
      }
      throw new Error('Login failed');
    }
  }

  async logout(): Promise<void> {
    try {
      if (this.token) {
        await axios.post('/auth/logout');
      }
    } catch (error) {
      console.warn('Logout request failed:', error);
    } finally {
      this.clearAuthData();
    }
  }

  async verifyToken(): Promise<boolean> {
    if (!this.token) return false;

    try {
      const response = await axios.get<{ valid: boolean; user: User }>('/auth/verify');
      if (response.data.valid) {
        this.user = response.data.user;
        localStorage.setItem('auth_user', JSON.stringify(this.user));
        return true;
      }
    } catch (error) {
      console.warn('Token verification failed:', error);
    }

    this.clearAuthData();
    return false;
  }

  async getProfile(): Promise<User> {
    try {
      const response = await axios.get<User>('/auth/profile');
      this.user = response.data;
      localStorage.setItem('auth_user', JSON.stringify(this.user));
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.error || 'Failed to fetch profile');
      }
      throw new Error('Failed to fetch profile');
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    try {
      await axios.put('/auth/change-password', {
        currentPassword,
        newPassword
      });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.error || 'Password change failed');
      }
      throw new Error('Password change failed');
    }
  }

  private setAuthData(authResponse: AuthResponse): void {
    this.token = authResponse.token;
    this.user = authResponse.user;
    
    localStorage.setItem('auth_token', this.token);
    localStorage.setItem('auth_user', JSON.stringify(this.user));
  }

  private clearAuthData(): void {
    this.token = null;
    this.user = null;
    
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
  }

  // Getters
  getToken(): string | null {
    return this.token;
  }

  getUser(): User | null {
    return this.user;
  }

  isAuthenticated(): boolean {
    return !!this.token && !!this.user;
  }

  isHuman(): boolean {
    return this.user?.userType === 'HUMAN';
  }

  isAI(): boolean {
    return ['AI_AGENT', 'AI_ICE', 'AI_LAVA', 'AI_OTHER'].includes(this.user?.userType || '');
  }
}

// Export singleton instance
export const authService = new AuthService();