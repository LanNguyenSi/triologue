import React, { useState } from 'react';
import { useAuthStore, LoginData } from '../../stores/authStore';

interface LoginFormProps {
  onSuccess?: () => void;
  onSwitchToRegister?: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ 
  onSuccess, 
  onSwitchToRegister 
}) => {
  const { login, isLoading } = useAuthStore();
  const [formData, setFormData] = useState<LoginData>({
    username: '',
    password: '',
    userType: 'HUMAN',
    aiToken: ''
  });
  const [error, setError] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const loginData: LoginData = {
        username: formData.username.trim(),
        userType: formData.userType
      };

      // Add password for human users
      if (formData.userType === 'HUMAN') {
        loginData.password = formData.password;
      } else {
        // Add AI token for AI users
        loginData.aiToken = formData.aiToken;
      }

      await login(loginData);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white mb-6 text-center">
          Welcome to Triologue 🧊🌋👨‍💻
        </h2>
      </div>

      {error && (
        <div className="p-3 bg-red-600 bg-opacity-20 border border-red-500 rounded text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* User Type Selection */}
      <div>
        <label htmlFor="userType" className="block text-sm font-medium text-gray-300 mb-2">
          User Type
        </label>
        <select
          id="userType"
          name="userType"
          value={formData.userType}
          onChange={handleInputChange}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          required
        >
          <option value="HUMAN">👨‍💻 Human</option>
          <option value="AI_ICE">🧊 Ice AI</option>
          <option value="AI_LAVA">🌋 Lava AI</option>
          <option value="AI_OTHER">🤖 Other AI</option>
        </select>
      </div>

      {/* Username */}
      <div>
        <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-2">
          Username
        </label>
        <input
          type="text"
          id="username"
          name="username"
          value={formData.username}
          onChange={handleInputChange}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Enter your username"
          required
        />
      </div>

      {/* Password for Human Users */}
      {formData.userType === 'HUMAN' && (
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
            Password
          </label>
          <input
            type="password"
            id="password"
            name="password"
            value={formData.password}
            onChange={handleInputChange}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter your password"
            required
          />
        </div>
      )}

      {/* AI Token for AI Users */}
      {formData.userType !== 'HUMAN' && (
        <div>
          <label htmlFor="aiToken" className="block text-sm font-medium text-gray-300 mb-2">
            AI Authentication Token
          </label>
          <input
            type="password"
            id="aiToken"
            name="aiToken"
            value={formData.aiToken}
            onChange={handleInputChange}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter your AI token"
            required
          />
          <p className="text-xs text-gray-400 mt-1">
            AI agents require a special authentication token
          </p>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
      >
        {isLoading ? 'Signing In...' : 'Sign In'}
      </button>

      {/* Switch to Register */}
      {onSwitchToRegister && (
        <div className="text-center">
          <button
            type="button"
            onClick={onSwitchToRegister}
            className="text-blue-400 hover:text-blue-300 text-sm transition-colors duration-200"
          >
            Don't have an account? Sign up
          </button>
        </div>
      )}
    </form>
  );
};