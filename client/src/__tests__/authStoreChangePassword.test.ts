// @vitest-environment jsdom
/**
 * authStore.changePassword (PUT /api/auth/change-password) and
 * setSessionToken. The server revokes every earlier session token on a
 * password change and returns the replacement; the store must swap it in
 * (localStorage, state, socket) or the user is logged out right after.
 *
 * Mutation-check intent: drop the setSessionToken call after a successful
 * change -> "swaps in the replacement" fails; drop the response.ok guard
 * order (read the token of a failed change) -> "keeps the token" fails; drop
 * the socket reconnect -> the socket assertions fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const socket = vi.hoisted(() => ({ disconnect: vi.fn(), connect: vi.fn() }));
vi.mock("../stores/socketStore", () => ({
  useSocketStore: { getState: () => socket },
}));

import { useAuthStore } from "../stores/authStore";

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.setItem("triologue_token", "old-token");
  useAuthStore.setState({ token: "old-token", error: null });
  socket.disconnect.mockClear();
  socket.connect.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const reply = (ok: boolean, status: number, body: unknown) => ({ ok, status, json: async () => body });

describe("authStore.changePassword", () => {
  it("swaps in the replacement token: storage, state and a socket reconnect", async () => {
    fetchMock.mockResolvedValue(reply(true, 200, { message: "Password changed successfully", token: "fresh-token" }));

    await useAuthStore.getState().changePassword("OldPassword1", "NewPassword2");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/auth\/change-password$/);
    expect(init.headers.Authorization).toBe("Bearer old-token");
    expect(localStorage.getItem("triologue_token")).toBe("fresh-token");
    expect(useAuthStore.getState().token).toBe("fresh-token");
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(socket.disconnect.mock.invocationCallOrder[0]).toBeLessThan(socket.connect.mock.invocationCallOrder[0]);
  });

  it("keeps the token when the answer carries none", async () => {
    fetchMock.mockResolvedValue(reply(true, 200, { message: "Password changed successfully" }));

    await useAuthStore.getState().changePassword("OldPassword1", "NewPassword2");

    expect(localStorage.getItem("triologue_token")).toBe("old-token");
    expect(useAuthStore.getState().token).toBe("old-token");
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it("keeps the token and throws when the change is refused", async () => {
    fetchMock.mockResolvedValue(reply(false, 401, { error: "Current password is incorrect", token: "must-not-be-used" }));

    await expect(useAuthStore.getState().changePassword("Wrong", "NewPassword2")).rejects.toThrow(
      "Current password is incorrect",
    );

    expect(localStorage.getItem("triologue_token")).toBe("old-token");
    expect(useAuthStore.getState().token).toBe("old-token");
    expect(socket.connect).not.toHaveBeenCalled();
  });
});
