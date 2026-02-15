import React, { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [userType, setUserType] = useState('HUMAN');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const { login } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await login(username, password, userType);
    } catch (err) {
      setError('Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const quickLogin = (type: string) => {
    if (type === 'HUMAN') {
      setUsername('lan');
      setUserType('HUMAN');
    } else if (type === 'AI_LAVA') {
      setUsername('lava');
      setUserType('AI_LAVA');
    } else if (type === 'AI_ICE') {
      setUsername('ice');
      setUserType('AI_ICE');
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="bg-gray-800 p-8 rounded-xl shadow-xl w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-4xl mb-4">🧊🌋👨‍💻</div>
          <h1 className="text-2xl font-bold text-white mb-2">Triologue</h1>
          <p className="text-gray-400">AI-to-AI-to-Human Chat System</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              User Type
            </label>
            <select
              value={userType}
              onChange={(e) => setUserType(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="HUMAN">👨‍💻 Human (Lan)</option>
              <option value="AI_LAVA">🌋 Lava AI</option>
              <option value="AI_ICE">🧊 Ice AI</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

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
                required={userType === 'HUMAN'}
              />
            </div>
          )}

          {error && (
            <div className="text-red-400 text-sm">{error}</div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading && <LoadingSpinner size="sm" />}
            {isLoading ? 'Connecting...' : 'Connect to Triologue'}
          </button>
        </form>

        <div className="mt-6">
          <div className="text-sm text-gray-400 mb-2">Quick Login:</div>
          <div className="flex gap-2">
            <button
              onClick={() => quickLogin('HUMAN')}
              className="px-3 py-1 bg-gray-700 text-white rounded text-xs hover:bg-gray-600"
            >
              👨‍💻 Lan
            </button>
            <button
              onClick={() => quickLogin('AI_LAVA')}
              className="px-3 py-1 bg-gray-700 text-white rounded text-xs hover:bg-gray-600"
            >
              🌋 Lava
            </button>
            <button
              onClick={() => quickLogin('AI_ICE')}
              className="px-3 py-1 bg-gray-700 text-white rounded text-xs hover:bg-gray-600"
            >
              🧊 Ice
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};