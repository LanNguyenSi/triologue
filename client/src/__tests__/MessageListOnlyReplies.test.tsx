// @vitest-environment jsdom
/**
 * The newest page of a room can be nothing but thread replies, which the room
 * list does not show: `messages` is empty while older messages exist. The list
 * then offers "load older" instead of the empty-room art.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MessageList } from "../components/chat/MessageList";
import { useChatStore } from "../stores/chatStore";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LanguageProvider } from "../contexts/LanguageContext";

const EMPTY_ROOM_EN = "No messages yet. Write the first one!";

const renderEmptyList = () =>
  render(
    <ThemeProvider>
      <LanguageProvider>
        <MessageList messages={[]} roomId="r1" />
      </LanguageProvider>
    </ThemeProvider>,
  );

let loadMore: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.setItem("triologue_language", "en");
  localStorage.setItem("triologue_theme", "dark");
  loadMore = vi.fn();
  useChatStore.setState({
    isLoading: false,
    messagesError: false,
    isLoadingMore: false,
    hasMoreMessages: false,
    loadMoreMessages: loadMore,
  });
});

afterEach(() => {
  cleanup();
});

describe("empty list with older messages", () => {
  it("shows a working load-older control instead of the empty-room art", () => {
    useChatStore.setState({ hasMoreMessages: true });
    renderEmptyList();
    expect(screen.queryByText(EMPTY_ROOM_EN)).toBeNull();
    expect(screen.getByText("The newest messages are replies in threads.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Load older messages/ }));
    expect(loadMore).toHaveBeenCalledWith("r1");
  });

  it("disables the control while older messages load", () => {
    useChatStore.setState({ hasMoreMessages: true, isLoadingMore: true });
    renderEmptyList();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("a load error still shows the error, not the control", () => {
    useChatStore.setState({ hasMoreMessages: true, messagesError: true });
    renderEmptyList();
    expect(screen.getByText("Couldn't load messages.")).toBeTruthy();
    expect(screen.queryByText("The newest messages are replies in threads.")).toBeNull();
  });

  it("without older messages the room is genuinely empty", () => {
    renderEmptyList();
    expect(screen.getByText(EMPTY_ROOM_EN)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Load older messages/ })).toBeNull();
  });
});
