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

  const sizeClass = size === "sm" ? "px-3.5 py-1.5 text-sm" : "px-5 py-2.5 text-sm";
  const widthClass = block ? "w-full" : "";

  const variantClass =
    variant === "primary"
      ? isDark
        ? "bg-blue-600 hover:bg-blue-500 text-white shadow-subtle"
        : "bg-blue-600 hover:bg-blue-700 text-white shadow-subtle"
      : variant === "secondary"
        ? isDark
          ? "bg-gray-700/80 hover:bg-gray-600/80 text-gray-100 ring-1 ring-inset ring-gray-600/50"
          : "bg-gray-100 hover:bg-gray-200 text-gray-800 ring-1 ring-inset ring-gray-200"
        : variant === "danger"
          ? isDark
            ? "bg-red-700/80 hover:bg-red-600 text-red-100"
            : "bg-red-600 hover:bg-red-500 text-white shadow-subtle"
          : isDark
            ? "text-gray-300 hover:bg-gray-800/80"
            : "text-gray-600 hover:bg-gray-100";

  return (
    <button
      className={`rounded-lg font-medium transition-colors duration-200 active:scale-[0.98] ${sizeClass} ${variantClass} ${widthClass} ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      } ${className}`}
      disabled={disabled}
      {...props}
    />
  );
};
