// @vitest-environment jsdom
/**
 * Behavioral tests for TypingIndicator.
 *
 * Guards the i18n verb selection: "is typing"/"are typing" is resolved
 * via useLanguage (chat.typing.one / chat.typing.many), not hardcoded
 * English. The Rules-of-Hooks regression guard lives in
 * TypingIndicator.hooks.test.tsx, which must run with the REAL context
 * providers (module mocks here replace the hooks with plain functions,
 * so the hook-count invariant could never trip in this file).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TypingIndicator } from "../components/chat/TypingIndicator";

afterEach(() => {
  cleanup();
});

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

describe("TypingIndicator", () => {
  it("renders nothing when no one is typing", () => {
    const { container } = render(<TypingIndicator users={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("uses the singular i18n key for exactly one typist", () => {
    render(<TypingIndicator users={[{ username: "alice", userType: "HUMAN" }]} />);
    expect(screen.getByText(/chat\.typing\.one/)).toBeTruthy();
    expect(screen.queryByText(/chat\.typing\.many/)).toBeNull();
    expect(screen.getByText(/alice/)).toBeTruthy();
  });

  it("uses the plural i18n key for multiple typists", () => {
    render(
      <TypingIndicator
        users={[
          { username: "alice", userType: "HUMAN" },
          { username: "bob", userType: "AI_ICE" },
        ]}
      />,
    );
    expect(screen.getByText(/chat\.typing\.many/)).toBeTruthy();
    expect(screen.queryByText(/chat\.typing\.one/)).toBeNull();
  });

});
