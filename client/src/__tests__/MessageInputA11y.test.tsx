// @vitest-environment jsdom
/**
 * Render-level a11y guard for MessageInput's clear-attached-file button
 * (a11y round 2, task 74d695bb, control 2/7 from PR #211's icon-only-button
 * sweep). See ConfirmDialogA11y.test.tsx for why a real render assertion is
 * needed in addition to the source-text guard in uiConsistency.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageInput } from "../components/chat/MessageInput";

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

vi.mock("../stores/socketStore", () => ({
  useSocketStore: () => ({ sendMessage: vi.fn(() => true) }),
}));

describe("MessageInput clear-attached-file button (RTL)", () => {
  it("becomes a named button once a file is attached", async () => {
    const user = userEvent.setup();
    const { container } = render(<MessageInput roomId="room-1" />);

    // No file attached yet: the clear button is not in the DOM at all.
    expect(
      screen.queryByRole("button", { name: "chat.attachFile.remove" }),
    ).toBeNull();

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await user.upload(fileInput, file);

    await waitFor(() => {
      // Mutation-sensitive: fails if aria-label is dropped or moved off the
      // <button> onto the wrapping div/icon.
      const clearButton = screen.getByRole("button", {
        name: "chat.attachFile.remove",
      });
      expect(clearButton.tagName).toBe("BUTTON");
    });
  });
});
