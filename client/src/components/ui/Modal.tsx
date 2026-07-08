import React, { useEffect, useRef, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FOCUSABLE } from "../../utils/focusable";

// ---------------------------------------------------------------------------
// App-wide z-index scale
// ---------------------------------------------------------------------------
// z-40:    mobile sidebar / userlist overlay backdrops
// z-50:    dropdowns, popups, mobile sidebar panels
// z-[60]:  all modal dialogs, via this component (never hand-roll an overlay
//          div — you lose the Escape stack, the focus trap, and the portal).
//          NotificationCenter's inline mode also uses z-[60], but it is
//          relative/in-flow (not a fixed overlay), so it does not participate
//          in modal stacking.
// z-[70]:  NotificationCenter floating mode
//
// ---------------------------------------------------------------------------
// Prop API
// ---------------------------------------------------------------------------
export interface ModalProps {
  /** Whether the dialog is open. When false the portal is not mounted. */
  open: boolean;
  /** Called when the modal requests to close (Escape, backdrop click, or close button). */
  onClose: () => void;
  /** Dialog content. */
  children: React.ReactNode;
  /**
   * id of the element used as the dialog label (aria-labelledby).
   * Pass the id you assign to your title element inside children.
   */
  labelledById?: string;
  /**
   * id of the element used as the dialog description (aria-describedby).
   */
  describedById?: string;
  /**
   * When true (default) pressing Escape calls onClose.
   * Set to false to prevent close during in-flight mutations.
   */
  closeOnEscape?: boolean;
  /**
   * When true (default) clicking the backdrop calls onClose.
   * Set to false to prevent close during in-flight mutations.
   */
  closeOnBackdrop?: boolean;
  /** Extra className applied to the dialog container div. */
  className?: string;
  /**
   * Ref to the element that should receive focus when the dialog opens.
   * Falls back to the first focusable element, then the dialog container.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

// ---------------------------------------------------------------------------
// Open-modal stack
// ---------------------------------------------------------------------------
// Module-level stack of currently-open modal ids. Only the top-most (last
// opened) modal reacts to Escape, so stacked modals (e.g. a ConfirmDialog over
// an edit modal) close one layer per press instead of all collapsing at once.
// This equates "last-opened" with "visually top-most", which holds because
// every Modal renders at the same z-index (z-[60]) and portals append in open
// order, so open-order == paint-order. A consumer overriding the z-index would
// break that assumption.
const openModalStack: string[] = [];

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  children,
  labelledById,
  describedById,
  closeOnEscape = true,
  closeOnBackdrop = true,
  className = "",
  initialFocusRef,
}) => {
  // Ref for the dialog container (used for focus trap and fallback focus).
  const dialogRef = useRef<HTMLDivElement>(null);
  // Ref to the element that was focused before the modal opened.
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // Stable id identifying this modal in the module-level open-modal stack.
  const modalId = useId();

  // Register/unregister in the open-modal stack while open, so the Escape
  // handler can tell whether this modal is the top-most layer. Without this,
  // every open Modal's document keydown listener fires on Escape and closes
  // all stacked modals at once.
  useEffect(() => {
    if (!open) return;
    openModalStack.push(modalId);
    return () => {
      const idx = openModalStack.lastIndexOf(modalId);
      if (idx !== -1) openModalStack.splice(idx, 1);
    };
  }, [open, modalId]);

  // Capture the active element on mount so we can restore it on close.
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    }
  }, [open]);

  // Move focus into the dialog after it mounts.
  // createPortal makes the content available synchronously in the DOM before
  // the useEffect fires, so a direct focus call is safe here — no rAF needed.
  useEffect(() => {
    if (!open) return;

    if (initialFocusRef?.current) {
      initialFocusRef.current.focus();
    } else {
      const dialog = dialogRef.current;
      if (dialog) {
        const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
        if (first) {
          first.focus();
        } else {
          dialog.focus();
        }
      }
    }

    return () => {
      // Restore focus to the previously-focused element when dialog closes.
      previousFocusRef.current?.focus();
    };
  }, [open, initialFocusRef]);

  // Escape key handler.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Only the top-most (last-opened) modal closes on Escape, so a stacked
        // modal collapses one layer at a time instead of all at once.
        const isTopMost =
          openModalStack[openModalStack.length - 1] === modalId;
        if (closeOnEscape && isTopMost) onClose();
        return;
      }
      // Focus trap: Tab and Shift+Tab.
      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          // Shift+Tab from first -> wrap to last.
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          // Tab from last -> wrap to first.
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [closeOnEscape, onClose, modalId],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  // AnimatePresence stays mounted; the keyed child is gated by `open` so its
  // descendants' `exit` animations play on close before the node is removed.
  // (An early `if (!open) return null` would unmount AnimatePresence wholesale
  // and skip the exit animation.)
  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          key="modal"
          className="fixed inset-0 z-[60] flex items-center justify-center"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => closeOnBackdrop && onClose()}
            aria-hidden="true"
          />

          {/* Dialog */}
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledById}
            aria-describedby={describedById}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className={`relative z-[1] ${className}`}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
