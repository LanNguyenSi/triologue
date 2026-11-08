import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "./apiClient";
import { useAuthStore } from "../stores/authStore";

/**
 * File URLs for `<img src>` and `<a href>`, which cannot send an Authorization
 * header. Instead of the session JWT, the URL carries a file-scoped token
 * (`?ft=`): bound to one file and one user, valid for a few minutes, minted by
 * `POST /api/files/tokens` (authenticated by header) and re-checked against the
 * file's ACL on every request.
 *
 * Tokens are minted lazily at render time through `useAuthFileUrl`. Mints of
 * files that render in the same tick are sent as one request. The server
 * returns the same token for the same file and user inside an expiry bucket, so
 * the URL (and the browser cache entry) is stable between re-mints.
 */

const MAX_FILES_PER_MINT = 50;
const MIN_REFRESH_DELAY_MS = 2000;
/** Wait before the n-th retry after a failed mint; the last value repeats while the component is mounted. */
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000];

interface FileTokenEntry {
  filename: string;
  token: string;
  /** Local time after which the token should be replaced (before it really expires). */
  refreshAt: number;
  /** Session token the entry was minted under; a different session invalidates it. */
  session: string;
}

/**
 * Outcome of a token request.
 * - `ok`: a token.
 * - `denied`: the server answered and gave no token for this name (no access,
 *   no such file, or a 4xx other than 408/429). Retrying will not help.
 * - `failed`: no usable answer (network error, 408, 429, 5xx, a 502 during a
 *   deploy). Worth retrying with a backoff.
 */
export type FileTokenResult =
  | { status: "ok"; entry: FileTokenEntry }
  | { status: "denied" }
  | { status: "failed" };

/** `/uploads/x.png` → `x.png`; null for anything else. */
export function uploadFilename(url: string | null | undefined): string | null {
  if (!url?.startsWith("/uploads/")) return null;
  return url.slice("/uploads/".length) || null;
}

/** `/uploads/my file.png` + token → `/api/files/my%20file.png?ft=<token>`. */
export function fileUrlWithToken(filename: string, token: string): string {
  return `/api/files/${encodeURIComponent(filename)}?ft=${encodeURIComponent(token)}`;
}

const cache = new Map<string, FileTokenEntry>();
const inflight = new Map<string, Promise<FileTokenResult>>();
let queue: Array<{ filename: string; session: string; resolve: (r: FileTokenResult) => void }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function peek(filename: string, session: string): FileTokenEntry | null {
  const entry = cache.get(filename);
  if (!entry || entry.session !== session || Date.now() >= entry.refreshAt) return null;
  return entry;
}

async function flush(): Promise<void> {
  const batch = queue;
  queue = [];
  flushTimer = null;
  for (let i = 0; i < batch.length; i += MAX_FILES_PER_MINT) {
    const chunk = batch.slice(i, i + MAX_FILES_PER_MINT);
    const settleAll = (result: FileTokenResult) => {
      for (const item of chunk) item.resolve(result);
    };
    try {
      const res = await apiClient("/api/files/tokens", {
        method: "POST",
        body: JSON.stringify({ filenames: chunk.map((c) => c.filename) }),
      });
      if (!res.ok) {
        const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
        settleAll(retryable ? { status: "failed" } : { status: "denied" });
        continue;
      }
      const data = (await res.json()) as {
        tokens?: Record<string, { token: string; expiresIn: number }>;
      };
      for (const item of chunk) {
        const minted = data.tokens?.[item.filename];
        if (!minted) {
          item.resolve({ status: "denied" });
          continue;
        }
        // Count down from the server-reported lifetime, not from a server
        // timestamp, so a skewed local clock cannot stretch or cut it.
        const lifetimeMs = minted.expiresIn * 1000;
        const entry: FileTokenEntry = {
          filename: item.filename,
          token: minted.token,
          refreshAt: Date.now() + lifetimeMs - Math.min(30_000, lifetimeMs / 4),
          session: item.session,
        };
        cache.set(item.filename, entry);
        item.resolve({ status: "ok", entry });
      }
    } catch {
      settleAll({ status: "failed" });
    }
  }
}

