import React from "react";
import { useTheme } from "../../../contexts/ThemeContext";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  size = "md",
  block = false,
  className = "",
  disabled,
  ...props
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const sizeClass = size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm";
  const widthClass = block ? "w-full" : "";

  const variantClass =
    variant === "primary"
      ? isDark
        ? "bg-blue-600 hover:bg-blue-700 text-white"
        : "bg-blue-500 hover:bg-blue-600 text-white"
      : variant === "secondary"
        ? isDark
          ? "bg-gray-700 hover:bg-gray-600 text-gray-100"
          : "bg-gray-200 hover:bg-gray-300 text-gray-800"
        : variant === "danger"
          ? isDark
            ? "bg-red-700 hover:bg-red-600 text-red-100"
            : "bg-red-600 hover:bg-red-500 text-white"
          : isDark
            ? "text-gray-300 hover:bg-gray-800"
            : "text-gray-600 hover:bg-gray-100";

  return (
    <button
      className={`rounded font-medium transition-colors ${sizeClass} ${variantClass} ${widthClass} ${
        disabled ? "opacity-60 cursor-not-allowed" : ""
      } ${className}`}
      disabled={disabled}
      {...props}
    />
  );
};
