import React, { useState } from "react";
import { useThreadStore } from "../../stores/threadStore";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import type { Message } from "../../types/chat";

const MAX_TITLE_LENGTH = 200;
const PREFILL_LENGTH = 120;

/** First line of the message, whitespace collapsed and cut to a title length. */
export function titleFromMessage(content: string | undefined, fallback: string): string {
  const firstLine =
    (content ?? "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .find((line) => line !== "") ?? "";
  if (firstLine === "") return fallback;
  return firstLine.length > PREFILL_LENGTH
    ? `${firstLine.slice(0, PREFILL_LENGTH - 1).trimEnd()}…`
    : firstLine;
}

/** Title step of "Reply in thread": the message quoted, the title prefilled and editable. */
export const ThreadDraft: React.FC<{ rootMessage: Message }> = ({ rootMessage }) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { creating, createError, createThread } = useThreadStore();
  const [title, setTitle] = useState(() =>
    titleFromMessage(rootMessage.content, t("threads.defaultTitle")),
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void createThread(title);
  };

  return (
    <form onSubmit={submit} className="space-y-3 p-3">
      <blockquote
        className={`rounded-lg border-l-2 px-3 py-2 text-xs ${
          isDark
            ? "border-gray-600 bg-gray-800/60 text-gray-300"
            : "border-gray-300 bg-gray-50 text-gray-700"
        }`}
      >
        <span className="block font-semibold">
          {t("threads.rootFrom").replace(
            "{name}",
            rootMessage.sender.displayName || rootMessage.sender.username,
          )}
        </span>
        <span className="mt-0.5 line-clamp-3 block whitespace-pre-wrap break-words">
          {rootMessage.content}
        </span>
      </blockquote>
      <div>
        <label
          htmlFor="thread-title"
          className={`mb-1 block text-xs font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          {t("threads.titleLabel")}
        </label>
        <input
          id="thread-title"
          type="text"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(e) => setTitle(e.target.value)}
          className={`w-full rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 ${
            isDark
              ? "border border-gray-600/50 bg-gray-700/80 text-white"
              : "border border-gray-200/60 bg-white text-gray-900 shadow-subtle"
          }`}
        />
      </div>
      {createError && (
        <p role="alert" className={`text-xs ${isDark ? "text-red-400" : "text-red-700"}`}>
          {t(createError)}
        </p>
      )}
      <button
        type="submit"
        disabled={creating || title.trim() === ""}
        className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-subtle hover:bg-blue-500 disabled:opacity-50 max-md:min-h-11"
      >
        {t("threads.create")}
      </button>
    </form>
  );
};
