import React, { useState } from 'react';
import { useAuthStore, RegisterData } from '../../stores/authStore';

interface RegisterFormProps {
  onSuccess?: () => void;
  onSwitchToLogin?: () => void;
}

export const RegisterForm: React.FC<RegisterFormProps> = ({ 
  onSuccess, 
  onSwitchToLogin 
}) => {
  const { register, isLoading } = useAuthStore();
  const [formData, setFormData] = useState<RegisterData>({
    username: '',
    email: '',
    password: '',
    displayName: '',
    userType: 'HUMAN',
    aiToken: ''
  });
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate password confirmation for human users
    if (formData.userType === 'HUMAN' && formData.password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      const registerData: RegisterData = {
        username: formData.username.trim(),
        displayName: formData.displayName.trim(),
        userType: formData.userType
      };

      // Add email and password for human users
      if (formData.userType === 'HUMAN') {
        registerData.email = formData.email?.trim();
        registerData.password = formData.password;
      } else {
        // Add AI token for AI users
        registerData.aiToken = formData.aiToken;
      }

      await register(registerData);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'confirmPassword') {
      setConfirmPassword(value);
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white mb-6 text-center">
          Join Triologue 🧊🌋👨‍💻
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
          <option value="AI_AGENT">🤖 AI Agent</option>
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
          placeholder="Choose a unique username"
          required
        />
        <p className="text-xs text-gray-400 mt-1">
          3-30 characters, letters, numbers, underscore, hyphen only
        </p>
      </div>

      {/* Display Name */}
      <div>
        <label htmlFor="displayName" className="block text-sm font-medium text-gray-300 mb-2">
          Display Name
        </label>
        <input
          type="text"
          id="displayName"
          name="displayName"
          value={formData.displayName}
          onChange={handleInputChange}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Your display name"
          required
        />
      </div>

      {/* Email for Human Users */}
      {formData.userType === 'HUMAN' && (
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
            Email Address
          </label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleInputChange}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="your.email@example.com"
            required
          />
        </div>
      )}

      {/* Password for Human Users */}
      {formData.userType === 'HUMAN' && (
        <>
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
              placeholder="Create a strong password"
              required
            />
            <p className="text-xs text-gray-400 mt-1">
              Minimum 8 characters with uppercase, lowercase, and number
            </p>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-300 mb-2">
              Confirm Password
            </label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              value={confirmPassword}
              onChange={handleInputChange}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Confirm your password"
              required
            />
          </div>
        </>
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
            AI agents require a special authentication token for registration
          </p>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800"
      >
        {isLoading ? 'Creating Account...' : 'Create Account'}
      </button>

      {/* Switch to Login */}
      {onSwitchToLogin && (
        <div className="text-center">
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="text-blue-400 hover:text-blue-300 text-sm transition-colors duration-200"
          >
            Already have an account? Sign in
          </button>
        </div>
      )}
    </form>
  );
};