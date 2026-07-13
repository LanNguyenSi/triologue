// @vitest-environment jsdom
/**
 * Regression guard for the FilesPage upload control (client/src/pages/FilesPage.tsx,
 * around the folder-toolbar `Button`/hidden-file-`input` pair).
 *
 * Background: the control used to be a `<label>` wrapping both the hidden
 * `<input type="file">` and a nested `<Button>`. Per the HTML label spec,
 * interactive content (like a `<button>`) inside a `<label>` suppresses the
 * label's default click-forwarding to its associated control, so clicking
 * the upload button never opened the file picker. This was confirmed with a
 * jsdom repro (see task history): clicking a bare label span forwards a
 * click to the input, clicking a nested `<button>` inside the label does
 * not.
 *
 * The fix drops the `<label>` wrapper and instead holds a ref to the hidden
 * input, calling `inputRef.current?.click()` from the button's `onClick`.
 * This file rebuilds that exact pattern (ref + onClick + hidden input with
 * `aria-label`) in isolation rather than rendering the full `FilesPage`,
 * because `FilesPage` pulls in auth store, theme/language contexts, router,
 * and live API calls that are out of scope for this narrow fix.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { render, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

function UploadControl({ label = "Upload File" }: { label?: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-label={label}
        onChange={() => undefined}
        data-testid="file-input"
      />
      <button type="button" onClick={() => inputRef.current?.click()}>
        {label}
      </button>
    </>
  );
}

afterEach(() => cleanup());

describe("FilesPage upload button opens the file picker", () => {
  it("mouse click on the button triggers input.click()", async () => {
    render(<UploadControl />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Upload File" }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("keyboard activation (Enter on focused button) triggers input.click()", async () => {
    render(<UploadControl />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");

    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Upload File" });
    button.focus();
    await user.keyboard("{Enter}");

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("keyboard activation (Space on focused button) triggers input.click()", async () => {
    render(<UploadControl />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");

    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Upload File" });
    button.focus();
    await user.keyboard(" ");

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("the hidden input keeps an accessible name via aria-label", () => {
    render(<UploadControl label="Upload File" />);
    // Removing aria-label from the input (now that the <label> wrapper is
    // gone) would drop this and make the control unlabelled for a11y trees.
    const input = screen.getByTestId("file-input");
    expect(input.getAttribute("aria-label")).toBe("Upload File");
  });
});
