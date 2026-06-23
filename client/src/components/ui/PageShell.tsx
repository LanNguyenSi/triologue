import React from "react";
import { useTheme } from "../../contexts/ThemeContext";

type MaxWidth = "3xl" | "4xl" | "5xl" | "6xl" | "7xl";

interface PageShellProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  maxWidth?: MaxWidth;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
}

const WIDTH_MAP: Record<MaxWidth, string> = {
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
};

export const PageShell: React.FC<PageShellProps> = ({
  children,
  title,
  subtitle,
  actions,
  maxWidth = "6xl",
  className = "",
  headerClassName = "",
  contentClassName = "",
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className={`min-h-screen ${isDark ? "bg-dark-base text-white" : "bg-gray-50/80 text-gray-900"} ${className}`}>
      <main className={`${WIDTH_MAP[maxWidth]} mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6`}>
        {(title || subtitle || actions) && (
          <header className={`mb-4 sm:mb-5 ${headerClassName}`}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
              <div>
                {title && <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{title}</h1>}
                {subtitle && (
                  <p className={`mt-2 text-sm sm:text-base ${isDark ? "text-gray-400" : "text-gray-600"}`}>{subtitle}</p>
                )}
              </div>
              {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
            </div>
          </header>
        )}
        <div className={contentClassName}>{children}</div>
      </main>
    </div>
  );
};
