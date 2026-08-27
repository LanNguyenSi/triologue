/**
 * Unit tests for the shared `describeRunError`/`RunError` helper (task
 * a34078b6, Slice 3, review round 3, F6), extracted from
 * PluginWorkspacePage.tsx where it previously had only indirect coverage
 * via a full page mount (PluginWorkspacePage.test.tsx).
 */
import { describe, it, expect } from "vitest";
import { describeRunError } from "./runError";

describe("describeRunError", () => {
  it("shapes a real Error with a non-empty message as { message }, verbatim", () => {
    expect(describeRunError(new Error("disk full"), "plugins.screening.error.moduleLoad")).toEqual(
      { message: "disk full" },
    );
  });

  it("falls back to the translated key for an Error with an EMPTY message (review round 2, F5)", () => {
    // Before the fix, `{ message: "" }` rendered a blank error block and
    // fired `toast.error("")`: a silent-looking failure with no visible
    // text.
    expect(describeRunError(new Error(""), "plugins.screening.error.moduleLoad")).toEqual({
      key: "plugins.screening.error.moduleLoad",
    });
  });

  it("falls back to the translated key for a non-Error throw", () => {
    expect(describeRunError("boom", "plugins.screening.error.moduleLoad")).toEqual({
      key: "plugins.screening.error.moduleLoad",
    });
  });

  it("falls back to the translated key for undefined/null", () => {
    expect(describeRunError(undefined, "plugins.screening.error.moduleLoad")).toEqual({
      key: "plugins.screening.error.moduleLoad",
    });
    expect(describeRunError(null, "plugins.screening.error.moduleLoad")).toEqual({
      key: "plugins.screening.error.moduleLoad",
    });
  });
});
