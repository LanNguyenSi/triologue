import React, { useEffect, useId, useRef } from "react";
import { ArrowLeftIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useThreadStore } from "../../stores/threadStore";
import { useLanguage } from "../../contexts/LanguageContext";
import { useTheme } from "../../contexts/ThemeContext";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { FOCUSABLE } from "../../utils/focusable";
import { ThreadList } from "./ThreadList";
import { ThreadView } from "./ThreadView";
import { ThreadDraft } from "./ThreadDraft";

interface ThreadSidebarProps {
  isMobile: boolean;
}

/**
 * The room's thread panel. Beside the message list on wide screens; on narrow
 * ones a sheet over it that traps focus and hands it back to the opener.
 * Rendered only while the panel is open.
 */
export const ThreadSidebar: React.FC<ThreadSidebarProps> = ({ isMobile }) => {
  const { t } = useLanguage();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { view, threads, activeThreadId, draftRoot, closePanel, openList } = useThreadStore();
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const thread = activeThreadId ? threads.find((x) => x.id === activeThreadId) : undefined;

  // Mobile: a modal sheet (trap, Escape, focus returns to the opener).
  useFocusTrap(panelRef, isMobile, closePanel);

  // Wide screens: focus returns to the opener when the panel closes.
  useEffect(() => {
    if (isMobile) return;
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [isMobile]);

  // A view change moves focus to what opened: the heading on wide screens, the
  // first control on the sheet (a Tab from the heading would leave the trap).
  useEffect(() => {
    if (isMobile) {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panelRef.current)?.focus();
    } else {
      headingRef.current?.focus();
    }
  }, [view, activeThreadId, isMobile]);

  let title = t("threads.title");
  if (view === "draft") title = t("threads.draftTitle");
  if (view === "thread") title = thread?.title ?? t("threads.title");

  const iconButton = `rounded-lg p-1.5 transition-colors duration-200 max-md:inline-flex max-md:min-h-11 max-md:min-w-11 max-md:items-center max-md:justify-center ${
    isDark ? "text-gray-300 hover:bg-gray-700/70" : "text-gray-600 hover:bg-gray-100"
  }`;

  const shell = isMobile
    ? "fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col rounded-t-xl shadow-elevated"
    : "flex w-80 shrink-0 flex-col";
  const surface = isDark
    ? "border-gray-800/60 bg-gray-800 text-gray-100"
    : "border-gray-200/60 bg-white text-gray-900";

  const body = (
    <>
      <div
        className={`flex shrink-0 items-center gap-1 border-b px-2 py-1.5 ${
          isDark ? "border-gray-700/50" : "border-gray-200/60"
        }`}
      >
        {view !== "list" && (
          <button
            type="button"
            onClick={openList}
            className={iconButton}
            title={t("threads.back")}
            aria-label={t("threads.back")}
          >
            <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate px-1 text-sm font-semibold outline-hidden"
        >
          {title}
        </h2>
        <button
          type="button"
          onClick={closePanel}
          className={iconButton}
          title={t("threads.close")}
          aria-label={t("threads.close")}
        >
          <XMarkIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {view === "list" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ThreadList />
        </div>
      )}
      {view === "draft" && draftRoot && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ThreadDraft key={draftRoot.id} rootMessage={draftRoot} />
        </div>
      )}
      {view === "thread" &&
        (thread ? (
          <ThreadView key={thread.id} thread={thread} />
        ) : (
          <p className={`px-3 py-4 text-sm ${isDark ? "text-gray-400" : "text-gray-600"}`}>
            {t("threads.notFound")}
          </p>
        ))}
    </>
  );

  if (isMobile) {
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs"
          onClick={closePanel}
          aria-hidden="true"
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          tabIndex={-1}
          className={`${shell} border-t ${surface}`}
        >
          {body}
        </div>
      </>
    );
  }

  return (
    <section
      ref={panelRef}
      aria-labelledby={headingId}
      onKeyDown={(e) => {
        if (e.key === "Escape") closePanel();
      }}
      className={`${shell} border-l ${surface}`}
    >
      {body}
    </section>
  );
};
