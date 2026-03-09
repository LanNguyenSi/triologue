import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useLanguage } from '../contexts/LanguageContext';

export const NotFoundPage: React.FC = () => {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isDark = theme === 'dark';

  return (
    <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-dark-base text-white' : 'bg-gray-50 text-gray-900'}`}>
      <div className="text-center px-6">
        <div className="text-8xl mb-6">🧊</div>
        <h1 className="text-6xl font-bold mb-2">404</h1>
        <p className={`text-xl mb-8 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          {t('notFound.message')}
        </p>
        <Link
          to="/"
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-all duration-200"
        >
          {t('notFound.home')}
        </Link>
      </div>
    </div>
  );
};
