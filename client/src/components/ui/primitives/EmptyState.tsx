import React from "react";
import { useTheme } from "../../../contexts/ThemeContext";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = "",
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className={`rounded-xl border p-10 text-center ${isDark ? "border-gray-800/60 bg-gray-800/30" : "border-gray-200/80 bg-white shadow-card"} ${className}`}>
      {icon && <div className="text-4xl mb-3">{icon}</div>}
      <h3 className={`text-base font-semibold ${isDark ? "text-gray-100" : "text-gray-900"}`}>{title}</h3>
      {description && (
        <p className={`mt-1 text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
};
