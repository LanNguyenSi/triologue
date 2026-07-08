import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  className = ''
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  };

  return (
    <div
      role="status"
      aria-label="Loading"
      className={`animate-spin rounded-full border-2 ${isDark ? 'border-gray-600 border-t-blue-500' : 'border-gray-300 border-t-blue-600'} ${sizeClasses[size]} ${className}`}
    />
  );
};