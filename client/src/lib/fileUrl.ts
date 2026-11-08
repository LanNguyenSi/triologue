import { useCallback, useEffect, useState } from "react";
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

interface FileTokenEntry {
  filename: string;
  token: string;
  /** Local time after which the token should be replaced (before it really expires). */
  refreshAt: number;
  /** Session token the entry was minted under; a different session invalidates it. */
  session: string;
}

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
const inflight = new Map<string, Promise<FileTokenEntry | null>>();
let queue: Array<{ filename: string; session: string; resolve: (e: FileTokenEntry | null) => void }> = [];
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
    const settle = (entries: Map<string, FileTokenEntry>) => {
      for (const item of chunk) item.resolve(entries.get(item.filename) ?? null);
    };
    try {
      const res = await apiClient("/api/files/tokens", {
        method: "POST",
        body: JSON.stringify({ filenames: chunk.map((c) => c.filename) }),
      });
      if (!res.ok) {
        settle(new Map());
        continue;
      }
      const data = (await res.json()) as {
        tokens?: Record<string, { token: string; expiresIn: number }>;
      };
      const entries = new Map<string, FileTokenEntry>();
      for (const item of chunk) {
        const minted = data.tokens?.[item.filename];
        if (!minted) continue;
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
        entries.set(item.filename, entry);
      }
      settle(entries);
    } catch {
      settle(new Map());
    }
  }
}

/** Cached token, or a (batched) mint. `force` skips the cache. Null when denied or on failure. */
export function getFileToken(filename: string, force = false): Promise<FileTokenEntry | null> {
  const session = useAuthStore.getState().token;
  if (!session) return Promise.resolve(null);
  if (!force) {
    const hit = peek(filename, session);
    if (hit) return Promise.resolve(hit);
  }
  const key = `${session}\n${filename}`;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = new Promise<FileTokenEntry | null>((resolve) => {
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

/**
 * Authenticated URL for an `/uploads/...` path.
 *
 * - `href` is undefined until the token arrives (and for a file the user may
 *   not access); a non-`/uploads/` URL is returned unchanged.
 * - `proactive` (links, downloads): swap in a fresh token shortly before the
 *   current one expires, so a page left open for hours still downloads.
 *   Images leave it off: a loaded image needs no new token, and a lazy-loaded
 *   one that finally loads with an expired URL fails and calls `refresh()`.
 * - `refresh()` forces a new mint (use from `<img onError>`). The server
 *   returns the same token inside one bucket, so a file that is genuinely
 *   gone (404/403) re-mints once and does not loop.
 */
export function useAuthFileUrl(
  url: string | null | undefined,
  options: { proactive?: boolean } = {},
): { href: string | undefined; refresh: () => void } {
  const proactive = options.proactive ?? false;
  const filename = uploadFilename(url);
  const session = useAuthStore((s) => s.token);
  const [entry, setEntry] = useState<FileTokenEntry | null>(null);

  useEffect(() => {
    if (!filename || !session) {
      setEntry(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      void getFileToken(filename).then((e) => {
        if (cancelled) return;
        setEntry(e);
        if (e && proactive) {
          timer = setTimeout(run, Math.max(MIN_REFRESH_DELAY_MS, e.refreshAt - Date.now()));
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
    void getFileToken(filename, true).then((e) => setEntry(e));
  }, [filename]);

  if (!url) return { href: undefined, refresh };
  if (!filename) return { href: url, refresh };
  const current = entry && entry.filename === filename && entry.session === session ? entry : null;
  return { href: current ? fileUrlWithToken(filename, current.token) : undefined, refresh };
}
