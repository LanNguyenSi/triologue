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

/** Token string of a successful result, otherwise the status name. */
async function tokenOf(filename: string, force = false): Promise<string> {
  const r = await getFileToken(filename, force);
  return r.status === 'ok' ? r.entry.token : r.status;
}

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

    const [a, b] = await Promise.all([tokenOf('a.png'), tokenOf('b.png')]);

    expect(apiClient).toHaveBeenCalledTimes(1);
    const [path, init] = apiClient.mock.calls[0];
    expect(path).toBe('/api/files/tokens');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ filenames: ['a.png', 'b.png'] });
    expect([a, b]).toEqual(['ta', 'tb']);

    expect(await tokenOf('a.png')).toBe('ta');
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
    expect(results.every((r, i) => r.status === 'ok' && r.entry.token === `t-${names[i]}`)).toBe(true);
  });

  it('tells a denied name (answer without a token) apart from a failed request (network, 429, 5xx)', async () => {
    apiClient.mockResolvedValueOnce(mintResponse({}));
    expect(await tokenOf('denied.png')).toBe('denied');

    apiClient.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) });
    expect(await tokenOf('bad-gateway.png')).toBe('failed');

    apiClient.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    expect(await tokenOf('limited.png')).toBe('failed');

    apiClient.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    expect(await tokenOf('boom.png')).toBe('failed');

    apiClient.mockRejectedValueOnce(new Error('offline'));
    expect(await tokenOf('net.png')).toBe('failed');

    apiClient.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    expect(await tokenOf('forbidden.png')).toBe('denied');
  });

  it('returns denied without a session and does not call the server', async () => {
    session.token = null;
    expect(await tokenOf('a.png')).toBe('denied');
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('mints again when forced, and when the session changed', async () => {
    apiClient
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't1', expiresIn: 240 } }))
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't2', expiresIn: 240 } }))
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't3', expiresIn: 240 } }));

    expect(await tokenOf('a.png')).toBe('t1');
    expect(await tokenOf('a.png', true)).toBe('t2');
    session.token = 'OTHER.SESSION';
    expect(await tokenOf('a.png')).toBe('t3');
    expect(apiClient).toHaveBeenCalledTimes(3);
  });

  it('treats a token as stale shortly before it expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    apiClient
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't1', expiresIn: 100 } }))
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't2', expiresIn: 100 } }));

    expect(await tokenOf('a.png')).toBe('t1');
    vi.setSystemTime(Date.now() + 60_000);
    expect(await tokenOf('a.png')).toBe('t1');
    vi.setSystemTime(Date.now() + 20_000); // 80 s of 100 s: inside the last quarter
    expect(await tokenOf('a.png')).toBe('t2');
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

