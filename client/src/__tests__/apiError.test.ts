/**
 * Unit tests for the readError helper.
 *
 * Runs in Node environment (no jsdom).
 */
import { describe, it, expect } from 'vitest';
import { readError } from '../lib/apiError';

function makeResponse(body: unknown, ok = false) {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeNonJsonResponse() {
  return {
    ok: false,
    json: () => Promise.reject(new SyntaxError('not json')),
  } as unknown as Response;
}

describe('readError', () => {
  it('extracts the error field from a JSON response body', async () => {
    const res = makeResponse({ error: 'Unauthorized' });
    const err = await readError(res, 'fallback message');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Unauthorized');
  });

  it('falls back to the fallback string when the body has no error field', async () => {
    const res = makeNonJsonResponse();
    const err = await readError(res, 'Network error');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Network error');
  });
});
