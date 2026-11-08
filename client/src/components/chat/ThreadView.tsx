import React, { useEffect, useRef, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { CheckCircleIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import { useThreadStore } from "../../stores/threadStore";
import { useSocketStore } from "../../stores/socketStore";
import { useChatStore } from "../../stores/chatStore";
import { useAuthStore } from "../../stores/authStore";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { MessageRenderer } from "./MessageRenderer";
import { formatTime } from "./chatUtils";
import type { Thread } from "../../types/chat";

/** One thread: its root message, the replies, resolve/reopen and the reply box. */
export const ThreadView: React.FC<{ thread: Thread }> = ({ thread }) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const user = useAuthStore((s) => s.user);
  const room = useChatStore((s) => s.currentRoom);
  const rootMessage = useChatStore((s) =>
    thread.rootMessageId ? s.messages.find((m) => m.id === thread.rootMessageId) : undefined,
  );
  const {
    roomId,
    replies,
    repliesLoading,
    repliesError,
    resolving,
    resolveError,
    focusReplyId,
    setFocusReply,
    hasMoreReplies,
    loadingOlderReplies,
    olderRepliesError,
    setResolved,
    loadReplies,
    loadOlderReplies,
  } = useThreadStore();
  const sendMessage = useSocketStore((s) => s.sendMessage);

  const [text, setText] = useState("");
  const [sendFailed, setSendFailed] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const canSend = room?.canSendMessages !== false;
  // Mirrors the server rule (creator, room owner or admin, system admin); the
  // server decides, and a refusal is shown without changing the thread.
  const canResolve =
    !!user &&
    ((thread.createdBy !== null && thread.createdBy === user.id) ||
      room?.role === "OWNER" ||
      room?.role === "ADMIN" ||
      user.isAdmin === true);

  useEffect(() => {
    if (focusReplyId) return;
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [replies.length, focusReplyId]);

  // A jump from a search hit or a pin: bring the reply into view, mark it for a
  // moment. A reply older than the loaded page is not there; nothing happens.
  const focusReplyLoaded = focusReplyId ? replies.some((r) => r.id === focusReplyId) : false;
  useEffect(() => {
    if (!focusReplyId || !focusReplyLoaded) return;
    document
      .getElementById(`thread-reply-${focusReplyId}`)
      ?.scrollIntoView?.({ block: "center" });
    const timer = window.setTimeout(() => setFocusReply(null), 1800);
    return () => window.clearTimeout(timer);
  }, [focusReplyId, focusReplyLoaded, setFocusReply]);

  useEffect(() => {
    if (!sendFailed) return;
    const timer = window.setTimeout(() => setSendFailed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [sendFailed]);

  const send = () => {
    const content = text.trim();
    if (!content || !roomId) return;
    if (sendMessage(roomId, content, thread.id)) {
      setText("");
      setSendFailed(false);
    } else {
      setSendFailed(true);
    }
  };

  const muted = isDark ? "text-gray-400" : "text-gray-600";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {thread.isResolved && (
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium ${
              isDark ? "text-emerald-300" : "text-emerald-700"
            }`}
          >
            <CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
            {t("threads.resolved")}
          </span>
        )}
        {canResolve && (
          <button
            type="button"
            onClick={() => void setResolved(thread.id, !thread.isResolved)}
            disabled={resolving}
            className={`ml-auto rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors duration-200 disabled:opacity-50 max-md:min-h-11 ${
              isDark
                ? "border-gray-600 text-gray-200 hover:bg-gray-700/70"
                : "border-gray-300 text-gray-700 hover:bg-gray-100"
            }`}
          >
            {thread.isResolved ? t("threads.reopen") : t("threads.resolve")}
          </button>
        )}
      </div>
      {resolveError && (
        <p role="alert" className={`px-3 pb-2 text-xs ${isDark ? "text-red-400" : "text-red-700"}`}>
          {t(resolveError)}
        </p>
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-2"
        role="log"
        aria-live="polite"
        aria-label={t("threads.repliesHeading")}
      >
        {rootMessage && (
          <blockquote
            className={`mb-3 rounded-lg border-l-2 px-3 py-2 text-xs ${
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
        )}

        {hasMoreReplies && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={() => void loadOlderReplies()}
              disabled={loadingOlderReplies}
              className={`rounded-full px-4 py-1.5 text-xs transition-colors duration-200 disabled:opacity-50 max-md:min-h-11 ${
                isDark
                  ? "bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300 hover:text-gray-900"
              }`}
            >
              {loadingOlderReplies ? t("threads.loading") : `↑ ${t("threads.loadOlderReplies")}`}
            </button>
          </div>
        )}
        {olderRepliesError && (
          <p role="alert" className={`pb-2 text-xs ${isDark ? "text-red-400" : "text-red-700"}`}>
            {t("threads.repliesLoadError")}
          </p>
        )}
        {repliesLoading && replies.length === 0 && (
          <p className={`py-2 text-sm ${muted}`}>{t("threads.loading")}</p>
        )}
        {repliesError && (
          <div className="py-2 text-sm" role="alert">
            <p className={isDark ? "text-red-400" : "text-red-700"}>{t("threads.repliesLoadError")}</p>
            <button
              type="button"
              onClick={() => void loadReplies(thread.id)}
              className="mt-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
            >
              {t("chat.retry")}
            </button>
          </div>
        )}
        {!repliesLoading && !repliesError && replies.length === 0 && (
          <p className={`py-2 text-sm ${muted}`}>{t("threads.noReplies")}</p>
        )}

        <ul className="space-y-3">
          {replies.map((reply) => (
            <li
              key={reply.id}
              id={`thread-reply-${reply.id}`}
              data-focused={focusReplyId === reply.id ? "true" : undefined}
              className={
                focusReplyId === reply.id
                  ? `rounded-lg px-2 py-1 ring-1 transition-colors ${isDark ? "bg-yellow-500/15 ring-yellow-500/40" : "bg-yellow-100 ring-yellow-300"}`
                  : undefined
              }
            >
              <div className="flex items-baseline gap-2">
                <span
                  className={`truncate text-sm font-semibold ${isDark ? "text-white" : "text-gray-900"}`}
                >
                  {reply.sender.displayName || reply.sender.username}
                </span>
                <span
                  className={`shrink-0 text-xs ${muted}`}
                  title={new Date(reply.createdAt).toLocaleString()}
                >
                  {formatTime(reply.createdAt, t)}
                </span>
              </div>
              <div className="min-w-0 break-words">
                <MessageRenderer content={reply.content} />
              </div>
            </li>
          ))}
        </ul>
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className={`shrink-0 border-t px-3 py-2 ${isDark ? "border-gray-800/60" : "border-gray-200/60"}`}
      >
        <div className="flex items-end gap-2">
          <TextareaAutosize
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            aria-label={t("threads.replyLabel")}
            placeholder={canSend ? t("threads.replyPlaceholder") : t("chat.readOnlyClosedProject")}
            disabled={!canSend}
            minRows={1}
            maxRows={5}
            className={`min-w-0 flex-1 resize-none rounded-lg border px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 ${
              isDark
                ? "border-gray-600/80 bg-gray-800/60 text-white placeholder-gray-500"
                : "border-gray-200/60 bg-white text-gray-900 placeholder-gray-500 shadow-subtle"
            }`}
          />
          <button
            type="submit"
            disabled={!canSend || text.trim() === ""}
            title={t("threads.send")}
            aria-label={t("threads.send")}
            className="shrink-0 rounded-lg bg-blue-600 p-2.5 text-white shadow-subtle hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500/40"
          >
            <PaperAirplaneIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {sendFailed && (
          <p role="alert" className={`mt-1 text-xs ${isDark ? "text-red-400" : "text-red-700"}`}>
            {t("chat.sendFailed")}
          </p>
        )}
      </form>
    </div>
  );
};
