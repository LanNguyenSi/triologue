// @vitest-environment jsdom
/**
 * Settings change-password flow. The server revokes every earlier session
 * token on a password change and answers PATCH /api/auth/me with the
 * replacement; the page must hand it to the auth store, or the user is logged
 * out on the next request.
 *
 * Mutation-check intent: drop the setSessionToken call in changePassword ->
 * the "stores the replacement token" case fails; call it without checking the
 * response -> the "no token in the answer" and "failed change" cases fail.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SettingsPage } from "../pages/SettingsPage";

const STRINGS: Record<string, string> = {
  "settings.title": "Settings",
  "settings.subtitle": "Manage your account",
  "settings.preferences": "Preferences",
  "settings.profile": "Profile",
  "settings.myAgents": "My Agents",
  "settings.plugins": "Plugins",
  "settings.connectors": "Connectors",
  "settings.dangerZone": "Danger Zone",
  "settings.changePassword": "Change Password",
  "settings.currentPassword": "Current password",
  "settings.newPassword": "New password",
  "settings.confirmNewPassword": "Confirm new password",
  "settings.passwordChanged": "Password changed.",
  "settings.networkError": "Network error.",
};
const t = (key: string) => STRINGS[key] ?? key;

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));
vi.mock("../contexts/LanguageContext", () => ({
  useLanguage: () => ({ t, language: "en", setLanguage: vi.fn() }),
}));

const { setSessionToken, logout } = vi.hoisted(() => ({ setSessionToken: vi.fn(), logout: vi.fn() }));
vi.mock("../stores/authStore", () => {
  const useAuthStore = Object.assign(
    () => ({ user: { id: "u1", username: "lan", displayName: "Lan" }, logout }),
    { getState: () => ({ token: "old-token", setSessionToken }), setState: vi.fn() },
  );
  return { useAuthStore };
});
vi.mock("../stores/pluginStore", () => ({
  usePluginStore: (selector: (state: { loadPlugins: () => void }) => unknown) =>
    selector({ loadPlugins: vi.fn() }),
}));
vi.mock("../services/connectorApi", () => ({
  fetchUserConnectors: vi.fn(async () => []),
  revokeUserIntegration: vi.fn(async () => undefined),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

type PatchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
let patchResponse: PatchResponse = { ok: true, status: 200, json: async () => ({}) };
let patchBody: string | undefined;
vi.mock("../lib/apiClient", () => ({
  apiClient: async (path: string, options?: RequestInit) => {
    if (path === "/api/auth/me" && options?.method === "PATCH") {
      patchBody = options.body as string;
      return patchResponse;
    }
    return { ok: false, status: 404, json: async () => ({}) };
  },
}));

afterEach(() => {
  cleanup();
  setSessionToken.mockClear();
  patchBody = undefined;
});

const submitPasswordChange = async () => {
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
  await screen.findByLabelText("Current password", { exact: false });
  const field = (id: string, value: string) =>
    fireEvent.change(document.getElementById(id) as HTMLInputElement, { target: { value } });
  field("settings-current-password", "OldPassword1");
  field("settings-new-password", "NewPassword2");
  field("settings-confirm-password", "NewPassword2");
  fireEvent.click(screen.getByRole("button", { name: "Change Password" }));
};

describe("SettingsPage change password keeps the session alive", () => {
  it("stores the replacement token the server returns", async () => {
    patchResponse = { ok: true, status: 200, json: async () => ({ message: "Profile updated.", token: "fresh-token" }) };
    await submitPasswordChange();

    await waitFor(() => expect(setSessionToken).toHaveBeenCalledWith("fresh-token"));
    expect(patchBody).toBe(JSON.stringify({ currentPassword: "OldPassword1", newPassword: "NewPassword2" }));
    expect(await screen.findByText("Password changed.")).toBeTruthy();
  });

  it("leaves the token alone when the answer carries none", async () => {
    patchResponse = { ok: true, status: 200, json: async () => ({ message: "Profile updated." }) };
    await submitPasswordChange();

    expect(await screen.findByText("Password changed.")).toBeTruthy();
    expect(setSessionToken).not.toHaveBeenCalled();
  });

  it("leaves the token alone when the change failed", async () => {
    patchResponse = { ok: false, status: 401, json: async () => ({ error: "Current password incorrect.", token: "must-not-be-used" }) };
    await submitPasswordChange();

    expect(await screen.findByText("Current password incorrect.")).toBeTruthy();
    expect(setSessionToken).not.toHaveBeenCalled();
  });
});
