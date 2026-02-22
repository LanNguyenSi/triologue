import React from "react";
import { useTheme } from "../../../contexts/ThemeContext";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

export const Select: React.FC<SelectProps> = ({ className = "", children, ...props }) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <select
      className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-blue-500 ${
        isDark
          ? "border-gray-600 bg-gray-700 text-white"
          : "border-gray-300 bg-white text-gray-900"
      } ${className}`}
      {...props}
    >
      {children}
    </select>
  );
};
