// @vitest-environment jsdom
/**
 * A11y and theme-awareness guards for LoadingSpinner.
 *
 * LoadingSpinner now depends on ThemeContext (useTheme), so unlike the
 * source-text fallback used for Button/EmptyState in primitives.a11y.test.tsx,
 * this file runs under jsdom and mocks useTheme (same pattern as
 * EditTaskModal.test.tsx) so the component can be rendered directly for both
 * themes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { LoadingSpinner } from "../components/ui/LoadingSpinner";

const mockUseTheme = vi.fn();
vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => mockUseTheme(),
}));

afterEach(() => {
  cleanup();
  mockUseTheme.mockReset();
});

describe("LoadingSpinner a11y", () => {
  it("carries role=status so screen readers announce loading", () => {
    mockUseTheme.mockReturnValue({ theme: "dark", setTheme: vi.fn() });
    const { getByRole } = render(<LoadingSpinner />);
    // Removing role="status" from the component causes this to fail.
    expect(getByRole("status")).toBeTruthy();
  });

  it("carries an accessible label so screen readers announce what is loading", () => {
    mockUseTheme.mockReturnValue({ theme: "dark", setTheme: vi.fn() });
    const { getByRole } = render(<LoadingSpinner />);
    // Removing aria-label="Loading" from the component causes this to fail.
    expect(getByRole("status").getAttribute("aria-label")).toBe("Loading");
  });

  it("still renders the visual spinner element", () => {
    mockUseTheme.mockReturnValue({ theme: "dark", setTheme: vi.fn() });
    const { getByRole } = render(<LoadingSpinner />);
    expect(getByRole("status").className).toContain("animate-spin");
  });
});

describe("LoadingSpinner theme-aware border colors", () => {
  it("uses dark-theme border colors when theme is dark", () => {
    mockUseTheme.mockReturnValue({ theme: "dark", setTheme: vi.fn() });
    const { getByRole } = render(<LoadingSpinner />);
    const className = getByRole("status").className;
    expect(className).toContain("border-gray-600");
    expect(className).toContain("border-t-blue-500");
  });

  it("uses light-theme border colors when theme is light", () => {
    mockUseTheme.mockReturnValue({ theme: "light", setTheme: vi.fn() });
    const { getByRole } = render(<LoadingSpinner />);
    const className = getByRole("status").className;
    expect(className).toContain("border-gray-300");
    expect(className).toContain("border-t-blue-600");
  });
});