describe('useAuthFileUrl: failed mints are retried, denied ones are not', () => {
  const failing = { ok: false, status: 502, json: async () => ({}) };

  it('retries a failed first mint with backoff (5 s, 15 s, 60 s) and shows the URL once it succeeds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiClient
      .mockResolvedValueOnce(failing)
      .mockResolvedValueOnce(failing)
      .mockResolvedValueOnce(failing)
      .mockResolvedValue(mintResponse({ 'a.png': { token: 'late', expiresIn: 240 } }));
    const { result } = renderHook(() => useAuthFileUrl('/uploads/a.png'));
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(1));
    expect(result.current.href).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(apiClient).toHaveBeenCalledTimes(1); // first retry is not before 5 s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(apiClient).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_000);
    });
    expect(apiClient).toHaveBeenCalledTimes(2); // second retry waits 15 s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(apiClient).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(57_000);
    });
    expect(apiClient).toHaveBeenCalledTimes(3); // third retry waits 60 s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    await waitFor(() => expect(result.current.href).toContain('ft=late'));
    expect(apiClient).toHaveBeenCalledTimes(4);
  });

  it('keeps retrying every 60 s while mounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiClient.mockResolvedValue(failing);
    renderHook(() => useAuthFileUrl('/uploads/a.png'));
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000 + 15_000 + 60_000 + 60_000 + 60_000 + 500);
    });

    expect(apiClient).toHaveBeenCalledTimes(6);
  });

  it('a link keeps its previous URL when the proactive refresh fails, and recovers on a later success', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiClient
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't1', expiresIn: 40 } }))
      .mockResolvedValueOnce(failing)
      .mockResolvedValue(mintResponse({ 'a.png': { token: 't3', expiresIn: 240 } }));
    const { result } = renderHook(() => useAuthFileUrl('/uploads/a.png', { proactive: true }));
    await waitFor(() => expect(result.current.href).toContain('ft=t1'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000); // refresh fires and fails
    });
    expect(result.current.href).toContain('ft=t1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });
    await waitFor(() => expect(result.current.href).toContain('ft=t3'));
  });

  it('does not retry a denied name', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiClient.mockResolvedValue(mintResponse({}));
    const { result } = renderHook(() => useAuthFileUrl('/uploads/denied.png', { proactive: true }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    expect(apiClient).toHaveBeenCalledTimes(1);
    expect(result.current.href).toBeUndefined();
  });

  it('stops retrying when the component unmounts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiClient.mockResolvedValue(failing);
    const { unmount } = renderHook(() => useAuthFileUrl('/uploads/a.png'));
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    expect(apiClient).toHaveBeenCalledTimes(1);
  });

  it('a proactive hook unmounted before its refresh timer fires makes no further mint calls', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiClient.mockResolvedValue(mintResponse({ 'a.png': { token: 't1', expiresIn: 40 } }));
    const { result, unmount } = renderHook(() => useAuthFileUrl('/uploads/a.png', { proactive: true }));
    await waitFor(() => expect(result.current.href).toContain('ft=t1'));
    expect(apiClient).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    expect(apiClient).toHaveBeenCalledTimes(1);
  });

  it('refresh() retries a failed forced mint and stops on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiClient
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 'old', expiresIn: 240 } }))
      .mockResolvedValueOnce(failing)
      .mockResolvedValue(mintResponse({ 'a.png': { token: 'new', expiresIn: 240 } }));
    const { result, unmount } = renderHook(() => useAuthFileUrl('/uploads/a.png'));
    await waitFor(() => expect(result.current.href).toContain('ft=old'));

    act(() => result.current.refresh());
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(2));
    expect(result.current.href).toContain('ft=old');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });
    await waitFor(() => expect(result.current.href).toContain('ft=new'));

    apiClient.mockResolvedValue(failing);
    act(() => result.current.refresh());
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(4));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(apiClient).toHaveBeenCalledTimes(4);
  });

  it('a mint that fails after the component unmounted schedules no retry (first mint)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let settle: (v: unknown) => void = () => undefined;
    apiClient.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
    const { unmount } = renderHook(() => useAuthFileUrl('/uploads/a.png'));
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      settle(failing);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    expect(apiClient).toHaveBeenCalledTimes(1);
  });

  it('a forced refresh that fails after the component unmounted schedules no retry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiClient.mockResolvedValueOnce(mintResponse({ 'a.png': { token: 'old', expiresIn: 240 } }));
    const { result, unmount } = renderHook(() => useAuthFileUrl('/uploads/a.png'));
    await waitFor(() => expect(result.current.href).toContain('ft=old'));
    let settle: (v: unknown) => void = () => undefined;
    apiClient.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));

    act(() => result.current.refresh());
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(2));
    unmount();
    await act(async () => {
      settle(failing);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    expect(apiClient).toHaveBeenCalledTimes(2);
  });

  it('a success resets the backoff: after ok, failed x2, ok, the next failure retries after 5 s again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiClient
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't1', expiresIn: 40 } })) // refresh due at ~30 s
      .mockResolvedValueOnce(failing) // 30 s, retry in 5 s
      .mockResolvedValueOnce(failing) // 35 s, retry in 15 s
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't4', expiresIn: 40 } })) // 50 s, next refresh due at ~80 s
      .mockResolvedValueOnce(failing) // ~80 s, retry in 5 s because the success reset the count
      .mockResolvedValue(mintResponse({ 'a.png': { token: 't6', expiresIn: 240 } }));
    const { result } = renderHook(() => useAuthFileUrl('/uploads/a.png', { proactive: true }));
    await waitFor(() => expect(result.current.href).toContain('ft=t1'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(82_000);
    });
    expect(apiClient).toHaveBeenCalledTimes(5);
    expect(result.current.href).toContain('ft=t4');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000); // 5 s after the failure; a missing reset would wait 60 s
    });
    expect(apiClient).toHaveBeenCalledTimes(6);
    await waitFor(() => expect(result.current.href).toContain('ft=t6'));
  });

  it('a proactive refresh answered "denied" removes the URL (access was withdrawn)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiClient
      .mockResolvedValueOnce(mintResponse({ 'a.png': { token: 't1', expiresIn: 40 } }))
      .mockResolvedValue(mintResponse({}));
    const { result } = renderHook(() => useAuthFileUrl('/uploads/a.png', { proactive: true }));
    await waitFor(() => expect(result.current.href).toContain('ft=t1'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    await waitFor(() => expect(result.current.href).toBeUndefined());
    expect(apiClient).toHaveBeenCalledTimes(2);
  });
});
