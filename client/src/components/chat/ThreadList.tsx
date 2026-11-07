import React from "react";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import { useThreadStore } from "../../stores/threadStore";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { formatTime } from "./chatUtils";

/** Compact list of the room's threads, newest activity first. */
export const ThreadList: React.FC = () => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const {
    roomId,
    threads,
    threadsLoading,
    threadsError,
    hasMoreThreads,
    loadThreads,
    loadMoreThreads,
    openThread,
  } = useThreadStore();

  const muted = isDark ? "text-gray-400" : "text-gray-600";

  if (threads.length === 0) {
    if (threadsLoading) {
      return <p className={`px-3 py-4 text-sm ${muted}`}>{t("threads.loading")}</p>;
    }
    if (threadsError) {
      return (
        <div className="px-3 py-4 text-sm" role="alert">
          <p className={isDark ? "text-red-400" : "text-red-700"}>{t("threads.loadError")}</p>
          <button
            type="button"
            onClick={() => roomId && void loadThreads(roomId)}
            className="mt-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            {t("chat.retry")}
          </button>
        </div>
      );
    }
    return <p className={`px-3 py-4 text-sm ${muted}`}>{t("threads.empty")}</p>;
  }

  return (
    <div>
      <ul>
        {threads.map((thread) => {
          const count = thread.messageCount;
          return (
            <li
              key={thread.id}
              className={`border-b last:border-b-0 ${isDark ? "border-gray-700/50" : "border-gray-100"}`}
            >
              <button
                type="button"
                onClick={() => void openThread(thread.id)}
                className={`block w-full px-3 py-2.5 text-left transition-colors duration-200 max-md:min-h-11 ${
                  isDark ? "hover:bg-gray-700/70" : "hover:bg-gray-50"
                }`}
              >
                <span
                  className={`block truncate text-sm font-semibold ${
                    isDark ? "text-gray-100" : "text-gray-900"
                  } ${thread.isResolved ? "opacity-80" : ""}`}
                >
                  {thread.title}
                </span>
                <span className={`mt-0.5 flex flex-wrap items-center gap-x-2 text-xs ${muted}`}>
                  <span>
                    {t(count === 1 ? "threads.replyCountOne" : "threads.replyCountMany").replace(
                      "{count}",
                      String(count),
                    )}
                  </span>
                  <span>
                    {t("threads.lastActivity").replace(
                      "{time}",
                      formatTime(thread.lastActivity, t),
                    )}
                  </span>
                  {thread.isResolved && (
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        isDark ? "text-emerald-300" : "text-emerald-700"
                      }`}
                    >
                      <CheckCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("threads.resolved")}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {threadsError && (
        <p role="alert" className={`px-3 py-2 text-xs ${isDark ? "text-red-400" : "text-red-700"}`}>
          {t("threads.loadError")}
        </p>
      )}
      {hasMoreThreads && (
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={() => void loadMoreThreads()}
            disabled={threadsLoading}
            className={`rounded-full px-4 py-1.5 text-xs transition-colors duration-200 disabled:opacity-50 ${
              isDark
                ? "bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300 hover:text-gray-900"
            }`}
          >
            {threadsLoading ? t("threads.loading") : t("threads.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
};
