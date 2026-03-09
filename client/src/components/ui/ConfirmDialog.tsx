import React, { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ExclamationTriangleIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useTheme } from "../../contexts/ThemeContext";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const variantStyles = {
  danger: {
    icon: TrashIcon,
    iconBg: {
      dark: "bg-red-900/40 border-red-700/50",
      light: "bg-red-100 border-red-300",
    },
    iconColor: { dark: "text-red-400", light: "text-red-600" },
    confirmBtn: "bg-red-600 hover:bg-red-700 focus:ring-red-500",
  },
  warning: {
    icon: ExclamationTriangleIcon,
    iconBg: {
      dark: "bg-yellow-900/40 border-yellow-700/50",
      light: "bg-yellow-100 border-yellow-300",
    },
    iconColor: { dark: "text-yellow-400", light: "text-yellow-600" },
    confirmBtn: "bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500",
  },
  info: {
    icon: ExclamationTriangleIcon,
    iconBg: {
      dark: "bg-blue-900/40 border-blue-700/50",
      light: "bg-blue-100 border-blue-300",
    },
    iconColor: { dark: "text-blue-400", light: "text-blue-600" },
    confirmBtn: "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500",
  },
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  loading = false,
  onConfirm,
  onCancel,
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const style = variantStyles[variant];
  const Icon = style.icon;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    },
    [onCancel, loading],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !loading && onCancel()}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className={`relative w-full max-w-sm mx-4 rounded-xl shadow-elevated border ${
              isDark
                ? "bg-gray-900 border-gray-700/60"
                : "bg-white border-gray-200/80"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onCancel}
              disabled={loading}
              className={`absolute top-3 right-3 p-1 rounded-lg transition-all duration-200 disabled:opacity-50 ${
                isDark
                  ? "text-gray-500 hover:text-white hover:bg-gray-800/60"
                  : "text-gray-400 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              <XMarkIcon className="w-4 h-4" />
            </button>

            <div className="p-6">
              <div className="flex justify-center mb-4">
                <div
                  className={`w-12 h-12 rounded-full border flex items-center justify-center ${
                    isDark ? style.iconBg.dark : style.iconBg.light
                  }`}
                >
                  <Icon
                    className={`w-6 h-6 ${isDark ? style.iconColor.dark : style.iconColor.light}`}
                  />
                </div>
              </div>

              <h3
                className={`text-lg font-semibold text-center mb-2 ${
                  isDark ? "text-white" : "text-gray-900"
                }`}
              >
                {title}
              </h3>

              <p
                className={`text-sm text-center mb-6 ${
                  isDark ? "text-gray-300" : "text-gray-600"
                }`}
              >
                {message}
              </p>

              <div className="flex gap-3">
                <button
                  onClick={onCancel}
                  disabled={loading}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50 ${
                    isDark
                      ? "bg-gray-800 hover:bg-gray-700 text-white ring-1 ring-inset ring-gray-700/50"
                      : "bg-gray-100 hover:bg-gray-200 text-gray-900 ring-1 ring-inset ring-gray-200"
                  }`}
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={onConfirm}
                  disabled={loading}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-all duration-200 disabled:opacity-50 shadow-subtle focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                    isDark
                      ? "focus:ring-offset-gray-900"
                      : "focus:ring-offset-white"
                  } ${style.confirmBtn}`}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      <span>{confirmLabel}</span>
                    </span>
                  ) : (
                    confirmLabel
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
