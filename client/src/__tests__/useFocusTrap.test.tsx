// @vitest-environment jsdom
/**
 * Tests for useFocusTrap, the focus manager behind the mobile sidebar drawer
 * and the user-menu popup (task 27159b09). Mirrors the jsdom approach used by
 * Modal.test.tsx. jsdom does not move focus on a native Tab press, but the hook
 * moves focus itself (preventDefault + .focus()), so dispatching keydown events
 * exercises the real behavior.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { useRef } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useFocusTrap } from "../hooks/useFocusTrap";

afterEach(cleanup);

const noop = () => {
  /* no-op onEscape for tests that do not assert on it */
};

function Harness({ active, onEscape }: { active: boolean; onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active, onEscape);
  return (
    <div>
      <button data-testid="outside">outside</button>
      <div ref={ref} tabIndex={-1} data-testid="container">
        <button data-testid="first">first</button>
        <button data-testid="last">last</button>
      </div>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("moves focus to the first focusable element on activate", () => {
    render(<Harness active onEscape={noop} />);
    expect(document.activeElement).toBe(screen.getByTestId("first"));
  });

  it("calls onEscape on Escape", () => {
    const onEscape = vi.fn();
    render(<Harness active onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab from the last element back to the first", () => {
    render(<Harness active onEscape={noop} />);
    screen.getByTestId("last").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("first"));
  });

  it("wraps Shift+Tab from the first element back to the last", () => {
    render(<Harness active onEscape={noop} />);
    screen.getByTestId("first").focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId("last"));
  });

  it("does nothing when inactive", () => {
    const onEscape = vi.fn();
    render(<Harness active={false} onEscape={onEscape} />);
    // No element grabbed focus...
    expect(document.activeElement).not.toBe(screen.getByTestId("first"));
    // ...and Escape is not handled.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("restores focus to the previously-focused element on deactivate", () => {
    const { rerender } = render(<Harness active={false} onEscape={noop} />);
    screen.getByTestId("outside").focus();
    expect(document.activeElement).toBe(screen.getByTestId("outside"));

    rerender(<Harness active onEscape={noop} />);
    expect(document.activeElement).toBe(screen.getByTestId("first"));

    rerender(<Harness active={false} onEscape={noop} />);
    expect(document.activeElement).toBe(screen.getByTestId("outside"));
  });
});
