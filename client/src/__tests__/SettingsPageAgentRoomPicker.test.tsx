// @vitest-environment jsdom
/**
 * Settings "register agent" room picker: the server adds a new agent to a room
 * only for an OWNER or ADMIN of that room (or a system admin), so the picker
 * must not offer the rooms the user merely belongs to.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SettingsPage } from "../pages/SettingsPage";

const STRINGS: Record<string, string> = {
  "settings.title": "Settings",
  "settings.myAgents": "My Agents",
  "settings.addToRoom": "Add to room",
};
const t = (key: string) => STRINGS[key] ?? key;

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => ({
  useLanguage: () => ({ t, language: "en", setLanguage: vi.fn() }),
}));

let currentUser: { id: string; username: string; displayName: string; isAdmin?: boolean };
vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({ user: currentUser, logout: vi.fn() }),
}));

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

let roomsPayload: unknown[] = [];
const apiClientMock = vi.fn(async (path: string) => {
  if (path === "/api/rooms") return { ok: true, status: 200, json: async () => roomsPayload };
  return { ok: false, status: 404, json: async () => ({}) };
});
vi.mock("../lib/apiClient", () => ({
  apiClient: (path: string) => apiClientMock(path),
}));

// jsdom does not implement scrollIntoView, which the open Select calls.
Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
  apiClientMock.mockClear();
});

const room = (id: string, name: string, role?: string) => ({ id, name, role });

const offeredRooms = async (): Promise<string[]> => {
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(apiClientMock).toHaveBeenCalledWith("/api/rooms"));
  fireEvent.click(screen.getByRole("tab", { name: "My Agents" }));
  fireEvent.click(await screen.findByRole("button", { name: /Add to room/ }));
  const listbox = await screen.findByRole("listbox");
  return Array.from(listbox.querySelectorAll('[role="option"]')).map((o) => o.textContent ?? "");
};

describe("Settings agent room picker", () => {
  it("offers OWNER and ADMIN rooms and hides MEMBER rooms", async () => {
    currentUser = { id: "u1", username: "lan", displayName: "Lan" };
    roomsPayload = [
      room("r1", "Owned room", "OWNER"),
      room("r2", "Member room", "MEMBER"),
      room("r3", "Admin room", "ADMIN"),
    ];

    const options = await offeredRooms();

    expect(options).toEqual(["Owned room", "Admin room"]);
  });

  it("offers nothing for a user who is only a MEMBER everywhere", async () => {
    currentUser = { id: "u1", username: "lan", displayName: "Lan" };
    roomsPayload = [room("r2", "Member room", "MEMBER")];

    const options = await offeredRooms();

    expect(options).toEqual([]);
  });

  it("hides a room whose payload carries no role (fails closed)", async () => {
    currentUser = { id: "u1", username: "lan", displayName: "Lan" };
    roomsPayload = [room("r1", "Roleless room"), room("r2", "Owned room", "OWNER")];

    const options = await offeredRooms();

    expect(options).toEqual(["Owned room"]);
  });

  it("a system admin sees every listed room whatever the room role", async () => {
    currentUser = { id: "u1", username: "root", displayName: "Root", isAdmin: true };
    roomsPayload = [
      room("r1", "Owned room", "OWNER"),
      room("r2", "Member room", "MEMBER"),
      room("r3", "Roleless room"),
    ];

    const options = await offeredRooms();

    expect(options).toEqual(["Owned room", "Member room", "Roleless room"]);
  });

  it("isAdmin: false does not widen the list", async () => {
    currentUser = { id: "u1", username: "lan", displayName: "Lan", isAdmin: false };
    roomsPayload = [room("r1", "Owned room", "OWNER"), room("r2", "Member room", "MEMBER")];

    const options = await offeredRooms();

    expect(options).toEqual(["Owned room"]);
  });
});
