// @vitest-environment jsdom
/**
 * Render-level landmark guard (axe rule landmark-one-main) for the three
 * routes that render outside PageShell: ChatLayout (route /room/:roomId),
 * LandingPage (route / logged out) and NotFoundPage (route *). AppShell must
 * not provide the main (AppShellA11y.test.tsx pins that), so each of these
 * pages owns exactly one. Same render-assertion style as
 * LoginPageA11y.test.tsx's landmark test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ChatLayout } from "../components/layout/ChatLayout";
import { LandingPage } from "../pages/LandingPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { useChatStore } from "../stores/chatStore";
import { useSocketStore } from "../stores/socketStore";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LanguageProvider } from "../contexts/LanguageContext";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  // Render in English for deterministic text (both providers read
  // localStorage in their useState initializer, before the first render).
  localStorage.setItem("triologue_language", "en");
  localStorage.setItem("triologue_theme", "dark");
});

// The zustand load actions hit the network on mount; swap them for spies and
// start from an empty-room state so the render is hermetic (same approach as
// MessageListState.test.tsx).
beforeEach(() => {
  useChatStore.setState({
    currentRoom: null,
    messages: [],
    isLoading: false,
    messagesError: false,
    loadRoom: vi.fn(async () => undefined),
    loadMessages: vi.fn(async () => undefined),
    loadMoreMessages: vi.fn(async () => undefined),
  });
  useSocketStore.setState({
    isConnected: false,
    typingUsers: [],
    addReaction: vi.fn(),
  });
});

const expectExactlyOneMain = () => {
  // Mutation-sensitive: reverting the new <main> to a plain <div> (or adding
  // a second <main>) fails this.
  const mains = screen.getAllByRole("main");
  expect(mains).toHaveLength(1);
  expect(mains[0].tagName).toBe("MAIN");
};

describe("ChatLayout landmark (RTL)", () => {
  it("wraps the message area and composer in exactly one main landmark", () => {
    render(
      <ThemeProvider>
        <LanguageProvider>
          <MemoryRouter initialEntries={["/room/r1"]}>
            <Routes>
              <Route path="/room/:roomId" element={<ChatLayout />} />
            </Routes>
          </MemoryRouter>
        </LanguageProvider>
      </ThemeProvider>,
    );

    expectExactlyOneMain();
    // The main is the whole room view (room header + message column +
    // composer), so nothing on the page sits outside a landmark.
    const main = screen.getByRole("main");
    expect(main.querySelector("textarea")).toBeTruthy();
    expect(main.textContent).toContain("No messages yet");
  });

  it("renders the room header as a <header> inside the main, never a second banner", () => {
    const { container } = render(
      <ThemeProvider>
        <LanguageProvider>
          <MemoryRouter initialEntries={["/room/r1"]}>
            <Routes>
              <Route path="/room/:roomId" element={<ChatLayout />} />
            </Routes>
          </MemoryRouter>
        </LanguageProvider>
      </ThemeProvider>,
    );

    // Mutation-sensitive: reverting the wrapper to a bare <div> fails the
    // tagName check; moving the <header> out of <main> fails the containment
    // check, which is the accessibility-relevant condition (per the AAM a
    // <header> nested in <main> is not a banner; jsdom's role API does not
    // implement that nesting rule, so the browser-side banner count is
    // checked with axe instead).
    const headers = container.querySelectorAll("header");
    expect(headers).toHaveLength(1);
    const header = headers[0];
    expect(header.tagName).toBe("HEADER");
    expect(header.closest("main")).toBeTruthy();
    // The room title (the page's h1) lives inside it.
    expect(header.querySelector("h1")).toBeTruthy();
  });
});

describe("LandingPage landmark (RTL)", () => {
  it("wraps the page content in exactly one main landmark", () => {
    render(
      <ThemeProvider>
        <LanguageProvider>
          <MemoryRouter initialEntries={["/"]}>
            <LandingPage />
          </MemoryRouter>
        </LanguageProvider>
      </ThemeProvider>,
    );

    expectExactlyOneMain();
    // Nav and footer are landmarks of their own and stay outside the main.
    const main = screen.getByRole("main");
    expect(main.contains(screen.getByRole("navigation"))).toBe(false);
    expect(main.querySelector("footer")).toBeNull();
  });
});

describe("NotFoundPage landmark (RTL)", () => {
  it("wraps the 404 content in exactly one main landmark", () => {
    render(
      <ThemeProvider>
        <LanguageProvider>
          <MemoryRouter initialEntries={["/does-not-exist"]}>
            <NotFoundPage />
          </MemoryRouter>
        </LanguageProvider>
      </ThemeProvider>,
    );

    expectExactlyOneMain();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("404");
  });
});
