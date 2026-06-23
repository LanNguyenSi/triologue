// @vitest-environment jsdom
/**
 * Behavioral tests for the MessageList connection / load state machine (T10).
 *
 * Runs in jsdom so the three empty-list branches render like the browser. The
 * per-file pragma keeps every other test file in the default node env.
 *
 * The whole point of T10 is that an empty `messages` array no longer always
 * means "empty room": it can also mean "still loading / connecting" or "load
 * failed". These assertions pin all three, so a revert to the old single
 * "always show the empty-room art" branch makes the loading and error cases
 * fail.
 *
 * `messages` is a prop, so we pass []; the loading/error signals live in the
 * zustand store and are driven with useChatStore.setState.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MessageList } from "../components/chat/MessageList";
import { useChatStore } from "../stores/chatStore";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LanguageProvider } from "../contexts/LanguageContext";

const EMPTY_ROOM_EN = "No messages yet. Write the first one!";
const LOAD_ERROR_EN = "Couldn't load messages.";
const RETRY_EN = "Retry";

const renderEmptyList = () =>
  render(
    <ThemeProvider>
      <LanguageProvider>
        <MessageList messages={[]} roomId="r1" />
      </LanguageProvider>
    </ThemeProvider>,
  );

beforeEach(() => {
  // Render in English for deterministic text assertions (both providers read
  // localStorage in their useState initializer, before the first render).
  localStorage.setItem("triologue_language", "en");
  localStorage.setItem("triologue_theme", "dark");
});

afterEach(() => {
  cleanup();
});

describe("MessageList empty-list state machine", () => {
  it("renders the load-error state with a working retry control, not the empty art", () => {
    const loadSpy = vi.fn();
    useChatStore.setState({
      isLoading: false,
      messagesError: true,
      loadMessages: loadSpy,
    });

    renderEmptyList();

    // Error copy is shown; the genuinely-empty copy is NOT.
    expect(screen.getByText(LOAD_ERROR_EN)).toBeTruthy();
    expect(screen.queryByText(EMPTY_ROOM_EN)).toBeNull();

    // Retry re-runs the load for this room.
    const retry = screen.getByRole("button", { name: RETRY_EN });
    fireEvent.click(retry);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledWith("r1");
  });

  it("renders a loading indicator while loading, never the empty-room art", () => {
    useChatStore.setState({
      isLoading: true,
      messagesError: false,
      loadMessages: vi.fn(),
    });

    renderEmptyList();

    // The spinner (role=status) is present, and the empty-room art is not.
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText(EMPTY_ROOM_EN)).toBeNull();
  });

  it("renders the empty-room art only when loaded and not errored", () => {
    useChatStore.setState({
      isLoading: false,
      messagesError: false,
      loadMessages: vi.fn(),
    });

    renderEmptyList();

    expect(screen.getByText(EMPTY_ROOM_EN)).toBeTruthy();
    // No spinner and no retry control in the genuinely-empty state.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: RETRY_EN })).toBeNull();
  });
});
