import React from "react";
import { useTheme } from "../../../contexts/ThemeContext";

type Variant = "primary" | "secondary" | "danger" | "success" | "ghost";
type Size = "xs" | "sm" | "md" | "icon";

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

  // Enterprise density scale. md (the default) is the standard control height;
  // sm/xs are progressively tighter for toolbars and inline rows; icon is a
  // square padding for single-icon buttons (no asymmetric text padding).
  const sizeClasses: Record<Size, string> = {
    xs: "px-2.5 py-1 text-xs",
    sm: "px-3.5 py-1.5 text-sm",
    md: "px-3.5 py-2 text-sm",
    icon: "p-1.5 leading-none",
  };
  const sizeClass = sizeClasses[size];
  const widthClass = block ? "w-full" : "";
  // The button owns its flex context: Tailwind's preflight makes `svg`
  // display:block, so an icon child inside an inline-block button would push
  // the label onto its own line. `block` buttons need block-level flex, the
  // rest inline-level. Callers must not pass a display utility — there is no
  // tailwind-merge here, so CSS source order decides and this base wins.
  const displayClass = block ? "flex" : "inline-flex";

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
          : variant === "success"
            ? isDark
              ? "bg-green-700/80 hover:bg-green-600 text-green-100"
              : "bg-green-600 hover:bg-green-500 text-white shadow-subtle"
            : isDark
              ? "text-gray-300 hover:bg-gray-800/80"
              : "text-gray-600 hover:bg-gray-100";

  return (
    <button
      className={`${displayClass} items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-200 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 ${isDark ? "focus-visible:ring-offset-gray-900" : "focus-visible:ring-offset-white"} disabled:opacity-50 disabled:cursor-not-allowed ${sizeClass} ${variantClass} ${widthClass} ${className}`}
      disabled={disabled}
      {...props}
    />
  );
};
