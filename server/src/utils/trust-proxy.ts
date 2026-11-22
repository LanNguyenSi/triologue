// How many reverse proxies sit in front of the api. Express uses the number
// for `app.set("trust proxy", n)`: req.ip becomes the X-Forwarded-For entry
// that the outermost trusted proxy added, and anything a client wrote further
// left in that header is ignored. Too low a count keeps every client in the
// bucket of the innermost proxy; too high a count lets a client pick its own
// req.ip (and so its own rate-limit key) by sending X-Forwarded-For.
//
// The bundled docker-compose.yml sets 2 (Traefik, then the frontend nginx).
// Without the variable the server keeps one hop, the value it always had.

export const TRUST_PROXY_HOPS_VAR = 'TRUST_PROXY_HOPS';
export const DEFAULT_TRUST_PROXY_HOPS = 1;
export const MAX_TRUST_PROXY_HOPS = 10;

export type TrustProxyHopsResult =
  | { ok: true; hops: number }
  | { ok: false; message: string };

// Absent, empty or whitespace-only: the default. Otherwise the trimmed value
// must be a plain decimal integer from 0 to MAX_TRUST_PROXY_HOPS without a sign,
// decimal point or leading zero. The refusal message names the variable and the
// rule; the value itself is short and not secret, so it is quoted.
export const parseTrustProxyHops = (raw: string | undefined): TrustProxyHopsResult => {
  const value = raw?.trim() ?? '';
  if (value === '') return { ok: true, hops: DEFAULT_TRUST_PROXY_HOPS };
  if (/^(?:[0-9]|[1-9][0-9])$/.test(value)) {
    const hops = Number(value);
    if (hops <= MAX_TRUST_PROXY_HOPS) return { ok: true, hops };
  }
  return {
    ok: false,
    message:
      `${TRUST_PROXY_HOPS_VAR} must be a whole number from 0 to ${MAX_TRUST_PROXY_HOPS} ` +
      `(the number of reverse proxies in front of the api), got "${value}"`,
  };
};

// The number for app.set("trust proxy", ...). Throws on an invalid value, so
// a caller that skipped validateEnvironment still cannot start with a guess.
export const resolveTrustProxyHops = (raw: string | undefined): number => {
  const result = parseTrustProxyHops(raw);
  if (!result.ok) throw new Error(result.message);
  return result.hops;
};
