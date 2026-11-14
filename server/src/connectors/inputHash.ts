import { createHash } from "crypto";

/**
 * Canonical hash of a connector action input, used to bind an approval to the
 * exact input a human approved.
 *
 * Canonical form (a JSON text, hashed with SHA-256, hex):
 *   - object keys are sorted by UTF-16 code unit order, recursively, so key
 *     order never changes the hash;
 *   - a key whose value is `undefined` is dropped, as `JSON.stringify` does,
 *     so `{a: 1, b: undefined}` and `{a: 1}` hash alike; an explicit `null`
 *     is kept and differs from an absent key;
 *   - array order is significant and kept; `undefined` inside an array
 *     becomes `null`, as in `JSON.stringify`;
 *   - numbers and strings are formatted by `JSON.stringify`: `1` and `1.0`
 *     are the same number and hash alike, `-0` is `0`, `1e2` is `100`, and a
 *     string never equals a number (`"1"` differs from `1`);
 *   - no whitespace.
 *
 * The input comes from `JSON.parse` of the request body, so only JSON types
 * occur. Anything else (bigint, function, symbol, a cycle) throws instead of
 * being silently coerced, because a lossy hash would widen what an approval
 * authorises.
 */
export function canonicalJson(value: unknown): string {
  return canonicalise(value, new Set<object>());
}

function canonicalise(value: unknown, path: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      // Non-finite numbers cannot come from JSON.parse; JSON.stringify would
      // turn them into null, which must not collide with a real null.
      if (!Number.isFinite(value)) {
        throw new TypeError("canonicalJson: non-finite number");
      }
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
  }

  const obj = value as object;
  if (path.has(obj)) throw new TypeError("canonicalJson: circular structure");
  path.add(obj);
  try {
    if (Array.isArray(obj)) {
      return `[${obj
        .map((item) => (item === undefined ? "null" : canonicalise(item, path)))
        .join(",")}]`;
    }
    const record = obj as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalise(item, path)}`);
    }
    return `{${parts.join(",")}}`;
  } finally {
    path.delete(obj);
  }
}

/** SHA-256 (hex) of the canonical JSON form of `input`. */
export function hashActionInput(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
