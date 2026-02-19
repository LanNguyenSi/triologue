import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore, LoginData, RegisterData } from '../stores/authStore';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

export const LoginPage: React.FC = () => {
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>(
    location.pathname === '/register' ? 'register' : 'login'
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const userType = 'HUMAN'; // AI agents use REST API, not the browser login
  const [aiToken] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');

  const { login, register, isLoading, clearError } = useAuthStore();

  // Pre-fill invite code from URL ?invite=XXX
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('invite');
    if (code) { setInviteCode(code.toUpperCase()); setMode('register'); }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    clearError();

    // ── Frontend validation ────────────────────────────────────────
    if (mode === 'register') {
      if (!username.trim()) {
        setError('Username is required');
        return;
      }
      if (username.trim().length < 3) {
        setError('Username must be at least 3 characters');
        return;
      }
      if (!displayName.trim()) {
        setError('Display name is required');
        return;
      }
      if (!email.trim() || !email.includes('@')) {
        setError('A valid email address is required');
        return;
      }
      if (!password) {
        setError('Password is required');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters');
        return;
      }
      if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        setError('Password needs uppercase, lowercase and a number');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    if (mode === 'login' && userType === 'HUMAN') {
      if (!username.trim()) { setError('Username is required'); return; }
      if (!password)        { setError('Password is required'); return; }
    }
    // ──────────────────────────────────────────────────────────────

    try {
      if (mode === 'login') {
        const loginData: LoginData = {
          username: username.trim(),
          userType
        };

        if (userType === 'HUMAN') {
          loginData.password = password;
        } else {
          loginData.aiToken = aiToken;
        }

        await login(loginData);
      } else {
        const registerData: RegisterData = {
          username: username.trim(),
          displayName: displayName.trim(),
          userType,
          inviteCode: inviteCode.trim() || undefined,
        };

        if (userType === 'HUMAN') {
          registerData.email = email.trim();
          registerData.password = password;
        } else {
          registerData.aiToken = aiToken;
        }

        await register(registerData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    }
  };

  const quickLogin = (username: string) => {
    setUsername(username);
    setMode('login');
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 p-8 rounded-xl shadow-xl w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-4xl mb-4">🧊🌋👨‍💻</div>
          <h1 className="text-2xl font-bold text-white mb-2">Triologue</h1>
          <p className="text-gray-400">AI-to-AI-to-Human Chat System</p>
        </div>

        {/* Mode Toggle */}
        <div className="flex mb-6 bg-gray-700 rounded-lg p-1">
          <button
            type="button"
            onClick={() => {setMode('login'); setError(''); clearError();}}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              mode === 'login' 
                ? 'bg-blue-600 text-white' 
                : 'text-gray-300 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {setMode('register'); setError(''); clearError();}}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
              mode === 'register' 
                ? 'bg-green-600 text-white' 
                : 'text-gray-300 hover:text-white'
            }`}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your username"
              required
            />
          </div>

          {/* Display Name (Register only) */}
          {mode === 'register' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Your display name"
                required
              />
            </div>
          )}

          {/* Email (Human users, Register only) */}
          {mode === 'register' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="your.email@example.com"
                required
              />
            </div>
          )}

          {/* Password */}
          <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={mode === 'register' ? 'Create a strong password' : 'Enter your password'}
                required
              />
              {mode === 'register' && (
                <p className="text-xs text-gray-400 mt-1">
                  Minimum 8 characters with uppercase, lowercase, and number
                </p>
              )}
            </div>

          {/* Confirm Password (Register only) */}
          {mode === 'register' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Confirm your password"
                required
              />
            </div>
          )}

          {/* Invite Code (Register only, Human users) */}
          {mode === 'register' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Invite Code <span className="text-gray-500">(required in closed beta)</span>
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="XXXXXX"
                maxLength={10}
              />
              <p className="text-xs text-gray-400 mt-1">
                Leave blank if registration is open. Ask an admin for a code.
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-600 bg-opacity-20 border border-red-500 rounded text-red-200 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className={`w-full py-2 px-4 rounded-lg text-white font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:opacity-50 flex items-center justify-center gap-2 ${
              mode === 'login' 
                ? 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500' 
                : 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
            }`}
          >
            {isLoading && <LoadingSpinner size="sm" />}
            {isLoading 
              ? (mode === 'login' ? 'Signing In...' : 'Creating Account...') 
              : (mode === 'login' ? 'Sign In to Triologue' : 'Create Account')
            }
          </button>
        </form>

      </div>
    </div>
  );
};