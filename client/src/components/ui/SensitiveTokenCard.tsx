import React from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { Button, Card } from "./primitives";

interface SensitiveTokenCardProps {
  warning: React.ReactNode;
  description?: React.ReactNode;
  token: string;
  copyLabel: string;
  copiedLabel: string;
  copied: boolean;
  onCopy: () => void;
  footer?: React.ReactNode;
  className?: string;
}

export const SensitiveTokenCard: React.FC<SensitiveTokenCardProps> = ({
  warning,
  description,
  token,
  copyLabel,
  copiedLabel,
  copied,
  onCopy,
  footer,
  className = "",
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Card
      className={`p-3 border-yellow-600/60 ${
        isDark ? "bg-yellow-900/20" : "bg-yellow-50"
      } ${className}`}
    >
      <p
        className={`text-xs font-semibold ${
          isDark ? "text-yellow-300" : "text-yellow-900"
        }`}
      >
        {warning}
      </p>

      {description && (
        <p className={`mt-1 text-xs ${isDark ? "text-gray-400" : "text-gray-700"}`}>
          {description}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <code
          className={`flex-1 rounded px-2 py-1 text-xs break-all ${
            isDark ? "bg-gray-900 text-yellow-100" : "bg-yellow-100 text-yellow-900"
          }`}
        >
          {token}
        </code>
        <Button type="button" size="sm" variant="secondary" onClick={onCopy}>
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>

      {footer && (
        <div className={`mt-2 text-xs ${isDark ? "text-gray-400" : "text-gray-700"}`}>
          {footer}
        </div>
      )}
    </Card>
  );
};

