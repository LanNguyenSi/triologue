// @vitest-environment jsdom
/**
 * The open Select listbox must have an accessible name for every caller,
 * without the call site passing anything extra: the name resolves through
 * the trigger button, which is either labelled by a `<label for>` (the id
 * prop wins over the generated one) or names itself from its content
 * (placeholder / selected option) when no id was passed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Select } from "../components/ui/primitives/Select";

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
});

const OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "elevated", label: "Elevated" },
];

describe("Select listbox accessible name", () => {
  it("names the open listbox from the label of the labelled trigger", async () => {
    render(
      <>
        <label htmlFor="test-select">Trust level</label>
        <Select id="test-select" options={OPTIONS} value="standard" onChange={vi.fn()} />
      </>,
    );

    const trigger = screen.getByRole("button", { name: "Trust level" });
    expect(trigger.getAttribute("id")).toBe("test-select");
    fireEvent.click(trigger);

    expect(await screen.findByRole("listbox", { name: "Trust level" })).toBeTruthy();
  });

  it("names the open listbox from the trigger content when no id is passed", async () => {
    render(
      <Select options={OPTIONS} value="" onChange={vi.fn()} placeholder="Pick a level" />,
    );

    const trigger = screen.getByRole("button", { name: "Pick a level" });
    expect(trigger.getAttribute("id")).toBeTruthy();
    fireEvent.click(trigger);

    expect(await screen.findByRole("listbox", { name: "Pick a level" })).toBeTruthy();
  });
});
