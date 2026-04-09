import React from "react";
import { useTheme } from "../../../contexts/ThemeContext";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input: React.FC<InputProps> = ({ className = "", ...props }) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <input
      className={`w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors duration-200 focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-1 focus:border-blue-500 ${
        isDark
          ? "border-gray-600/80 bg-gray-800/60 text-white placeholder-gray-500"
          : "border-gray-200/60 bg-white text-gray-900 placeholder-gray-400 shadow-subtle"
      } ${className}`}
      {...props}
    />
  );
};
