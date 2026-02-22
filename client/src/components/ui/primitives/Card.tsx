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
        ? "bg-gray-800/40 border-gray-800"
        : "bg-gray-100/70 border-gray-200"
      : tone === "accent"
        ? isDark
          ? "bg-blue-900/10 border-blue-800/40"
          : "bg-blue-50 border-blue-200"
        : isDark
          ? "bg-gray-800/60 border-gray-700"
          : "bg-white border-gray-200";

  return (
    <div className={`rounded-xl border ${toneClass} ${className}`} {...props}>
      {children}
    </div>
  );
};
