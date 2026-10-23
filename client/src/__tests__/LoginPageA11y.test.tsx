// @vitest-environment jsdom
/**
 * Render-level a11y guard for LoginPage's credential fields (a11y round 3):
 * every field must be reachable by its visible label (label htmlFor <->
 * Input id via useId) and must carry the right autocomplete token, so
 * password managers and autofill work. See AdminPageA11y.test.tsx for why a
 * real render assertion is used.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "../pages/LoginPage";

afterEach(() => {
  cleanup();
});

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => {
  const messages: Record<string, string> = {
    "login.username": "Username",
    "login.password": "Password",
    "login.displayName": "Display Name",
    "login.email": "Email Address",
    "login.confirmPassword": "Confirm Password",
    "login.inviteCode": "Invite Code",
  };
  const t = (key: string) => messages[key] ?? key;
  return {
    useLanguage: () => ({ t, language: "en", setLanguage: vi.fn() }),
  };
});

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({
    login: vi.fn(),
    register: vi.fn(),
    isSubmitting: false,
    clearError: vi.fn(),
  }),
}));

vi.mock("../lib/apiClient", () => ({
  apiClient: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ registrationMode: "open" }),
  })),
}));

const renderAt = (path: "/login" | "/register") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <LoginPage />
    </MemoryRouter>,
  );

describe("LoginPage login-mode fields (RTL)", () => {
  it("associates both labels with their inputs and sets login autocomplete tokens", () => {
    renderAt("/login");

    // Mutation-sensitive: fails if an htmlFor/id pair is dropped (label
    // lookup throws) or if an autocomplete token is dropped or swapped.
    const username = screen.getByLabelText(/^Username/);
    expect(username.tagName).toBe("INPUT");
    expect(username.getAttribute("autocomplete")).toBe("username");

    const password = screen.getByLabelText(/^Password/);
    expect(password.tagName).toBe("INPUT");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
  });
});

describe("LoginPage register-mode fields (RTL)", () => {
  it("associates all five labels and sets register autocomplete tokens", () => {
    renderAt("/register");

    const username = screen.getByLabelText(/^Username/);
    expect(username.getAttribute("autocomplete")).toBe("username");

    const displayName = screen.getByLabelText(/^Display Name/);
    expect(displayName.tagName).toBe("INPUT");
    expect(displayName.getAttribute("autocomplete")).toBe("nickname");

    const email = screen.getByLabelText(/^Email/);
    expect(email.tagName).toBe("INPUT");
    expect(email.getAttribute("autocomplete")).toBe("email");

    // /Password/ anchored at start matches only the Password field
    // ("Confirm Password *" starts with "Confirm").
    const password = screen.getByLabelText(/^Password/);
    expect(password.tagName).toBe("INPUT");
    expect(password.getAttribute("autocomplete")).toBe("new-password");

    const confirmPassword = screen.getByLabelText(/Confirm Password/);
    expect(confirmPassword.tagName).toBe("INPUT");
    expect(confirmPassword.getAttribute("autocomplete")).toBe("new-password");
  });
});
