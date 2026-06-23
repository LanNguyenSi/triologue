import React from "react";
import { useTheme } from "../../../contexts/ThemeContext";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", ...props }, ref) => {
    const { theme } = useTheme();
    const isDark = theme === "dark";

    return (
      <input
        ref={ref}
        className={`w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors duration-200 focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-1 ${isDark ? "focus:ring-offset-gray-900" : "focus:ring-offset-white"} focus:border-blue-500 ${
          isDark
            ? "border-gray-600/80 bg-gray-800/60 text-white placeholder-gray-500"
            : "border-gray-200/60 bg-white text-gray-900 placeholder-gray-400 shadow-subtle"
        } ${className}`}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
