// @vitest-environment jsdom
/**
 * Behavioral tests for the App ErrorBoundary crash screen (T6 redesign).
 *
 * Runs in jsdom so React's error-boundary recovery and the DOM <details>
 * element behave like the browser. The per-file pragma keeps every other test
 * file in the default node env.
 *
 * Assertions are mutation-sensitive: they pin the redesigned fallback (brand
 * mark instead of the old emoji, the localized friendly message, and the raw
 * error tucked inside a collapsible <details> rather than printed inline).
 * The ErrorBoundary lives below ThemeProvider in App, so the test wraps it the
 * same way (the Button primitive reads useTheme()).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { ErrorBoundary } from "../App";
import { ThemeProvider } from "../contexts/ThemeContext";

const Boom = () => {
  throw new Error("kaboom-detail-42");
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs the caught error to console.error; the throw is expected here,
  // so silence it to keep the test output clean.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
  cleanup();
});

describe("App ErrorBoundary fallback", () => {
  const renderCrashed = () =>
    render(
      <ThemeProvider>
        <ErrorBoundary
          title="Something went wrong"
          message="Please reload the page."
          reloadLabel="Reload page"
          detailsLabel="Show details"
          theme="dark"
        >
          <Boom />
        </ErrorBoundary>
      </ThemeProvider>,
    );

  it("renders the brand mark plus localized title, message and reload control", () => {
    renderCrashed();

    expect(
      screen.getByRole("img", { name: "OpenTriologue brand mark" }),
    ).toBeTruthy();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByText("Please reload the page.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reload page" }),
    ).toBeTruthy();
  });

  it("hides the raw error inside a collapsible <details>, not inline", () => {
    const { container } = renderCrashed();

    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    // The raw error message must live inside the <details>, behind the summary.
    expect(within(details as HTMLElement).getByText(/kaboom-detail-42/)).toBeTruthy();
    expect(
      within(details as HTMLElement).getByText("Show details"),
    ).toBeTruthy();
  });
});
