import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

export const LanguageToggle: React.FC = () => {
  const { language, setLanguage, t } = useLanguage();

  return (
    <button
      onClick={() => setLanguage(language === 'de' ? 'en' : 'de')}
      className="px-3 py-1.5 text-sm text-gray-300 hover:text-white transition-colors flex items-center gap-1.5"
      title={language === 'de' ? t('ui.tooltip.switchToEnglish') : t('ui.tooltip.switchToGerman')}
    >
      <span className="text-base">🌐</span>
      <span className="font-medium">{language === 'de' ? 'EN' : 'DE'}</span>
    </button>
  );
};
