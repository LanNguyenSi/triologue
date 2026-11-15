// @vitest-environment jsdom
/**
 * The register form's invite field must fit every code the server mints.
 *
 * Admin codes are 12 hex characters (server/src/routes/admin.ts) and user
 * codes are 10 (server/src/lib/inviteRedemption.ts); the server's register
 * schema accepts at most 20 alphanumeric characters. The field used to cap
 * at 10, so a typed or pasted admin code was cut to 10 characters and
 * refused as invalid. These tests pin the field to the shared constant
 * (equal to the server's limit of 20) and show a 12-character code survives
 * typing, pasting and the ?invite= URL prefill. LoginPageA11y.test.tsx
 * supplies the mock scaffolding this render needs.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "../pages/LoginPage";
import { INVITE_CODE_MAX_LENGTH } from "../lib/inviteCode";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
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
    json: async () => ({ registrationMode: "invite" }),
  })),
}));

// The 12-character shape an admin mints (crypto.randomBytes(6) hex).
const ADMIN_CODE = "A1B2C3D4E5F6";

const renderAt = (path: "/login" | "/register") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <LoginPage />
    </MemoryRouter>,
  );

const inviteInput = () =>
  screen.getByLabelText(/^Invite Code/) as HTMLInputElement;

describe("invite field length (RTL)", () => {
  it("caps the field at INVITE_CODE_MAX_LENGTH, the server register schema's limit of 20", () => {
    expect(INVITE_CODE_MAX_LENGTH).toBe(20);

    renderAt("/register");
    const input = inviteInput();

    // Mutation-sensitive: restoring maxLength={10} fails this and every
    // length check below.
    expect(input.maxLength).toBe(INVITE_CODE_MAX_LENGTH);
    expect(input.getAttribute("maxlength")).toBe("20");
  });

  it("keeps all 12 characters of a typed admin code", async () => {
    const user = userEvent.setup();
    renderAt("/register");
    const input = inviteInput();

    await user.click(input);
    await user.keyboard(ADMIN_CODE);

    expect(input.value).toBe(ADMIN_CODE);
    expect(input.value).toHaveLength(12);
  });

  it("keeps all 12 characters of a pasted admin code", async () => {
    const user = userEvent.setup();
    renderAt("/register");
    const input = inviteInput();

    // userEvent.paste applies the field's maxLength like a real paste does,
    // so a cap below 12 would cut the code here.
    await user.click(input);
    await user.paste(ADMIN_CODE);

    expect(input.value).toBe(ADMIN_CODE);
    expect(input.value).toHaveLength(12);
  });

  it("keeps all 12 characters of a ?invite= URL prefill and switches to register", () => {
    // The page reads window.location.search, not the router location.
    window.history.pushState({}, "", `/login?invite=${ADMIN_CODE}`);
    renderAt("/login");

    const input = inviteInput();
    expect(input.value).toBe(ADMIN_CODE);
    expect(input.value).toHaveLength(12);
  });
});
