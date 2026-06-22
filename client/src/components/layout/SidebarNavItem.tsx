import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../contexts/LanguageContext';
import type { NavItem } from './sidebarTypes';

export const SidebarNavItem: React.FC<{ item: NavItem }> = ({ item }) => {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const location = useLocation();
  const isDark = theme === 'dark';

  const active = item.match(location.pathname);
  const disabled = !item.available;

  const cls = [
    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors relative group',
    active
      ? isDark ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700'
      : disabled
        ? isDark ? 'text-gray-600 cursor-default' : 'text-gray-400 cursor-default'
        : isDark
          ? 'text-gray-300 hover:bg-gray-800 hover:text-white'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
  ].join(' ');

  const inner = (
    <>
      <span className="w-5 text-center flex-shrink-0 flex items-center justify-center">{item.icon}</span>
      <span className="truncate">{item.label}</span>
      {disabled && (
        <span className={`ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
          isDark ? 'bg-gray-800 text-gray-500' : 'bg-gray-200 text-gray-400'
        }`}>{t('nav.soon')}</span>
      )}
      {item.badge !== undefined && item.badge > 0 && (
        <span className="ml-auto min-w-4 h-4 px-1 bg-blue-500/80 text-white text-[10px] rounded-full flex items-center justify-center font-medium">
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      )}
    </>
  );

  if (disabled) {
    return <div className={cls}>{inner}</div>;
  }
  return <Link to={item.to} className={cls}>{inner}</Link>;
};
