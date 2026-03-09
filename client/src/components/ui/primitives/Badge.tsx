import React from "react";
import { useTheme } from "../../../contexts/ThemeContext";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = "neutral", className = "" }) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const variantClass =
    variant === "success"
      ? isDark
        ? "bg-green-900/30 text-green-300"
        : "bg-green-50 text-green-700 ring-1 ring-inset ring-green-200"
      : variant === "warning"
        ? isDark
          ? "bg-yellow-900/30 text-yellow-300"
          : "bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-200"
        : variant === "danger"
          ? isDark
            ? "bg-red-900/30 text-red-300"
            : "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200"
          : variant === "info"
            ? isDark
              ? "bg-blue-900/30 text-blue-300"
              : "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200"
            : isDark
              ? "bg-gray-800 text-gray-300"
              : "bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200";

  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${variantClass} ${className}`}>
      {children}
    </span>
  );
};
