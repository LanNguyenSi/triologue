// @vitest-environment jsdom
/**
 * Render-level a11y guard for ConfirmDialog (a11y round 2, task 74d695bb,
 * control 1/7 from PR #211's icon-only-button sweep).
 *
 * Complements the source-text assertion in uiConsistency.test.ts
 * ("app-wide icon-only buttons carry accessible names...") with a real DOM
 * render: getByRole('button', { name }) fails not only when the aria-label
 * string is wrong, but also when the label attribute silently moves off the
 * actual interactive element (e.g. onto a wrapper div) — a class of
 * regression the source-text grep guard cannot see.
 *
 * Follows Modal.test.tsx / CreateRoomModal.test.tsx conventions:
 *   - MotionGlobalConfig.skipAnimations = true
 *   - RTL + cleanup() in afterEach
 *   - ThemeContext/LanguageContext mocked (real providers need localStorage
 *     + documentElement.classList, see primitives.a11y.test.tsx header).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MotionGlobalConfig } from "framer-motion";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";

MotionGlobalConfig.skipAnimations = true;

afterEach(() => {
  cleanup();
});

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: "en",
    setLanguage: vi.fn(),
  }),
}));

describe("ConfirmDialog icon-only close button (RTL)", () => {
  it("exposes the close X as a named button distinct from Cancel/Confirm", () => {
    render(
      <ConfirmDialog
        open
        title="Delete secret"
        message="Are you sure?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Mutation-sensitive: if aria-label moves off the <button> (e.g. onto a
    // wrapping <span> or the icon itself), this query stops finding it even
    // though the source-text grep guard would still pass.
    const closeButton = screen.getByRole("button", { name: "common.close" });
    expect(closeButton.tagName).toBe("BUTTON");

    // The close X is a distinct control from the text Cancel/Confirm
    // buttons, even though it triggers the same onCancel action.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });
});
