/**
 * Unit tests for the shared apiClient helper.
 *
 * Runs in Node environment (no jsdom); mocks globalThis.fetch, useAuthStore,
 * and apiBase. apiBase is mocked to a NON-EMPTY origin so the `${API_BASE}`
 * prepend is actually exercised (with the real, test-time-empty API_BASE the
 * prepend would be invisible and a dropped prefix would pass unnoticed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mock the API origin to a non-empty value so the prepend is observable ---
vi.mock('../lib/apiBase', () => ({ API_BASE: 'https://api.test' }));

// --- mock useAuthStore before importing apiClient ---
vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ token: null })),
  },
}));

import { apiClient } from '../lib/apiClient';
import { useAuthStore } from '../stores/authStore';

const mockStore = useAuthStore as unknown as { getState: ReturnType<typeof vi.fn> };

function makeFetch(status = 200, body = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockStore.getState.mockReturnValue({ token: null });
});

describe('apiClient', () => {
  it('prepends API_BASE to the request path', async () => {
    const mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);

    await apiClient('/api/hello');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string];
    // Fails if apiClient ever drops the `${API_BASE}` prefix.
    expect(url).toBe('https://api.test/api/hello');
  });

  it('injects a JSON Content-Type for a non-FormData body and no Authorization when unauthenticated', async () => {
    const mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);

    await apiClient('/api/ping', { method: 'POST', body: JSON.stringify({ a: 1 }) });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect(url).toBe('https://api.test/api/ping');
    expect(init.headers.get('Content-Type')).toBe('application/json');
    expect(init.headers.has('Authorization')).toBe(false);
  });

  it('does NOT set Content-Type on a bodyless request (GET/DELETE)', async () => {
    const mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);

    await apiClient('/api/ping');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect(init.headers.has('Content-Type')).toBe(false);
  });

  it('sets the Authorization header when a token is present', async () => {
    mockStore.getState.mockReturnValue({ token: 'tok-123' });
    const mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);

    await apiClient('/api/protected');

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect(init.headers.get('Authorization')).toBe('Bearer tok-123');
  });

  it('preserves a caller-supplied Content-Type while Authorization still wins', async () => {
    mockStore.getState.mockReturnValue({ token: 'tok-xyz' });
    const mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);

    await apiClient('/api/raw', {
      method: 'POST',
      body: 'plain',
      headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer caller-should-lose' },
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect(init.headers.get('Content-Type')).toBe('text/plain');
    expect(init.headers.get('Authorization')).toBe('Bearer tok-xyz');
  });

  it('does not set Content-Type for a FormData body', async () => {
    mockStore.getState.mockReturnValue({ token: 'tok-abc' });
    const mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);

    const formData = new FormData();
    formData.append('file', new Blob(['data']), 'test.txt');

    await apiClient('/api/upload', { method: 'POST', body: formData });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect(init.headers.has('Content-Type')).toBe(false);
    expect(init.headers.get('Authorization')).toBe('Bearer tok-abc');
  });

  it('passes through extra RequestInit options', async () => {
    const mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);
    const controller = new AbortController();

    await apiClient('/api/search', { method: 'GET', signal: controller.signal });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect(init.signal).toBe(controller.signal);
    expect(init.method).toBe('GET');
  });

  it('returns the raw Response object', async () => {
    const mockFetch = makeFetch(201, { id: '42' });
    vi.stubGlobal('fetch', mockFetch);

    const res = await apiClient('/api/items', { method: 'POST', body: JSON.stringify({}) });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ id: '42' });
  });
});
