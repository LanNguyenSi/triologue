// @vitest-environment jsdom
/**
 * Unit tests for the file-URL helpers (client/src/lib/fileUrl.ts).
 *
 * The session JWT must never end up in a file URL: URLs carry only a
 * file-scoped token minted by POST /api/files/tokens.
 *
 * Mutation-check intent:
 *   - Put the session token back in fileUrlWithToken / the hook → the "never
 *     contains the session token" test goes red.
 *   - Drop the `force` bypass in getFileToken → the refresh test goes red.
 *   - Drop the session comparison in peek() → the "new session re-mints" test
 *     goes red.
 *   - Drop the proactive timer → the "swaps in a fresh token" test goes red.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const session = { token: 'SESSION.JWT.VALUE' as string | null };
vi.mock('../stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { token: string | null }) => unknown) => selector({ token: session.token }),
    { getState: () => ({ token: session.token }) },
  ),
}));

const apiClient = vi.fn();
vi.mock('../lib/apiClient', () => ({ apiClient: (...args: unknown[]) => apiClient(...args) }));

import {
  fileUrlWithToken,
  getFileToken,
  resetFileTokenCache,
  uploadFilename,
  useAuthFileUrl,
} from '../lib/fileUrl';

function mintResponse(tokens: Record<string, { token: string; expiresIn: number }>) {
  return { ok: true, json: async () => ({ tokens, denied: [] }) };
}

beforeEach(() => {
  resetFileTokenCache();
  apiClient.mockReset();
  session.token = 'SESSION.JWT.VALUE';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('uploadFilename / fileUrlWithToken', () => {
  it('extracts the stored file name from /uploads/ paths only', () => {
    expect(uploadFilename('/uploads/report.pdf')).toBe('report.pdf');
    expect(uploadFilename('https://cdn.example.com/x.png')).toBeNull();
    expect(uploadFilename('/api/files/x.png')).toBeNull();
    expect(uploadFilename('/uploads/')).toBeNull();
    expect(uploadFilename(undefined)).toBeNull();
  });

  it('builds /api/files/<encoded name>?ft=<encoded token>', () => {
    expect(fileUrlWithToken('report.pdf', 'v1.a.1.b')).toBe('/api/files/report.pdf?ft=v1.a.1.b');
    expect(fileUrlWithToken('my file&x.png', 'a+b/c=')).toBe('/api/files/my%20file%26x.png?ft=a%2Bb%2Fc%3D');
  });
});

describe('getFileToken', () => {
  it('batches mints requested in the same tick into one request, and caches the result', async () => {
    apiClient.mockResolvedValue(
      mintResponse({ 'a.png': { token: 'ta', expiresIn: 240 }, 'b.png': { token: 'tb', expiresIn: 240 } }),
    );

    const [a, b] = await Promise.all([getFileToken('a.png'), getFileToken('b.png')]);

    expect(apiClient).toHaveBeenCalledTimes(1);
    const [path, init] = apiClient.mock.calls[0];
    expect(path).toBe('/api/files/tokens');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ filenames: ['a.png', 'b.png'] });
    expect([a?.token, b?.token]).toEqual(['ta', 'tb']);

    expect((await getFileToken('a.png'))?.token).toBe('ta');
    expect(apiClient).toHaveBeenCalledTimes(1);
  });

  it('joins a concurrent request for the same file', async () => {
    apiClient.mockResolvedValue(mintResponse({ 'a.png': { token: 'ta', expiresIn: 240 } }));

    await Promise.all([getFileToken('a.png'), getFileToken('a.png')]);

    expect(JSON.parse(apiClient.mock.calls[0][1].body).filenames).toEqual(['a.png']);
  });

  it('splits more than 50 files into several requests', async () => {
    apiClient.mockImplementation(async (_p: string, init: { body: string }) => {
      const names: string[] = JSON.parse(init.body).filenames;
      return mintResponse(Object.fromEntries(names.map((n) => [n, { token: `t-${n}`, expiresIn: 240 }])));
    });

    const names = Array.from({ length: 120 }, (_v, i) => `f${i}.png`);
    const results = await Promise.all(names.map((n) => getFileToken(n)));

    expect(apiClient).toHaveBeenCalledTimes(3);
    expect(results.every((r, i) => r?.token === `t-${names[i]}`)).toBe(true);
  });

  it('returns null for a denied file, a failed request and a network error', async () => {
    apiClient.mockResolvedValueOnce(mintResponse({}));
    expect(await getFileToken('denied.png')).toBeNull();

    apiClient.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    expect(await getFileToken('err.png')).toBeNull();

    apiClient.mockRejectedValueOnce(new Error('offline'));
    expect(await getFileToken('net.png')).toBeNull();
  });

  it('returns null without a session and does not call the server', async () => {
    session.token = null;
    expect(await getFileToken('a.png')).toBeNull();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('mints again when forced, and when the session changed', async () => {
    apiClient
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't1', expiresIn: 240 } }))
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't2', expiresIn: 240 } }))
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't3', expiresIn: 240 } }));

    expect((await getFileToken('a.png'))?.token).toBe('t1');
    expect((await getFileToken('a.png', true))?.token).toBe('t2');
    session.token = 'OTHER.SESSION';
    expect((await getFileToken('a.png'))?.token).toBe('t3');
    expect(apiClient).toHaveBeenCalledTimes(3);
  });

  it('treats a token as stale shortly before it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    apiClient
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't1', expiresIn: 100 } }))
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't2', expiresIn: 100 } }));

    expect((await getFileToken('a.png'))?.token).toBe('t1');
    vi.setSystemTime(Date.now() + 60_000);
    expect((await getFileToken('a.png'))?.token).toBe('t1');
    vi.setSystemTime(Date.now() + 20_000); // 80 s of 100 s: inside the last quarter
    expect((await getFileToken('a.png'))?.token).toBe('t2');
  });
});

describe('useAuthFileUrl', () => {
  it('returns a non-/uploads/ URL unchanged without calling the server', () => {
    const { result } = renderHook(() => useAuthFileUrl('https://cdn.example.com/x.png'));
    expect(result.current.href).toBe('https://cdn.example.com/x.png');
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('is undefined until the token arrives, then carries ?ft= and never the session token', async () => {
    apiClient.mockResolvedValue(mintResponse({ 'a b.png': { token: 'v1.u.9.sig', expiresIn: 240 } }));

    const { result } = renderHook(() => useAuthFileUrl('/uploads/a b.png'));
    expect(result.current.href).toBeUndefined();

    await waitFor(() => expect(result.current.href).toBe('/api/files/a%20b.png?ft=v1.u.9.sig'));
    expect(result.current.href).not.toContain('SESSION');
    expect(result.current.href).not.toContain('token=');
  });

  it('stays undefined for a file the server denies', async () => {
    apiClient.mockResolvedValue(mintResponse({}));
    const { result } = renderHook(() => useAuthFileUrl('/uploads/denied.png'));
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    await act(async () => undefined);
    expect(result.current.href).toBeUndefined();
  });

  it('refresh() re-mints and updates the URL', async () => {
    apiClient
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 'old', expiresIn: 240 } }))
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 'new', expiresIn: 240 } }));
    const { result } = renderHook(() => useAuthFileUrl('/uploads/a.png'));
    await waitFor(() => expect(result.current.href).toContain('ft=old'));

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.href).toContain('ft=new'));
  });

  it('proactive: swaps in a fresh token before the current one expires; non-proactive does not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiClient.mockImplementation(async () => {
      const n = apiClient.mock.calls.length;
      return mintResponse({ 'a.png': { token: `t${n}`, expiresIn: 40 } });
    });
    const proactive = renderHook(() => useAuthFileUrl('/uploads/a.png', { proactive: true }));
    await waitFor(() => expect(proactive.result.current.href).toContain('ft=t1'));
    const calls = apiClient.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    await waitFor(() => expect(proactive.result.current.href).toContain('ft=t2'));
    expect(apiClient.mock.calls.length).toBeGreaterThan(calls);

    const passive = renderHook(() => useAuthFileUrl('/uploads/b.png'));
    apiClient.mockImplementation(async () => mintResponse({ 'b.png': { token: 'b1', expiresIn: 40 } }));
    await waitFor(() => expect(passive.result.current.href).toContain('ft=b1'));
    const before = apiClient.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // Only the proactive hook (a.png) kept minting.
    const bCalls = apiClient.mock.calls.slice(before).filter(([, init]) => JSON.parse(init.body).filenames.includes('b.png'));
    expect(bCalls).toHaveLength(0);
  });
});
