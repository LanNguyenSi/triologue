// @vitest-environment jsdom
/**
 * Behavioral tests for the Modal primitive.
 *
 * Runs in jsdom so createPortal and real DOM focus APIs work.
 * The per-file pragma keeps every other test file in the default node env.
 *
 * Assertions are mutation-sensitive — removing the tested behavior from
 * Modal.tsx would fail the corresponding test.
 */
import { useRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionGlobalConfig } from "framer-motion";
import { Modal } from "../components/ui/Modal";

// Make framer-motion animations instant in tests so AnimatePresence exit
// removal is deterministic (no async exit racing the afterEach DOM cleanup).
// Production still animates; this only affects the test environment. Safe as a
// module-level mutation because vitest isolates test files by default, so this
// global does not leak into other test files.
MotionGlobalConfig.skipAnimations = true;

afterEach(() => {
  // Unmount React trees properly (including the body portal) so framer-motion's
  // deferred exit-removal does not race a manual DOM wipe.
  cleanup();
});

// ---------------------------------------------------------------------------
// Helper: a simple modal wrapper so we can open/close from tests.
// ---------------------------------------------------------------------------
function SimpleModal({
  open,
  onClose,
  closeOnEscape = true,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnEscape={closeOnEscape}
      closeOnBackdrop={closeOnBackdrop}
      labelledById="modal-title"
    >
      <h2 id="modal-title">Test dialog</h2>
      <button>First button</button>
      <button>Second button</button>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 1. Dialog has the required ARIA attributes
// ---------------------------------------------------------------------------
describe("Modal ARIA attributes", () => {
  it("renders with role=dialog and aria-modal=true", () => {
    const onClose = vi.fn();
    render(<SimpleModal open onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    // Mutation-sensitive: removing aria-modal from Modal.tsx fails this.
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("wires aria-labelledby to the provided labelledById", () => {
    const onClose = vi.fn();
    render(<SimpleModal open onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe("modal-title");
  });
});

// ---------------------------------------------------------------------------
// 2. Escape triggers onClose
// ---------------------------------------------------------------------------
describe("Modal Escape key", () => {
  it("calls onClose when Escape is pressed and closeOnEscape=true", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SimpleModal open onClose={onClose} closeOnEscape />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when Escape is pressed and closeOnEscape=false", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SimpleModal open onClose={onClose} closeOnEscape={false} />);

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes only the top-most modal when modals are stacked (one Escape)", async () => {
    const user = userEvent.setup();
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    // Two modals open at once; the second-rendered is the top-most layer.
    render(
      <>
        <SimpleModal open onClose={onCloseOuter} />
        <SimpleModal open onClose={onCloseInner} />
      </>,
    );

    await user.keyboard("{Escape}");
    // Mutation-sensitive: without the open-modal-stack gate both onCloses fire.
    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();
  });

  it("with sequentially-opened modals, Escape closes the most-recently-opened one", async () => {
    const user = userEvent.setup();
    const onCloseFirst = vi.fn();
    const onCloseSecond = vi.fn();
    // Open the first modal alone (mirrors EditTaskModal being open).
    const { rerender } = render(
      <>
        <SimpleModal open onClose={onCloseFirst} />
        <SimpleModal open={false} onClose={onCloseSecond} />
      </>,
    );
    // Later, in a separate commit, open the second modal on top (mirrors a
    // ConfirmDialog appearing over the already-open edit modal).
    rerender(
      <>
        <SimpleModal open onClose={onCloseFirst} />
        <SimpleModal open onClose={onCloseSecond} />
      </>,
    );

    await user.keyboard("{Escape}");
    // The later-opened (top) modal closes; the first stays open.
    expect(onCloseSecond).toHaveBeenCalledTimes(1);
    expect(onCloseFirst).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Focus trap: Tab and Shift+Tab cycle within the dialog
// ---------------------------------------------------------------------------
describe("Modal focus trap", () => {
  it("wraps Tab from the last focusable element back to the first", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SimpleModal open onClose={onClose} />);

    const buttons = screen.getAllByRole("button");
    // Focus the last button manually, then Tab.
    buttons[buttons.length - 1].focus();
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);

    await user.tab();
    // Should wrap to the first focusable element.
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("wraps Shift+Tab from the first focusable element back to the last", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SimpleModal open onClose={onClose} />);

    const buttons = screen.getAllByRole("button");
    // Focus the first button manually, then Shift+Tab.
    buttons[0].focus();
    expect(document.activeElement).toBe(buttons[0]);

    await user.tab({ shift: true });
    // Should wrap to the last focusable element.
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });
});

// ---------------------------------------------------------------------------
// 4. Focus restore: previous element regains focus after close
// ---------------------------------------------------------------------------
describe("Modal focus restore", () => {
  it("restores focus to the previously-focused element after close", () => {
    const onClose = vi.fn();

    // Render a trigger button outside the modal.
    const { rerender } = render(
      <>
        <button id="trigger">Open</button>
        <SimpleModal open={false} onClose={onClose} />
      </>,
    );

    const trigger = document.getElementById("trigger") as HTMLButtonElement;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Open the modal (this captures activeElement = trigger).
    rerender(
      <>
        <button id="trigger">Open</button>
        <SimpleModal open onClose={onClose} />
      </>,
    );

    // Close the modal.
    rerender(
      <>
        <button id="trigger">Open</button>
        <SimpleModal open={false} onClose={onClose} />
      </>,
    );

    // Focus should be restored to the trigger.
    expect(document.activeElement).toBe(trigger);
  });
});

// ---------------------------------------------------------------------------
// 5. When open=false, nothing is rendered into the body
// ---------------------------------------------------------------------------
describe("Modal closed state", () => {
  it("renders nothing when open is false", () => {
    const onClose = vi.fn();
    render(<SimpleModal open={false} onClose={onClose} />);

    // No dialog should be present in the DOM.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes the portal from the body when closed", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<SimpleModal open onClose={onClose} />);

    expect(screen.getByRole("dialog")).toBeTruthy();

    rerender(<SimpleModal open={false} onClose={onClose} />);

    // The dialog plays its framer-motion exit animation before unmounting, so
    // removal may be async. waitFor is removal-timing-agnostic: it passes
    // whether the node is dropped synchronously or after the exit settles.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// 6. initialFocusRef: custom initial focus target
// ---------------------------------------------------------------------------
describe("Modal initialFocusRef", () => {
  it("focuses the element referenced by initialFocusRef on open", () => {
    const onClose = vi.fn();

    function ModalWithRef() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <Modal open onClose={onClose} initialFocusRef={ref}>
          <button>First</button>
          <button ref={ref}>Preferred focus</button>
        </Modal>
      );
    }

    render(<ModalWithRef />);

    // Focus is set synchronously in useEffect (no rAF).
    const preferredBtn = screen.getByText("Preferred focus");
    expect(document.activeElement).toBe(preferredBtn);
  });
});
