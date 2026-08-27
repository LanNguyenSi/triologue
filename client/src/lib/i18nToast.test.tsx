// @vitest-environment jsdom
/**
 * toastT (client/src/lib/i18nToast.tsx) replaces `toast.success(t(key))` /
 * `toast.error(t(key))`: calling `t(key)` at toast-creation time bakes in
 * whichever language was active at that instant, so a language switch that
 * happens while the toast is still on screen never updates it. toastT
 * instead passes react-hot-toast a small component that reads the
 * translation via `useLanguage()`, so it re-renders in the new language for
 * as long as the toast stays mounted (task a34078b6, Slice 3, AC2).
 *
 * Uses two REAL, pre-existing translation keys (not fixture-only) so this
 * test needs no change to LanguageContext.tsx: "common.loading"
 * ("Lade..." / "Loading...") for the success path, "common.cancel"
 * ("Abbrechen" / "Cancel") for the error path.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { Toaster } from "react-hot-toast";
import { toastT } from "./i18nToast";
import { LanguageProvider, useLanguage } from "../contexts/LanguageContext";

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
  // LanguageProvider persists the active language to localStorage; without
  // clearing it here a real setLanguage("en") from one test would leak into
  // the next (see LanguageContext.tsx).
  localStorage.clear();
});

function Controls() {
  const { setLanguage } = useLanguage();
  return (
    <>
      <button onClick={() => toastT.success("common.loading")}>
        fire-success
      </button>
      <button onClick={() => toastT.error("common.cancel")}>
        fire-error
      </button>
      <button onClick={() => setLanguage("en")}>real-switch-to-en</button>
    </>
  );
}

function Harness() {
  return (
    <LanguageProvider>
      <Toaster />
      <Controls />
    </LanguageProvider>
  );
}

describe("toastT.success re-renders an already-visible toast in the new language (AC2, a34078b6 Slice 3)", () => {
  it("shows the new language's translation after a real setLanguage, no stale closure", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByText("fire-success"));
    await waitFor(() => expect(screen.getByText("Lade...")).toBeTruthy());

    fireEvent.click(screen.getByText("real-switch-to-en"));

    await waitFor(() => expect(screen.getByText("Loading...")).toBeTruthy());
    expect(screen.queryByText("Lade...")).toBeNull();
  });
});

describe("toastT.error re-renders an already-visible toast in the new language (AC2, a34078b6 Slice 3)", () => {
  it("shows the new language's translation after a real setLanguage, no stale closure", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByText("fire-error"));
    await waitFor(() => expect(screen.getByText("Abbrechen")).toBeTruthy());

    fireEvent.click(screen.getByText("real-switch-to-en"));

    await waitFor(() => expect(screen.getByText("Cancel")).toBeTruthy());
    expect(screen.queryByText("Abbrechen")).toBeNull();
  });
});
