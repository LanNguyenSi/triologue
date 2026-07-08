// @vitest-environment jsdom
/**
 * Behavioral smoke tests for CreateRoomModal.
 *
 * Follows Modal.test.tsx / EditTaskModal.test.tsx conventions:
 *   - MotionGlobalConfig.skipAnimations = true
 *   - RTL + cleanup() in afterEach
 *   - Mutation-sensitive: removing tested behavior from CreateRoomModal.tsx
 *     would fail the corresponding test.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionGlobalConfig } from "framer-motion";
import { CreateRoomModal } from "../components/chat/CreateRoomModal";

MotionGlobalConfig.skipAnimations = true;

afterEach(() => {
  cleanup();
});

// Minimal mock of language context so i18n keys render as-is.
vi.mock("../contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: "en",
    setLanguage: vi.fn(),
  }),
}));

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({ user: { id: "user-1", isAdmin: true } }),
}));

// ---------------------------------------------------------------------------
// 1. Renders via portal when open
// ---------------------------------------------------------------------------
describe("CreateRoomModal renders correctly", () => {
  it("renders the dialog (via Modal's portal) when open=true", () => {
    render(
      <CreateRoomModal open onClose={vi.fn()} onCreate={vi.fn()} />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("chat.createRoom")).toBeTruthy();
  });

  it("does not render content when open=false", async () => {
    render(
      <CreateRoomModal open={false} onClose={vi.fn()} onCreate={vi.fn()} />,
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// 2. Escape key
// ---------------------------------------------------------------------------
describe("CreateRoomModal Escape key", () => {
  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CreateRoomModal open onClose={onClose} onCreate={vi.fn()} />,
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose on Escape while a create is in flight", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    // Never resolves, so the component stays in the loading state.
    const onCreate = vi.fn(() => new Promise<void>(() => undefined));
    render(
      <CreateRoomModal open onClose={onClose} onCreate={onCreate} />,
    );

    const nameInput = screen.getByPlaceholderText("chat.roomNamePlaceholder");
    await user.type(nameInput, "My Room");
    await user.click(screen.getByText("chat.createRoomButton"));

    // Now loading=true; Escape should be blocked.
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Form state resets when reopened
// ---------------------------------------------------------------------------
describe("CreateRoomModal state reset on reopen", () => {
  it("clears a typed name when closed and reopened", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CreateRoomModal open onClose={vi.fn()} onCreate={vi.fn()} />,
    );

    const nameInput = screen.getByPlaceholderText(
      "chat.roomNamePlaceholder",
    ) as HTMLInputElement;
    await user.type(nameInput, "Temporary name");
    expect(nameInput.value).toBe("Temporary name");

    // Close.
    rerender(
      <CreateRoomModal open={false} onClose={vi.fn()} onCreate={vi.fn()} />,
    );

    // Reopen.
    rerender(
      <CreateRoomModal open onClose={vi.fn()} onCreate={vi.fn()} />,
    );

    const reopenedInput = screen.getByPlaceholderText(
      "chat.roomNamePlaceholder",
    ) as HTMLInputElement;
    expect(reopenedInput.value).toBe("");
  });

  it("clears description, private toggle and a stale submit error on reopen", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.reject(new Error("boom-create-failed")));
    const { rerender } = render(
      <CreateRoomModal open onClose={vi.fn()} onCreate={onCreate} />,
    );

    await user.type(
      screen.getByPlaceholderText("chat.roomNamePlaceholder"),
      "Room A",
    );
    await user.type(
      screen.getByPlaceholderText("chat.descriptionPlaceholder"),
      "Some description",
    );
    // Flip the private toggle away from its default (mock user isAdmin=true).
    const toggle = screen.getByRole("button", { name: "chat.privateRoom" });
    await user.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    // Submit; onCreate rejects, so the error banner appears.
    await user.click(screen.getByText("chat.createRoomButton"));
    expect(await screen.findByText("boom-create-failed")).toBeTruthy();

    // Close and reopen.
    rerender(
      <CreateRoomModal open={false} onClose={vi.fn()} onCreate={onCreate} />,
    );
    rerender(
      <CreateRoomModal open onClose={vi.fn()} onCreate={onCreate} />,
    );

    const descInput = screen.getByPlaceholderText(
      "chat.descriptionPlaceholder",
    ) as HTMLInputElement;
    expect(descInput.value).toBe("");
    expect(
      screen
        .getByRole("button", { name: "chat.privateRoom" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByText("boom-create-failed")).toBeNull();
  });

  it("clears an in-flight loading state on reopen", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    // Never resolves: the component is stuck in loading when we close it.
    const onCreate = vi.fn(() => new Promise<void>(() => undefined));
    const { rerender } = render(
      <CreateRoomModal open onClose={onClose} onCreate={onCreate} />,
    );

    await user.type(
      screen.getByPlaceholderText("chat.roomNamePlaceholder"),
      "Room B",
    );
    await user.click(screen.getByText("chat.createRoomButton"));
    expect(screen.getByText("chat.creating")).toBeTruthy();

    rerender(
      <CreateRoomModal open={false} onClose={onClose} onCreate={onCreate} />,
    );
    rerender(
      <CreateRoomModal open onClose={onClose} onCreate={onCreate} />,
    );

    // Loading is reset: the submit button shows its idle label again and
    // Escape (blocked while loading) works once more.
    expect(screen.getByText("chat.createRoomButton")).toBeTruthy();
    expect(screen.queryByText("chat.creating")).toBeNull();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3b. Backdrop click
// ---------------------------------------------------------------------------
describe("CreateRoomModal backdrop click", () => {
  const getBackdrop = () => {
    const backdrop = document.querySelector('div[aria-hidden="true"]');
    if (!backdrop) throw new Error("Modal backdrop not found");
    return backdrop;
  };

  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <CreateRoomModal open onClose={onClose} onCreate={vi.fn()} />,
    );

    fireEvent.click(getBackdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose on backdrop click while a create is in flight", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreate = vi.fn(() => new Promise<void>(() => undefined));
    render(
      <CreateRoomModal open onClose={onClose} onCreate={onCreate} />,
    );

    await user.type(
      screen.getByPlaceholderText("chat.roomNamePlaceholder"),
      "My Room",
    );
    await user.click(screen.getByText("chat.createRoomButton"));

    fireEvent.click(getBackdrop());
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Initial focus lands on the name input
// ---------------------------------------------------------------------------
describe("CreateRoomModal initial focus", () => {
  it("focuses the room name input on open (via Modal initialFocusRef)", () => {
    render(
      <CreateRoomModal open onClose={vi.fn()} onCreate={vi.fn()} />,
    );

    const nameInput = screen.getByPlaceholderText("chat.roomNamePlaceholder");
    expect(document.activeElement).toBe(nameInput);
  });
});
