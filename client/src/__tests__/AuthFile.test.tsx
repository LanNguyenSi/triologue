// @vitest-environment jsdom
/**
 * Render tests for AuthFileLink / AuthFileImage (client/src/components/files/AuthFile.tsx).
 *
 * Mutation-check intent:
 *   - Pass `url` straight through as `src`/`href` → the ?ft= assertions fail.
 *   - Drop the onError → refresh wiring → the expired-image test goes red.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { token: string }) => unknown) => selector({ token: 'SESSION.JWT' }),
    { getState: () => ({ token: 'SESSION.JWT' }) },
  ),
}));

const apiClient = vi.fn();
vi.mock('../lib/apiClient', () => ({ apiClient: (...args: unknown[]) => apiClient(...args) }));

import { AuthFileImage, AuthFileLink } from '../components/files/AuthFile';
import { resetFileTokenCache } from '../lib/fileUrl';

const mint = (token: string) => ({
  ok: true,
  json: async () => ({ tokens: { 'p.png': { token, expiresIn: 240 } }, denied: [] }),
});

beforeEach(() => {
  resetFileTokenCache();
  apiClient.mockReset();
});

afterEach(cleanup);

describe('AuthFileLink / AuthFileImage', () => {
  it('render an image and its link with the file token and one shared mint request', async () => {
    apiClient.mockResolvedValue(mint('v1.u.9.sig'));

    render(
      <AuthFileLink url="/uploads/p.png" target="_blank" data-testid="link">
        <AuthFileImage url="/uploads/p.png" alt="pic" />
      </AuthFileLink>,
    );

    const img = await screen.findByAltText('pic');
    expect(img.getAttribute('src')).toBe('/api/files/p.png?ft=v1.u.9.sig');
    await waitFor(() => expect(screen.getByTestId('link').getAttribute('href')).toBe('/api/files/p.png?ft=v1.u.9.sig'));
    expect(screen.getByTestId('link').getAttribute('target')).toBe('_blank');
    expect(apiClient).toHaveBeenCalledTimes(1);
    expect(document.body.innerHTML).not.toContain('SESSION.JWT');
  });

  it('re-mints and reloads an image whose URL expired (load error)', async () => {
    apiClient.mockResolvedValueOnce(mint('old')).mockResolvedValueOnce(mint('new'));
    render(<AuthFileImage url="/uploads/p.png" alt="pic" />);
    const img = await screen.findByAltText('pic');
    expect(img.getAttribute('src')).toContain('ft=old');

    fireEvent.error(img);

    await waitFor(() => expect(screen.getByAltText('pic').getAttribute('src')).toContain('ft=new'));
  });

  it('recovers a link and an image after the first mint failed (backend briefly unavailable)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiClient
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
      .mockResolvedValue(mint('after-outage'));

    render(
      <AuthFileLink url="/uploads/p.png" data-testid="link">
        <AuthFileImage url="/uploads/p.png" alt="pic" />
      </AuthFileLink>,
    );
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(1));
    expect(screen.queryByAltText('pic')).toBeNull();
    expect(screen.getByTestId('link').getAttribute('href')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });

    await waitFor(() => expect(screen.getByAltText('pic').getAttribute('src')).toContain('ft=after-outage'));
    await waitFor(() => expect(screen.getByTestId('link').getAttribute('href')).toContain('ft=after-outage'));
    vi.useRealTimers();
  });

  it('renders no image while the token is pending', () => {
    apiClient.mockReturnValue(new Promise(() => undefined));
    render(<AuthFileImage url="/uploads/p.png" alt="pic" />);
    expect(screen.queryByAltText('pic')).toBeNull();
  });
});
