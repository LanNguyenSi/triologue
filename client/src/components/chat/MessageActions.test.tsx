// @vitest-environment jsdom
/**
 * MessageActions' copy button used to call `toast.success(t("chat.copied"))`
 * directly: `t(key)` is resolved to a plain string the instant the toast is
 * created, so react-hot-toast keeps that frozen string for the toast's full
 * display duration and a later language switch never retranslates it
 * (i18n-freeze guard, Klasse 2; see README's i18n section). The fix
 * (agent-tasks 4b75a2d7, slice 1) switches to `toastT.success("chat.copied")`
 * (`client/src/lib/i18nToast.tsx`), which passes react-hot-toast a small
 * component that reads `useLanguage()` itself, so the toast re-renders in
 * whatever language is active for as long as it stays mounted. toastT's own
 * re-render mechanics are covered by `client/src/lib/i18nToast.test.tsx`;
 * this test proves MessageActions' copy button actually calls it with the
 * right key (not a hardcoded/eager string), by asserting the toast text
 * follows a real language switch while still on screen.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import toast, { Toaster } from "react-hot-toast";
import { MessageActions } from "./MessageActions";
import { LanguageProvider, useLanguage } from "../../contexts/LanguageContext";
import { ThemeProvider } from "../../contexts/ThemeContext";
import type { Message } from "../../types/chat";

// jsdom does not implement matchMedia; react-hot-toast's <Toaster /> reads
// it (prefers-reduced-motion) on every render to decide its position style.
window.matchMedia =
  window.matchMedia ||
  ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);

afterEach(() => {
  cleanup();
  // react-hot-toast keeps its own module-global toast store independent of
  // React's tree; clear it so a toast fired in one test doesn't leak into
  // the next (see i18nToast.test.tsx's review round 3, F2 fix).
  toast.remove();
  localStorage.clear();
});

const message: Message = {
  id: "m1",
  content: "hello world",
  sender: { id: "u1", username: "alice", displayName: "Alice", userType: "human" },
  createdAt: new Date().toISOString(),
};

function Harness() {
  const { setLanguage } = useLanguage();
  return (
    <>
      <Toaster />
      <MessageActions
        message={message}
        canPin={false}
        canDelete={false}
        isPinning={false}
        isDeleting={false}
        onPin={() => undefined}
        onDelete={() => undefined}
      />
      <button onClick={() => setLanguage("en")}>real-switch-to-en</button>
    </>
  );
}

describe("MessageActions copy toast re-renders in the current language (agent-tasks 4b75a2d7)", () => {
  it("shows the German toast first, then re-renders in English after a real language switch, no stale closure", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });

    render(
      <ThemeProvider>
        <LanguageProvider>
          <Harness />
        </LanguageProvider>
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTitle("Kopieren"));
    await waitFor(() => expect(screen.getByText("Kopiert!")).toBeTruthy());

    fireEvent.click(screen.getByText("real-switch-to-en"));

    await waitFor(() => expect(screen.getByText("Copied!")).toBeTruthy());
    expect(screen.queryByText("Kopiert!")).toBeNull();
  });
});
