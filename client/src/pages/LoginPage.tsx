import React, { useState } from 'react';
import { useAuthStore, LoginData, RegisterData } from '../stores/authStore';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

export const LoginPage: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [userType, setUserType] = useState<'HUMAN' | 'AI_ICE' | 'AI_LAVA' | 'AI_OTHER'>('HUMAN');
  const [aiToken, setAiToken] = useState('');
  const [error, setError] = useState('');

  const { login, register, isLoading, clearError } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    clearError();

    if (mode === 'register' && userType === 'HUMAN' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

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
          userType
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

  const quickLogin = (type: 'HUMAN' | 'AI_LAVA' | 'AI_ICE') => {
    if (type === 'HUMAN') {
      setUsername('lan');
      setUserType('HUMAN');
      setMode('login');
    } else if (type === 'AI_LAVA') {
      setUsername('lava');
      setUserType('AI_LAVA');
      setMode('login');
    } else if (type === 'AI_ICE') {
      setUsername('ice');
      setUserType('AI_ICE');
      setMode('login');
    }
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
          {/* User Type */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              User Type
            </label>
            <select
              value={userType}
              onChange={(e) => setUserType(e.target.value as any)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="HUMAN">👨‍💻 Human</option>
              <option value="AI_LAVA">🌋 Lava AI</option>
              <option value="AI_ICE">🧊 Ice AI</option>
              <option value="AI_OTHER">🤖 Other AI</option>
            </select>
          </div>

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
          {mode === 'register' && userType === 'HUMAN' && (
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

          {/* Password (Human users) */}
          {userType === 'HUMAN' && (
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
          )}

          {/* Confirm Password (Human users, Register only) */}
          {mode === 'register' && userType === 'HUMAN' && (
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

          {/* AI Token (AI users) */}
          {userType !== 'HUMAN' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                AI Authentication Token
              </label>
              <input
                type="password"
                value={aiToken}
                onChange={(e) => setAiToken(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your AI token"
                required
              />
              <p className="text-xs text-gray-400 mt-1">
                AI agents require a special authentication token
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

        {/* Quick Login - Show only in login mode */}
        {mode === 'login' && (
          <div className="mt-6">
            <div className="text-sm text-gray-400 mb-2">Quick Login:</div>
            <div className="flex gap-2">
              <button
                onClick={() => quickLogin('HUMAN')}
                className="px-3 py-1 bg-gray-700 text-white rounded text-xs hover:bg-gray-600 transition-colors"
              >
                👨‍💻 Human
              </button>
              <button
                onClick={() => quickLogin('AI_LAVA')}
                className="px-3 py-1 bg-gray-700 text-white rounded text-xs hover:bg-gray-600 transition-colors"
              >
                🌋 Lava
              </button>
              <button
                onClick={() => quickLogin('AI_ICE')}
                className="px-3 py-1 bg-gray-700 text-white rounded text-xs hover:bg-gray-600 transition-colors"
              >
                🧊 Ice
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};