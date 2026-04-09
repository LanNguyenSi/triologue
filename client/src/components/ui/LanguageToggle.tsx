import React from 'react';
import { GlobeAltIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '../../contexts/LanguageContext';

export const LanguageToggle: React.FC = () => {
  const { language, setLanguage, t } = useLanguage();

  return (
    <button
      onClick={() => setLanguage(language === 'de' ? 'en' : 'de')}
      className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors duration-200 flex items-center gap-1"
      title={language === 'de' ? t('ui.tooltip.switchToEnglish') : t('ui.tooltip.switchToGerman')}
    >
      <GlobeAltIcon className="w-4 h-4" />
      <span className="text-xs font-medium">{language === 'de' ? 'EN' : 'DE'}</span>
    </button>
  );
};
