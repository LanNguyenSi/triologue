import React from 'react';
import { ArrowRightStartOnRectangleIcon } from '@heroicons/react/24/outline';
import { useTheme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../contexts/LanguageContext';
import type { NavItem } from './sidebarTypes';
import { SidebarNavItem } from './SidebarNavItem';

interface SidebarUserMenuProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  filteredBottomNav: NavItem[];
  user: { username: string } | null;
  onLogout: () => void;
}

export const SidebarUserMenu: React.FC<SidebarUserMenuProps> = ({
  open,
  onToggle,
  onClose,
  filteredBottomNav,
  user,
  onLogout,
}) => {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isDark = theme === 'dark';

  return (
    <div className="relative">
      {open && (
        <div
          className={`absolute bottom-full left-0 right-0 z-10 mb-1 p-1 rounded-lg border shadow-elevated space-y-0.5 ${
            isDark ? 'bg-gray-900 border-gray-700/50' : 'bg-white border-gray-200/60'
          }`}
        >
          {filteredBottomNav.map((n) => (
            <SidebarNavItem key={n.key ?? `${n.to}:${n.label}`} item={n} />
          ))}
          <button
            type="button"
            onClick={() => {
              onClose();
              onLogout();
            }}
            title={t('nav.logout')}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-colors duration-200 w-full ${
              isDark
                ? 'text-gray-500 hover:text-red-400 hover:bg-red-900/20'
                : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
            }`}
          >
            <span className="w-5 text-center flex-shrink-0 flex items-center justify-center">
              <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
            </span>
            <span>{t('nav.logout')}</span>
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-200 ${
          isDark ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
          {user?.username?.[0]?.toUpperCase() ?? 'U'}
        </div>
        <span className="truncate flex-1 text-left">{user?.username}</span>
        <span className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
    </div>
  );
};
