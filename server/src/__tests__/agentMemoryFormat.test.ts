/**
 * Unit tests for the pure agent-memory formatting helpers
 * (server/src/routes/agentMemoryFormat.ts), extracted from routes/agents.ts
 * (agent-tasks 3b85d69e).
 *
 * Why this exists: during slice 2 of the server-lint epic, an implementer's
 * first attempt at typing `summarizeMemoryPayload` silently changed its
 * behavior for array / empty-object / numeric-or-boolean-field payloads.
 * Adversarial review caught it, but the full DB jest suite did NOT, because
 * no test exercised these pure helpers with edge-case payloads. These tests
 * lock the current behavior so a future refactor cannot silently regress it.
 *
 * Non-DB, env-independent: no prisma, no express, no network. Runs in the
 * default `npm test` invocation (no RUN_DB_TESTS needed).
 *
 * Mutation-testability: change any `||` to `??` on the summary/note/decision
 * coercion in agentMemoryFormat.ts (or reintroduce an early return before the
 * array/JSON.stringify fallback) and the "numeric/boolean field" and
 * "empty object" cases below go red; reverting restores green. Verified
 * manually as part of this change (see task report).
 */
import {
  asJsonObject,
  summarizeMemoryPayload,
  deriveMemoryFreshness,
} from "../routes/agentMemoryFormat";

describe("summarizeMemoryPayload", () => {
  it("prefers summary over note and decision, truncated to 180 chars", () => {
    const long = "s".repeat(200);
    expect(
      summarizeMemoryPayload({
        summary: long,
        note: "note text",
        decision: "decision text",
      }),
    ).toBe(long.slice(0, 180));
  });

  it("falls back to note when summary is absent/falsy", () => {
    const long = "n".repeat(200);
    expect(
      summarizeMemoryPayload({ summary: "", note: long, decision: "decision text" }),
    ).toBe(long.slice(0, 180));
  });

  it("falls back to decision when summary and note are absent/falsy", () => {
    const long = "d".repeat(200);
    expect(summarizeMemoryPayload({ decision: long })).toBe(long.slice(0, 180));
  });

  it("returns '{}' for an empty object payload", () => {
    expect(summarizeMemoryPayload({})).toBe("{}");
  });

  it("JSON.stringifies array payloads instead of reading named fields", () => {
    const arr = ["summary", "note", "decision"];
    expect(summarizeMemoryPayload(arr)).toBe(JSON.stringify(arr));
  });

  it("truncates a long array payload with an ellipsis", () => {
    const arr = Array.from({ length: 100 }, (_, i) => `item-${i}`);
    const text = JSON.stringify(arr);
    expect(summarizeMemoryPayload(arr)).toBe(`${text.slice(0, 180)}...`);
  });

  it("coerces a numeric 0 field via `||` (falls through, NOT '0')", () => {
    // summary: 0 is falsy, so String(0 || "") === "" -> falls through to note.
    expect(summarizeMemoryPayload({ summary: 0, note: "fallback note" })).toBe(
      "fallback note",
    );
  });

  it("coerces a boolean false field via `||` (falls through, NOT 'false')", () => {
    expect(
      summarizeMemoryPayload({ summary: false, note: "fallback note" }),
    ).toBe("fallback note");
  });

  it("treats a non-empty numeric/boolean field as truthy-only when nonzero/true", () => {
    // summary: 42 is truthy -> String(42) -> "42".
    expect(summarizeMemoryPayload({ summary: 42 })).toBe("42");
    // summary: true is truthy -> String(true) -> "true".
    expect(summarizeMemoryPayload({ summary: true })).toBe("true");
  });

  it("returns '' for null payload", () => {
    expect(summarizeMemoryPayload(null)).toBe("");
  });

  it("returns '' for undefined payload", () => {
    expect(summarizeMemoryPayload(undefined)).toBe("");
  });

  it("returns '' for a primitive (non-object) payload", () => {
    expect(summarizeMemoryPayload("just a string" as unknown as never)).toBe("");
    expect(summarizeMemoryPayload(42 as unknown as never)).toBe("");
    expect(summarizeMemoryPayload(true as unknown as never)).toBe("");
  });
});

describe("asJsonObject", () => {
  it("returns the object as-is for a plain object", () => {
    expect(asJsonObject({ a: 1 })).toEqual({ a: 1 });
  });

  it("returns {} for an array", () => {
    expect(asJsonObject([1, 2, 3])).toEqual({});
  });

  it("returns {} for null", () => {
    expect(asJsonObject(null)).toEqual({});
  });

  it("returns {} for undefined", () => {
    expect(asJsonObject(undefined)).toEqual({});
  });

  it("returns {} for a primitive", () => {
    expect(asJsonObject("nope" as unknown as never)).toEqual({});
  });
});

describe("deriveMemoryFreshness", () => {
  const now = new Date("2026-07-14T12:00:00.000Z");

  it("is stale when expiresAt is in the past", () => {
    const result = deriveMemoryFreshness({}, "2026-07-01T00:00:00.000Z", now);
    expect(result.status).toBe("stale");
    expect(result.isStale).toBe(true);
    expect(result.warning).toBe("Memory entry is stale and should be reviewed.");
    expect(result.validUntil).toBe("2026-07-01T00:00:00.000Z");
  });

  it("is stale when expiresAt equals now (boundary, <=)", () => {
    const result = deriveMemoryFreshness({}, now.toISOString(), now);
    expect(result.status).toBe("stale");
    expect(result.isStale).toBe(true);
  });

  it("is fresh when expiresAt is in the future", () => {
    const result = deriveMemoryFreshness({}, "2026-08-01T00:00:00.000Z", now);
    expect(result.status).toBe("fresh");
    expect(result.isStale).toBe(false);
    expect(result.warning).toBeNull();
    expect(result.validUntil).toBe("2026-08-01T00:00:00.000Z");
  });

  it("falls back to payload.validUntil when expiresAtRaw is absent", () => {
    const result = deriveMemoryFreshness(
      { validUntil: "2026-08-01T00:00:00.000Z" },
      null,
      now,
    );
    expect(result.status).toBe("fresh");
    expect(result.validUntil).toBe("2026-08-01T00:00:00.000Z");
  });

  it("prefers expiresAtRaw over payload.validUntil when both are present", () => {
    const result = deriveMemoryFreshness(
      { validUntil: "2026-08-01T00:00:00.000Z" },
      "2026-06-01T00:00:00.000Z",
      now,
    );
    expect(result.status).toBe("stale");
    expect(result.validUntil).toBe("2026-06-01T00:00:00.000Z");
  });

  it("is unknown when there is no expiry anywhere", () => {
    const result = deriveMemoryFreshness({}, null, now);
    expect(result.status).toBe("unknown");
    expect(result.isStale).toBe(false);
    expect(result.warning).toBeNull();
    expect(result.validUntil).toBeNull();
  });

  it("is unknown when payload is not an object (array) and no expiresAtRaw", () => {
    const result = deriveMemoryFreshness(["a", "b"], null, now);
    expect(result.status).toBe("unknown");
    expect(result.validUntil).toBeNull();
  });

  it("treats an unparsable expiresAtRaw as absent", () => {
    const result = deriveMemoryFreshness({}, "not-a-date", now);
    expect(result.status).toBe("unknown");
    expect(result.validUntil).toBeNull();
  });
});
