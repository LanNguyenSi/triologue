// @vitest-environment jsdom
/**
 * The register form's live username check must not turn a refused check into
 * a verdict. The server answers 429 once the check-username limiter trips; the
 * body carries only an error, no `available`, which the form used to read as
 * "taken". LoginPageInviteCodeLength.test.tsx supplies the mock scaffolding.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "../pages/LoginPage";
import { apiClient } from "../lib/apiClient";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => {
  const messages: Record<string, string> = {
    "login.username": "Username",
    "login.usernameTaken": "TAKEN",
    "login.usernameAvailable": "AVAILABLE",
    "login.usernameChecking": "CHECKING",
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

vi.mock("../lib/apiClient", () => ({ apiClient: vi.fn() }));

const mockedApi = vi.mocked(apiClient);

const answer = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function route(checkAnswer: Response) {
  mockedApi.mockImplementation(async (path: string) =>
    path.startsWith("/api/auth/check-username")
      ? checkAnswer
      : answer(200, { registrationMode: "open" }),
  );
}

async function typeUsername() {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/register"]}>
      <LoginPage />
    </MemoryRouter>,
  );
  await user.click(screen.getByLabelText(/^Username/));
  await user.keyboard("some_name");
  await waitFor(() =>
    expect(
      mockedApi.mock.calls.some(([p]) => String(p).startsWith("/api/auth/check-username")),
    ).toBe(true),
  );
}

describe("register form username check", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows no verdict when the check is rate limited (429)", async () => {
    route(answer(429, { error: "Too many username checks, please try again later." }));
    await typeUsername();
    await waitFor(() => expect(screen.queryByText("CHECKING")).toBeNull());
    expect(screen.queryByText("TAKEN")).toBeNull();
    expect(screen.queryByText("AVAILABLE")).toBeNull();
  });

  it("still shows taken for an available:false answer", async () => {
    route(answer(200, { available: false }));
    await typeUsername();
    expect(await screen.findByText("TAKEN")).toBeTruthy();
  });

  it("still shows available for an available:true answer", async () => {
    route(answer(200, { available: true }));
    await typeUsername();
    expect(await screen.findByText("AVAILABLE")).toBeTruthy();
  });
});
