/**
 * Strips ASCII control characters (code points 0-31 and 127) from an
 * uploaded file's `originalname` before it is logged or persisted.
 *
 * multer 2.3.0 decodes WHATWG-escaped sequences in `originalname`
 * (`%0A`, `%0D`, `%22`, ...), so an uploader can place raw CR/LF and other
 * control characters into a name that previously arrived percent-encoded.
 * This only strips control characters; it does not transliterate, trim
 * whitespace, or otherwise alter the rest of the name (a double quote,
 * for instance, is not a control character and is kept as-is).
 *
 * A name made up entirely of control characters strips to the empty
 * string; rather than persist/display an empty filename, that case falls
 * back to the placeholder `"file"`.
 */
export function stripControlChars(name: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = name.replace(/[\x00-\x1f\x7f]/g, "");
  return stripped === "" ? "file" : stripped;
}
