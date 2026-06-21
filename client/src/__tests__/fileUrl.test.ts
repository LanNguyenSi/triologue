/**
 * Unit tests for authFileUrl (shared file-URL builder, client/src/lib/fileUrl.ts).
 *
 * Node environment; mocks useAuthStore. Locks in the encodeURIComponent
 * behavior that task #11 unified across the three former local copies, plus
 * the raw (unencoded) token passthrough they all shared.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../stores/authStore', () => ({
  useAuthStore: { getState: vi.fn(() => ({ token: null })) },
}));

import { authFileUrl } from '../lib/fileUrl';
import { useAuthStore } from '../stores/authStore';

const mockStore = useAuthStore as unknown as { getState: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.resetAllMocks();
  mockStore.getState.mockReturnValue({ token: null });
});

describe('authFileUrl', () => {
  it('returns a non-/uploads/ input unchanged', () => {
    expect(authFileUrl('https://cdn.example.com/x.png')).toBe('https://cdn.example.com/x.png');
    expect(authFileUrl('/api/files/x.png')).toBe('/api/files/x.png');
  });

  it('rewrites /uploads/ to /api/files/ and appends the token; safe names are byte-identical to the old no-encode URL', () => {
    mockStore.getState.mockReturnValue({ token: 'tok.123' });
    expect(authFileUrl('/uploads/report.pdf')).toBe('/api/files/report.pdf?token=tok.123');
  });

  it('omits the token query when no token is present', () => {
    expect(authFileUrl('/uploads/report.pdf')).toBe('/api/files/report.pdf');
  });

  it('encodeURIComponent-encodes filenames with spaces and special characters', () => {
    mockStore.getState.mockReturnValue({ token: 'tok' });
    expect(authFileUrl('/uploads/my file&x.png')).toBe('/api/files/my%20file%26x.png?token=tok');
  });

  it('leaves the token unencoded (matches all three former local copies)', () => {
    mockStore.getState.mockReturnValue({ token: 'a+b/c=' });
    expect(authFileUrl('/uploads/f.png')).toBe('/api/files/f.png?token=a+b/c=');
  });
});
