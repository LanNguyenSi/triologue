// @vitest-environment jsdom
/**
 * startOAuthConnect (client/src/services/connectorApi.ts): the OAuth start is
 * a top-level navigation, so the URL must carry a short-lived start token and
 * never the session JWT.
 *
 * Mutation-check intent:
 *   - Build the URL with the session token (`token=`) instead of the minted
 *     `st` → the URL assertions go red.
 *   - Navigate even when the mint request fails → the failure test goes red.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const apiClient = vi.fn();
vi.mock('../lib/apiClient', () => ({ apiClient: (...args: unknown[]) => apiClient(...args) }));

import { startOAuthConnect } from '../services/connectorApi';

const originalLocation = window.location;
let loc: { href: string };

beforeEach(() => {
  apiClient.mockReset();
  loc = { href: 'http://localhost/settings' };
  Object.defineProperty(window, 'location', { value: loc, writable: true, configurable: true });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
});

describe('startOAuthConnect', () => {
  it('mints a start token by POST and navigates with st=, without any session token', async () => {
    apiClient.mockResolvedValue({ ok: true, json: async () => ({ token: 'v1.u.9.s/ig', expiresIn: 120 }) });

    await startOAuthConnect({ provider: 'microsoft', scope: 'teams' });

    const [path, init] = apiClient.mock.calls[0];
    expect(path).toBe('/api/integrations/oauth/start-token');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ provider: 'microsoft', scope: 'teams' });
    expect(loc.href).toBe('/api/integrations/oauth/start?provider=microsoft&scope=teams&st=v1.u.9.s%2Fig');
    expect(loc.href).not.toContain('token=');
  });

  it('does not navigate and rejects with the server message when the mint fails', async () => {
    apiClient.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Agent tokens cannot start an OAuth flow' }) });

    await expect(startOAuthConnect({ provider: 'microsoft', scope: 'teams' })).rejects.toThrow(/agent tokens cannot start/i);

    expect(loc.href).toBe('http://localhost/settings');
  });
});
