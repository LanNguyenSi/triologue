// @vitest-environment jsdom
/**
 * The socket `error` channel: the server answers a refused send or reaction
 * with `{ message }` (server/src/services/socketService.ts) and nothing
 * reaches the screen until now. Each input combination of the payload and of
 * the stored language is its own case, and the fallback branch is separate
 * from the server-text branch.
 *
 * Mutation intent: drop the `error` listener and every test here fails; drop
 * the generic fallback and the no-message cases fail; drop the cap and the
 * long-message case fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sockets = vi.hoisted(() => {
  const handlers: Record<string, (payload: unknown) => void> = {};
  const socket = {
    connected: true,
    on: (event: string, handler: (payload: unknown) => void) => {
      handlers[event] = handler;
    },
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  return { handlers, socket };
});

const toasts = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("socket.io-client", () => ({ io: () => sockets.socket }));
vi.mock("react-hot-toast", () => ({ default: { error: toasts.error } }));
vi.mock("../lib/apiClient", () => ({ apiClient: vi.fn() }));

import { useSocketStore } from "../stores/socketStore";
import { useAuthStore } from "../stores/authStore";

const emitError = (payload: unknown) => {
  const handler = sockets.handlers["error"];
  if (!handler) throw new Error('no "error" listener registered');
  handler(payload);
};

beforeEach(() => {
  toasts.error.mockReset();
  localStorage.clear();
  useAuthStore.setState({ token: "t", user: null });
  useSocketStore.setState({ socket: null, isConnected: false });
  useSocketStore.getState().connect();
});

afterEach(() => {
  useSocketStore.getState().disconnect();
  localStorage.clear();
});

describe("socket error toast: server message branch", () => {
  it("shows the server's message verbatim when it is a non-empty string", () => {
    emitError({ message: "Not authorized to send messages in this room" });
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(toasts.error).toHaveBeenCalledWith(
      "Not authorized to send messages in this room",
    );
  });

  it("passes the text as a plain string, so react-hot-toast escapes it (no markup)", () => {
    emitError({ message: "<img src=x onerror=alert(1)> closed the send" });
    const shown = toasts.error.mock.calls[0][0];
    expect(typeof shown).toBe("string");
    expect(shown).toBe("<img src=x onerror=alert(1)> closed the send");
  });

  it("is language-independent: the server text wins over the stored language", () => {
    localStorage.setItem("triologue_language", "en");
    emitError({ message: "Message cannot exceed 10,000 characters" });
    expect(toasts.error).toHaveBeenCalledWith(
      "Message cannot exceed 10,000 characters",
    );
    localStorage.setItem("triologue_language", "de");
    emitError({ message: "threadId must name a thread in this room" });
    expect(toasts.error).toHaveBeenLastCalledWith(
      "threadId must name a thread in this room",
    );
  });

  it("caps a long message at 300 characters for display", () => {
    emitError({ message: "x".repeat(1000) });
    const shown = toasts.error.mock.calls[0][0] as string;
    expect(shown.length).toBe(300);
    expect(shown).toBe("x".repeat(300));
  });

  it("keeps a message of exactly 300 characters whole", () => {
    emitError({ message: "y".repeat(300) });
    expect(toasts.error.mock.calls[0][0]).toBe("y".repeat(300));
  });
});

describe("socket error toast: generic fallback branch", () => {
  const DE = "Nachricht konnte nicht gesendet werden.";
  const EN = "Message could not be sent.";

  it("English text with an absent payload and language en", () => {
    localStorage.setItem("triologue_language", "en");
    emitError(undefined);
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(toasts.error).toHaveBeenCalledWith(EN);
  });

  it("German text with an absent payload and language de", () => {
    localStorage.setItem("triologue_language", "de");
    emitError(undefined);
    expect(toasts.error).toHaveBeenCalledWith(DE);
  });

  it("German text with an absent payload and no stored language (default)", () => {
    emitError(undefined);
    expect(toasts.error).toHaveBeenCalledWith(DE);
  });

  it("English text with an empty object payload and language en", () => {
    localStorage.setItem("triologue_language", "en");
    emitError({});
    expect(toasts.error).toHaveBeenCalledWith(EN);
  });

  it("falls back for a null payload", () => {
    localStorage.setItem("triologue_language", "en");
    emitError(null);
    expect(toasts.error).toHaveBeenCalledWith(EN);
  });

  it("falls back for a non-object payload", () => {
    localStorage.setItem("triologue_language", "en");
    emitError("boom");
    expect(toasts.error).toHaveBeenCalledWith(EN);
  });

  it("falls back when message is not a string", () => {
    localStorage.setItem("triologue_language", "en");
    emitError({ message: 42 });
    expect(toasts.error).toHaveBeenCalledWith(EN);
  });

  it("falls back when message is empty or only blanks", () => {
    localStorage.setItem("triologue_language", "en");
    emitError({ message: "" });
    expect(toasts.error).toHaveBeenNthCalledWith(1, EN);
    emitError({ message: "   \t " });
    expect(toasts.error).toHaveBeenNthCalledWith(2, EN);
  });

  it("keeps the payload's other fields (code, roomId) out of the toast", () => {
    localStorage.setItem("triologue_language", "en");
    emitError({ code: "PROJECT_CLOSED", roomId: "r1" });
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(toasts.error).toHaveBeenCalledWith(EN);
  });

  it("shows the closed-project message the server sends with a code", () => {
    emitError({
      code: "PROJECT_CLOSED",
      roomId: "r1",
      message: "Messages are disabled because the linked project is closed.",
    });
    expect(toasts.error).toHaveBeenCalledWith(
      "Messages are disabled because the linked project is closed.",
    );
  });
});
