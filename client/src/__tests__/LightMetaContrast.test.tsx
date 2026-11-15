// @vitest-environment jsdom
/**
 * Contrast guards for two light-scheme meta colours (jsdom pattern with a
 * switchable themeState like LowContrastMetaTernaries.test.tsx; the class
 * list is the behaviour contract, jsdom does not run Tailwind's CSS).
 * - ProjectOverviewCard room id used text-blue-400 in light (2.54:1 on the
 *   white cell, no dark branch); light is now text-blue-700 (6.70:1) and
 *   dark text-blue-300, the same pair as the room link below it.
 * - MessageItem header timestamp used text-gray-500 in light (4.44:1 on the
 *   own-message bg-blue-50 row); light is now text-gray-600 (6.94:1), dark
 *   keeps text-gray-400.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectOverviewCard } from "../components/projects/ProjectOverviewCard";
import { MessageItem } from "../components/chat/MessageItem";
import { Message } from "../types/chat";
import type { Project } from "../projects/projectDomainTypes";

const themeState = vi.hoisted(() => ({ theme: "light" }));

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: themeState.theme, setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: "en",
    setLanguage: vi.fn(),
  }),
}));

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({
    user: { id: "user-1", username: "lan", displayName: "Lan", isAdmin: true },
  }),
}));

vi.mock("../stores/chatStore", () => ({
  useChatStore: () => ({
    deleteMessage: vi.fn(),
    pinMessage: vi.fn(),
    unpinMessage: vi.fn(),
  }),
}));

vi.mock("../components/chat/MessageRenderer", () => ({
  MessageRenderer: () => null,
}));

vi.mock("../components/chat/ReactionSystem", () => ({
  ReactionSystem: () => null,
  aggregateReactions: () => [],
}));

vi.mock("../components/ui/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

afterEach(() => {
  cleanup();
  themeState.theme = "light";
});

const project: Project = {
  id: "p1",
  name: "Website relaunch",
  description: null,
  status: "active",
  ownerId: "u1",
  roomId: "r3",
  teamMemberIds: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const roomIdEl = () =>
  document.querySelector("div.break-all") as HTMLElement;

describe("ProjectOverviewCard room id contrast", () => {
  it("light: room id is text-blue-700, never text-blue-400", () => {
    themeState.theme = "light";
    render(
      <MemoryRouter>
        <ProjectOverviewCard project={project} />
      </MemoryRouter>,
    );
    const el = roomIdEl();
    expect(el.textContent).toBe("r3");
    expect(el.className).toContain("text-blue-700");
    expect(el.className).not.toContain("text-blue-400");
    expect(el.className).not.toContain("text-blue-300");
  });

  it("dark: room id is text-blue-300, never text-blue-400", () => {
    themeState.theme = "dark";
    render(
      <MemoryRouter>
        <ProjectOverviewCard project={project} />
      </MemoryRouter>,
    );
    const el = roomIdEl();
    expect(el.className).toContain("text-blue-300");
    expect(el.className).not.toContain("text-blue-400");
    expect(el.className).not.toContain("text-blue-700");
  });
});

const message: Message = {
  id: "msg-1",
  content: "hello",
  sender: {
    id: "user-2",
    username: "ice",
    displayName: "Ice Agent",
    userType: "AI",
  },
  createdAt: new Date().toISOString(),
};

const headerTimestamp = () =>
  document.querySelector("span.cursor-default") as HTMLElement;

describe("MessageItem header timestamp contrast", () => {
  it("light: timestamp is text-gray-600, not text-gray-500", () => {
    themeState.theme = "light";
    render(<MessageItem message={message} isGrouped={false} canPin />);
    const ts = headerTimestamp();
    expect(ts.className).toContain("text-gray-600");
    expect(ts.className).not.toContain("text-gray-500");
    expect(ts.className).not.toContain("text-gray-400");
  });

  it("dark: timestamp keeps text-gray-400", () => {
    themeState.theme = "dark";
    render(<MessageItem message={message} isGrouped={false} canPin />);
    const ts = headerTimestamp();
    expect(ts.className).toContain("text-gray-400");
    expect(ts.className).not.toContain("text-gray-600");
  });
});
