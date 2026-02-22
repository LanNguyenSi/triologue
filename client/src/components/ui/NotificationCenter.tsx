import React, { useEffect, useMemo, useRef, useState } from "react";
import { BellIcon, CheckIcon, TrashIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { useNotificationStore } from "../../stores/notificationStore";

const typeDotClass: Record<string, string> = {
  info: "bg-blue-500",
  success: "bg-green-500",
  warning: "bg-yellow-500",
  error: "bg-red-500",
};

export const NotificationCenter: React.FC = () => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const location = useLocation();
  const navigate = useNavigate();

  const items = useNotificationStore((s) => s.items);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const remove = useNotificationStore((s) => s.remove);
  const clear = useNotificationStore((s) => s.clear);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);
  const isChatView = /^\/room\/[^/]+/.test(location.pathname);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!open) return;
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    markAllRead();
  }, [open, markAllRead]);

  return (
    <div
      ref={containerRef}
      className={`fixed right-4 z-[70] ${isChatView ? "top-20 md:top-24" : "bottom-4"}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative rounded-full p-2 shadow-lg transition-colors ${
          isDark ? "bg-gray-800 hover:bg-gray-700 text-gray-100 border border-gray-700" : "bg-white hover:bg-gray-50 text-gray-800 border border-gray-200"
        }`}
        title={open ? t("notifications.close") : t("notifications.open")}
      >
        <BellIcon className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute right-0 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border shadow-2xl ${
            isChatView ? "top-12" : "bottom-12"
          } ${
            isDark ? "bg-gray-900 border-gray-700 text-gray-100" : "bg-white border-gray-200 text-gray-900"
          }`}
        >
          <div className={`flex items-center justify-between px-3 py-2 border-b ${isDark ? "border-gray-700" : "border-gray-200"}`}>
            <div className="text-sm font-semibold">{t("notifications.title")}</div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => markAllRead()}
                className={`rounded p-1 text-xs ${isDark ? "hover:bg-gray-800 text-gray-300" : "hover:bg-gray-100 text-gray-600"}`}
                title={t("notifications.markAllRead")}
              >
                <CheckIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => clear()}
                className={`rounded p-1 text-xs ${isDark ? "hover:bg-gray-800 text-gray-300" : "hover:bg-gray-100 text-gray-600"}`}
                title={t("notifications.clearAll")}
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <div className={`px-3 py-6 text-sm text-center ${isDark ? "text-gray-400" : "text-gray-500"}`}>
              {t("notifications.empty")}
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`px-3 py-2 border-b last:border-b-0 ${isDark ? "border-gray-800" : "border-gray-100"} ${
                    item.read ? "" : isDark ? "bg-gray-800/40" : "bg-blue-50/60"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-1 inline-block w-2 h-2 rounded-full ${typeDotClass[item.type] || typeDotClass.info}`} />
                    <button
                      type="button"
                      className="flex-1 text-left min-w-0"
                      onClick={() => {
                        markRead(item.id);
                        if (item.link) {
                          navigate(item.link);
                          setOpen(false);
                        }
                      }}
                    >
                      <div className="text-sm font-medium truncate">{item.title}</div>
                      {item.message && (
                        <div className={`text-xs mt-0.5 ${isDark ? "text-gray-300" : "text-gray-600"}`}>{item.message}</div>
                      )}
                      <div className={`text-[10px] mt-1 ${isDark ? "text-gray-500" : "text-gray-400"}`}>
                        {new Date(item.createdAt).toLocaleString()}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(item.id)}
                      className={`rounded p-0.5 ${isDark ? "text-gray-500 hover:text-gray-300 hover:bg-gray-800" : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"}`}
                      title={t("notifications.remove")}
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
