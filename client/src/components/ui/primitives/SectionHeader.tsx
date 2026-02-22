import React from "react";
import { useTheme } from "../../../contexts/ThemeContext";

interface SectionHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  actions,
  className = "",
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <div>
        <h2 className="text-base sm:text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle && (
          <p className={`mt-1 text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
};
