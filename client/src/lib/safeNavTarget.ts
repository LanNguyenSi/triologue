// Guard for navigation targets that come from outside the client.
//
// Several places hand a server- or plugin-supplied string straight to
// <Link to={...}> or navigate(...): inbox item links, file-provider connection
// paths, notification links, and plugin nav items from a plugin manifest. Those
// values must stay inside this app; a value that escapes to another origin is
// an open redirect, and an open redirect on a page that carries session state
// is a phishing primitive.
//
// The router does NOT reliably contain these. Measured against a hostile `to`
// value on the version this client runs (6.30.4) and on 7.18.2:
//
//   value                  6.30.4                            7.18.2
//   '\/evil.example.com'   left-click is intercepted (JS      href used verbatim,
//                          navigation stays on-site), but      click NOT intercepted
//                          the rendered <a href> still
//                          points at the evil origin: the
//                          href itself still escapes, so
//                          middle-click, ctrl/cmd-click,
//                          "open in new tab", and "copy
//                          link address" all leak it.
//   '//evil.example.com'   escapes to evil.example.com        escapes to evil.example.com
//
// So the '//' form is contained by neither, and on 6.30.4 the backslash form's
// left-click interception does not stop the href itself from leaking the
// destination through every path other than a plain left-click; in 7.x even
// that interception is gone. Containment therefore belongs here, at the call
// site, and not in the router: it holds whichever version is installed, which
// also means the eventual 6 -> 7 -> 8 migration cannot silently reopen this.
//
// Why backslashes matter: per the WHATWG URL spec a backslash is treated as a
// path separator for http(s) URLs, so the browser resolves '\/evil.example.com'
// and '\\evil.example.com' to the origin https://evil.example.com, exactly as
// it would '//evil.example.com'.
//
// The rule is deliberately strict: accept only a path starting with exactly one
// forward slash that is not itself followed by another slash or a backslash.
// Everything else, including absolute URLs and scheme-relative URLs, falls back.

/** A navigation target is safe only if it is same-origin and path-absolute. */
export function isSafeNavTarget(target: unknown): target is string {
  if (typeof target !== 'string') return false;

  // Browsers strip tab, newline and carriage return from URLs before resolving
  // them, so '/\tevil' and '/evil' are not the same string but are the same
  // navigation. Normalise the same way before deciding, or the check can be
  // walked past with an embedded control character.
  const normalised = target.replace(/[\t\n\r]/g, '').trim();

  // Reject any remaining C0 control character for the same reason.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(normalised)) return false;

  // Exactly one leading '/', and the next character must not be '/' or '\'.
  // '//host' and '/\host' both resolve to a foreign origin.
  return /^\/(?![/\\])/.test(normalised);
}

/**
 * Returns `target` when it is a safe same-origin path, otherwise `fallback`.
 * Use at every place that renders or navigates to a value this client did not
 * construct itself.
 *
 * `fallback` is validated too: a caller-supplied fallback that is itself
 * unsafe (e.g. a value threaded through from the same untrusted source as
 * `target`) falls back to `/` rather than being trusted blindly.
 */
export function safeNavTarget(target: unknown, fallback = '/'): string {
  const safeFallback = isSafeNavTarget(fallback) ? fallback.replace(/[\t\n\r]/g, '').trim() : '/';

  if (isSafeNavTarget(target)) return target.replace(/[\t\n\r]/g, '').trim();
  // Rejecting silently would leave a plugin author with a nav item that quietly
  // goes to the fallback and nothing to explain why. The repo convention is no
  // silent errors; this stays out of production builds.
  if (import.meta.env?.DEV && target !== undefined && target !== null && target !== '') {
    // Log the caller-supplied fallback and the effective (post-validation)
    // fallback separately: if they differ, the caller's own fallback was
    // itself rejected and silently downgraded to '/', which is worth seeing
    // in the console rather than inferring from the effective value alone.
    console.warn('safeNavTarget: rejected navigation target, using fallback', {
      target,
      fallback,
      effectiveFallback: safeFallback,
    });
    if (!isSafeNavTarget(fallback)) {
      console.warn('safeNavTarget: the supplied fallback was itself rejected, using "/" instead', {
        fallback,
      });
    }
  }
  return safeFallback;
}