/** Cached token, or a (batched) mint. `force` skips the cache. */
export function getFileToken(filename: string, force = false): Promise<FileTokenResult> {
  const session = useAuthStore.getState().token;
  if (!session) return Promise.resolve({ status: "denied" });
  if (!force) {
    const hit = peek(filename, session);
    if (hit) return Promise.resolve({ status: "ok", entry: hit });
  }
  const key = `${session}\n${filename}`;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = new Promise<FileTokenResult>((resolve) => {
    queue.push({ filename, session, resolve });
    if (!flushTimer) flushTimer = setTimeout(() => void flush(), 0);
  }).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Test hook: drop all cached tokens and pending mints. */
export function resetFileTokenCache(): void {
  cache.clear();
  inflight.clear();
  queue = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}

function retryDelay(failures: number): number {
  return RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)];
}

/**
 * Authenticated URL for an `/uploads/...` path.
 *
 * - `href` is undefined until the token arrives (and for a file the user may
 *   not access); a non-`/uploads/` URL is returned unchanged.
 * - A failed mint (network, 408, 429, 5xx) keeps any previous token and is
 *   retried after 5 s, 15 s, 60 s and then every 60 s while the component is
 *   mounted; a denied name is not retried.
 * - `proactive` (links, downloads): swap in a fresh token shortly before the
 *   current one expires, so a page left open for hours still downloads.
 *   Images leave it off: a loaded image needs no new token, and a lazy-loaded
 *   one that finally loads with an expired URL fails and calls `refresh()`.
 * - `refresh()` forces a new mint (use from `<img onError>`), with the same
 *   retry on failure. The server returns the same token inside one bucket, so
 *   a file that is genuinely gone (404/403) re-mints once and does not loop.
 */
export function useAuthFileUrl(
  url: string | null | undefined,
  options: { proactive?: boolean } = {},
): { href: string | undefined; refresh: () => void } {
  const proactive = options.proactive ?? false;
  const filename = uploadFilename(url);
  const session = useAuthStore((s) => s.token);
  const [entry, setEntry] = useState<FileTokenEntry | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);

  // A pending forced-refresh retry belongs to one file name.
  useEffect(() => () => clearTimeout(refreshTimer.current), [filename]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Redundant with the mounted guard in refresh() (an equivalent mutant), kept so no timer outlives the component.
      clearTimeout(refreshTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!filename || !session) {
      setEntry(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const run = () => {
      void getFileToken(filename).then((result) => {
        if (cancelled) return;
        if (result.status === "ok") {
          failures = 0;
          setEntry(result.entry);
          if (proactive) {
            timer = setTimeout(run, Math.max(MIN_REFRESH_DELAY_MS, result.entry.refreshAt - Date.now()));
          }
        } else if (result.status === "denied") {
          setEntry(null);
        } else {
          timer = setTimeout(run, retryDelay(failures++));
        }
      });
    };
    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [filename, session, proactive]);

  const refresh = useCallback(() => {
    if (!filename) return;
    clearTimeout(refreshTimer.current);
    let failures = 0;
    const attempt = () => {
      void getFileToken(filename, true).then((result) => {
        if (!mounted.current) return;
        if (result.status === "ok") setEntry(result.entry);
        else if (result.status === "denied") setEntry(null);
        else refreshTimer.current = setTimeout(attempt, retryDelay(failures++));
      });
    };
    attempt();
  }, [filename]);

  if (!url) return { href: undefined, refresh };
  if (!filename) return { href: url, refresh };
  const current = entry && entry.filename === filename && entry.session === session ? entry : null;
  return { href: current ? fileUrlWithToken(filename, current.token) : undefined, refresh };
}
