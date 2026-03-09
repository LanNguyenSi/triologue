import React from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useLanguage } from "../../contexts/LanguageContext";

export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { t } = useLanguage();

  return (
    <button
      onClick={toggleTheme}
      className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-all duration-200 flex items-center gap-1.5"
      title={theme === "dark" ? t("ui.tooltip.switchToLight") : t("ui.tooltip.switchToDark")}
    >
      <span className="text-base">{theme === "dark" ? "☀️" : "🌙"}</span>
    </button>
  );
};
