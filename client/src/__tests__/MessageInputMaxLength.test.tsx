// @vitest-environment jsdom
/**
 * The chat message inputs carry the server's 10,000-character bound as
 * `maxLength`, so a longer paste is cut in the box instead of being dropped by
 * the server without an answer. Mutation intent: remove the attribute from
 * either input (or change the constant) and the matching test fails.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MessageInput } from "../components/chat/MessageInput";
import { ThreadView } from "../components/chat/ThreadView";
import { MAX_MESSAGE_LENGTH } from "../components/chat/chatUtils";
import { makeThread } from "./helpers/threadFixtures";

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

describe("message input maxLength", () => {
  it("the shared constant is the server bound", () => {
    expect(MAX_MESSAGE_LENGTH).toBe(10000);
  });

  it("MessageInput's textarea is bounded", () => {
    const { container } = render(<MessageInput roomId="room-1" />);
    const box = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(box).toBeTruthy();
    expect(box.getAttribute("maxlength")).toBe("10000");
  });

  it("ThreadView's reply textarea is bounded", () => {
    render(<ThreadView thread={makeThread({ id: "t1", title: "T", rootMessageId: "m1" })} />);
    const box = screen.getByLabelText("threads.replyLabel") as HTMLTextAreaElement;
    expect(box.getAttribute("maxlength")).toBe("10000");
  });
});
