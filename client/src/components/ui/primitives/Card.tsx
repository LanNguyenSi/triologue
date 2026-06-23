import React from "react";
import { useTheme } from "../../../contexts/ThemeContext";

type Tone = "default" | "muted" | "accent";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  tone?: Tone;
}

export const Card: React.FC<CardProps & React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = "",
  tone = "default",
  ...props
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const toneClass =
    tone === "muted"
      ? isDark
        ? "bg-gray-800/40 border-gray-700/50"
        : "bg-gray-50 border-gray-200/80 shadow-subtle"
      : tone === "accent"
        ? isDark
          ? "bg-blue-950/20 border-blue-800/30"
          : "bg-blue-50/50 border-blue-200/60 shadow-subtle"
        : isDark
          ? "bg-gray-800/60 border-gray-700/50"
          : "bg-white border-gray-200/80 shadow-card";

  return (
    <div className={`rounded-lg border transition-shadow duration-200 ${toneClass} ${className}`} {...props}>
      {children}
    </div>
  );
};
