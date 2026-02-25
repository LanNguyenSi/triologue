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
      ? "bg-green-900/40 text-green-300"
      : variant === "warning"
        ? "bg-yellow-900/40 text-yellow-300"
        : variant === "danger"
          ? "bg-red-900/40 text-red-300"
          : variant === "info"
            ? isDark
              ? "bg-blue-900/40 text-blue-300"
              : "bg-blue-100 text-blue-700"
            : isDark
              ? "bg-gray-700 text-gray-300"
              : "bg-gray-100 text-gray-700";

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variantClass} ${className}`}>
      {children}
    </span>
  );
};
