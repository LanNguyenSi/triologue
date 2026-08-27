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
 * Uses REAL, pre-existing translation keys (not fixture-only) so this test
 * needs no change to LanguageContext.tsx: "common.loading"
 * ("Lade..." / "Loading...") for the success path, "common.cancel"
 * ("Abbrechen" / "Cancel") for the error path, "common.close"
 * ("Schließen" / "Close") for the loading path.
 *
 * Also covers the review round 2 missing-test follow-up: a toastT.loading
 * re-render test (mirroring success/error), and a set of spy-based tests
 * confirming toastT.success/error/loading delegate to react-hot-toast's OWN
 * same-named entry points (not a parallel rendering path), each called
 * exactly once with a React element carrying the given key.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { isValidElement, type ReactElement } from "react";
import toast, { Toaster } from "react-hot-toast";
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
  // react-hot-toast keeps its own module-global toast store independent of
  // React's tree: cleanup() unmounts the <Toaster/> host, but a toast fired
  // by one test (e.g. via toastT.error) stays queued in that global store
  // and is replayed into the NEXT test's freshly-mounted <Toaster/>,
  // producing duplicate-text query failures ("Found multiple elements with
  // the text: Abbrechen") depending on run/shuffle order. toast.remove()
  // clears the store itself, not just the DOM.
  toast.remove();
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
      <button onClick={() => toastT.loading("common.close")}>
        fire-loading
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

describe("toastT.loading re-renders an already-visible toast in the new language (review round 2 follow-up, missing test)", () => {
  it("shows the new language's translation after a real setLanguage, no stale closure", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByText("fire-loading"));
    await waitFor(() => expect(screen.getByText("Schließen")).toBeTruthy());

    fireEvent.click(screen.getByText("real-switch-to-en"));

    await waitFor(() => expect(screen.getByText("Close")).toBeTruthy());
    expect(screen.queryByText("Schließen")).toBeNull();
  });
});

describe("toastT delegates to react-hot-toast's OWN success/error/loading entry points (review round 2 follow-up, missing test)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("toastT.success calls toast.success (and only toast.success) with a React element carrying the given key", () => {
    const successSpy = vi.spyOn(toast, "success");
    const errorSpy = vi.spyOn(toast, "error");
    const loadingSpy = vi.spyOn(toast, "loading");

    toastT.success("common.loading");

    expect(successSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(loadingSpy).not.toHaveBeenCalled();
    const [passedArg] = successSpy.mock.calls[0];
    expect(isValidElement(passedArg)).toBe(true);
    expect((passedArg as ReactElement<{ i18nKey: string }>).props.i18nKey).toBe(
      "common.loading",
    );
  });

  it("toastT.error calls toast.error (and only toast.error) with a React element carrying the given key", () => {
    const successSpy = vi.spyOn(toast, "success");
    const errorSpy = vi.spyOn(toast, "error");
    const loadingSpy = vi.spyOn(toast, "loading");

    toastT.error("common.cancel");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(successSpy).not.toHaveBeenCalled();
    expect(loadingSpy).not.toHaveBeenCalled();
    const [passedArg] = errorSpy.mock.calls[0];
    expect(isValidElement(passedArg)).toBe(true);
    expect((passedArg as ReactElement<{ i18nKey: string }>).props.i18nKey).toBe(
      "common.cancel",
    );
  });

  it("toastT.loading calls toast.loading (and only toast.loading) with a React element carrying the given key", () => {
    const successSpy = vi.spyOn(toast, "success");
    const errorSpy = vi.spyOn(toast, "error");
    const loadingSpy = vi.spyOn(toast, "loading");

    toastT.loading("common.close");

    expect(loadingSpy).toHaveBeenCalledTimes(1);
    expect(successSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    const [passedArg] = loadingSpy.mock.calls[0];
    expect(isValidElement(passedArg)).toBe(true);
    expect((passedArg as ReactElement<{ i18nKey: string }>).props.i18nKey).toBe(
      "common.close",
    );
  });
});
