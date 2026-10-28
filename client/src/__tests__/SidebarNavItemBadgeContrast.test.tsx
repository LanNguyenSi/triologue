// @vitest-environment jsdom
/**
 * Contrast guard for the sidebar nav unread badges (inbox, approvals, chat).
 * Before the fix the badge used bg-blue-500/80 with text-white in BOTH themes
 * (about 2.8:1 in light, axe color-contrast incomplete on the nav badges).
 * Light now pins bg-blue-700 and dark pins bg-blue-600, both white text,
 * mirroring the dashboard unread pill; bg-blue-500 must not come back.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SidebarNavItem } from "../components/layout/SidebarNavItem";
import type { NavItem } from "../components/layout/sidebarTypes";

const themeState = vi.hoisted(() => ({ theme: "light" }));

afterEach(() => {
  cleanup();
});

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

function renderBadge() {
  const item: NavItem = {
    key: "inbox",
    to: "/inbox",
    icon: <span data-testid="icon" />,
    label: "nav.inbox",
    badge: 6,
    match: (path: string) => path === "/inbox",
    available: true,
  };
  render(
    <MemoryRouter>
      <SidebarNavItem item={item} />
    </MemoryRouter>,
  );
  return document.querySelector(
    "a[href='/inbox'] span.rounded-full",
  ) as HTMLElement;
}

describe("SidebarNavItem unread badge contrast", () => {
  it("light: badge uses bg-blue-700 with text-white, never bg-blue-500", () => {
    themeState.theme = "light";
    const badge = renderBadge();
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe("6");
    expect(badge.className).toContain("bg-blue-700");
    expect(badge.className).toContain("text-white");
    expect(badge.className).toContain("text-[10px]");
    expect(badge.className).not.toContain("bg-blue-500");
  });

  it("dark: badge uses bg-blue-600 with text-white, never bg-blue-500", () => {
    themeState.theme = "dark";
    const badge = renderBadge();
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe("6");
    expect(badge.className).toContain("bg-blue-600");
    expect(badge.className).toContain("text-white");
    expect(badge.className).toContain("text-[10px]");
    expect(badge.className).not.toContain("bg-blue-500");
  });
});
