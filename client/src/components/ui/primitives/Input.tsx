import React from "react";
import { useTheme } from "../../../contexts/ThemeContext";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input: React.FC<InputProps> = ({ className = "", ...props }) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <input
      className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-blue-500 ${
        isDark
          ? "border-gray-600 bg-gray-700 text-white placeholder-gray-400"
          : "border-gray-300 bg-white text-gray-900 placeholder-gray-500"
      } ${className}`}
      {...props}
    />
  );
};
