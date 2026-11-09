// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiClient = vi.fn();
vi.mock('../lib/apiClient', () => ({ apiClient: (...args: unknown[]) => apiClient(...args) }));

import { startOAuthConnect } from '../services/connectorApi';

describe('startOAuthConnect', () => {
  const realLocation = window.location;

  beforeEach(() => {
    apiClient.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { href: '' } });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
  });

  it('mints with credentials included, then navigates to the start route with the token', async () => {
    apiClient.mockResolvedValue({ ok: true, json: async () => ({ token: 'v1.a.b.c' }) });

    await startOAuthConnect({ provider: 'microsoft', scope: 'graph' });

    const [path, options] = apiClient.mock.calls[0];
    expect(path).toBe('/api/integrations/oauth/start-token');
    expect(options.method).toBe('POST');
    expect(options.credentials).toBe('include');
    expect(JSON.parse(options.body)).toEqual({ provider: 'microsoft', scope: 'graph' });
    expect(window.location.href).toBe('/api/integrations/oauth/start?provider=microsoft&scope=graph&st=v1.a.b.c');
  });

  it('does not navigate and shows the server message when the mint is refused (wrong host)', async () => {
    apiClient.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Open https://app.example.com to connect this account' }),
    });

    await expect(startOAuthConnect({ provider: 'microsoft', scope: 'graph' })).rejects.toThrow(
      'Open https://app.example.com to connect this account',
    );
    expect(window.location.href).toBe('');
  });
});
