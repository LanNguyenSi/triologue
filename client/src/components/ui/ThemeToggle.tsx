import React from "react";
import { useTheme } from "../../contexts/ThemeContext";

export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center gap-1.5"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className="text-base">{theme === "dark" ? "☀️" : "🌙"}</span>
    </button>
  );
};
