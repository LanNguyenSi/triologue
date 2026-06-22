import { useEffect, useRef } from "react";
import { FOCUSABLE } from "../utils/focusable";

/**
 * Focus management for non-dialog overlays (the mobile sidebar drawer and the
 * user-menu popup). While `active`: moves focus into `containerRef`, traps
 * Tab/Shift+Tab within it, calls `onEscape` on Escape, and restores focus to
 * the previously-focused element on deactivate.
 *
 * This mirrors the focus trap built into the Modal primitive, which keeps its
 * own copy because it also owns a portal + animation lifecycle. Give the
 * container `tabIndex={-1}` so the fallback focus target works.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
): void {
  // Keep the latest onEscape without re-running (and re-binding) the trap.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    if (container) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? container).focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab" || !container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, containerRef]);
}
