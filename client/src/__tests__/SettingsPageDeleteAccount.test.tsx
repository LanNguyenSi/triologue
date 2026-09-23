// @vitest-environment jsdom
/**
 * Settings delete-account flow (task 691cb804): the form must ask for the
 * account password and send it in the DELETE /api/auth/me body, and each
 * of 400/403/409/500 must show a translated message instead of the button
 * silently doing nothing (pre-existing bug found in review of 6bc2a14c,
 * batch 61: the client sent no body and ignored non-OK responses).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SettingsPage } from "../pages/SettingsPage";

afterEach(() => {
  cleanup();
  logout.mockClear();
  navigate.mockClear();
  apiClientMock.mockClear();
  lastDeleteBody = undefined;
});

const STRINGS: Record<string, string> = {
  "settings.title": "Settings",
  "settings.subtitle": "Manage your account",
  "settings.preferences": "Preferences",
  "settings.profile": "Profile",
  "settings.myAgents": "My Agents",
  "settings.plugins": "Plugins",
  "settings.connectors": "Connectors",
  "settings.dangerZone": "Danger Zone",
  "settings.deleteAccountText":
    'Permanently delete your account. Type <span class="text-white font-mono">{username}</span> to confirm.',
  "settings.deleteAccount": "Delete Account",
  "settings.deleteAccountPassword": "Password",
  "settings.deleting": "Deleting…",
  "settings.username": "Username",
  "settings.networkError": "Network error.",
  "settings.error.deleteAccountPasswordRequired": "Please enter your password to confirm.",
  "settings.error.deleteAccountIncorrectPassword": "Incorrect password.",
  "settings.error.deleteAccountConflict":
    "Account could not be deleted because related data still references it.",
  "settings.error.deleteAccountServer": "Account could not be deleted. Please try again later.",
  "settings.error.deleteAccountWithStatus": "Account could not be deleted ({status}).",
};

const t = (key: string) => STRINGS[key] ?? key;

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => ({
  useLanguage: () => ({ t, language: "en", setLanguage: vi.fn() }),
}));

const logout = vi.fn();
vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({
    user: { id: "u1", username: "lan", displayName: "Lan" },
    logout,
  }),
}));

vi.mock("../stores/pluginStore", () => ({
  usePluginStore: (selector: (state: { loadPlugins: () => void }) => unknown) =>
    selector({ loadPlugins: vi.fn() }),
}));

vi.mock("../services/connectorApi", () => ({
  fetchUserConnectors: vi.fn(async () => []),
  revokeUserIntegration: vi.fn(async () => undefined),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

type DeleteResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

let deleteMeResponse: DeleteResponse = { ok: true, status: 200, json: async () => ({}) };
const apiClientMock = vi.fn(async (path: string, options?: RequestInit) => {
  if (path === "/api/auth/me" && options?.method === "DELETE") {
    lastDeleteBody = options?.body as string | undefined;
    return deleteMeResponse;
  }
  // Every other call this page makes on mount (agents, rooms): keep it inert.
  return { ok: false, status: 404, json: async () => ({}) };
});
let lastDeleteBody: string | undefined;

vi.mock("../lib/apiClient", () => ({
  apiClient: (path: string, options?: RequestInit) => apiClientMock(path, options),
}));

const renderSettings = () =>
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );

const openDangerZoneAndFill = async (password: string) => {
  fireEvent.click(screen.getByRole("tab", { name: "Danger Zone" }));
  const usernameInput = await screen.findByLabelText("Username", { exact: false });
  fireEvent.change(usernameInput, { target: { value: "lan" } });
  const passwordInput = screen.getByLabelText("Password", { exact: false });
  fireEvent.change(passwordInput, { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Delete Account" }));
};

describe("SettingsPage delete-account flow (AC-001)", () => {
  it("sends the password in the DELETE /api/auth/me body and logs the user out on success", async () => {
    deleteMeResponse = { ok: true, status: 200, json: async () => ({ message: "ok" }) };
    renderSettings();

    await openDangerZoneAndFill("correct-horse-battery-staple");

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("/");
    expect(lastDeleteBody).toBe(JSON.stringify({ password: "correct-horse-battery-staple" }));
  });

  it("shows a translated message on 400 (password confirmation required)", async () => {
    deleteMeResponse = { ok: false, status: 400, json: async () => ({ error: "no" }) };
    renderSettings();

    await openDangerZoneAndFill("whatever");

    expect(await screen.findByText("Please enter your password to confirm.")).toBeTruthy();
    expect(logout).not.toHaveBeenCalled();
  });

  it("shows a translated message on 403 (incorrect password)", async () => {
    deleteMeResponse = { ok: false, status: 403, json: async () => ({ error: "no" }) };
    renderSettings();

    await openDangerZoneAndFill("wrong-password");

    expect(await screen.findByText("Incorrect password.")).toBeTruthy();
    expect(logout).not.toHaveBeenCalled();
  });

  it("shows a translated message on 409 explaining remaining linked data blocks deletion", async () => {
    deleteMeResponse = { ok: false, status: 409, json: async () => ({ error: "no", code: "P2003" }) };
    renderSettings();

    await openDangerZoneAndFill("correct-horse-battery-staple");

    expect(
      await screen.findByText("Account could not be deleted because related data still references it."),
    ).toBeTruthy();
    expect(logout).not.toHaveBeenCalled();
  });

  it("shows a translated message on 500", async () => {
    deleteMeResponse = { ok: false, status: 500, json: async () => ({ error: "no" }) };
    renderSettings();

    await openDangerZoneAndFill("correct-horse-battery-staple");

    expect(await screen.findByText("Account could not be deleted. Please try again later.")).toBeTruthy();
    expect(logout).not.toHaveBeenCalled();
  });
});
