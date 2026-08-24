import { describe, expect, it } from 'vitest';

import { isSafeNavTarget, safeNavTarget } from '../safeNavTarget';

// The origin used to prove that a rejected value really would have escaped.
const APP_ORIGIN = 'https://app.local';

describe('safeNavTarget', () => {
  describe('accepts genuine in-app paths', () => {
    const ok = [
      '/',
      '/inbox',
      '/room/abc',
      '/projects/42/tasks',
      '/room/abc?tab=files',
      '/room/abc#section',
      '/search?q=a%2Fb',
      '/plugins/my-plugin/view',
    ];
    it.each(ok)('%s', (value) => {
      expect(isSafeNavTarget(value)).toBe(true);
      expect(safeNavTarget(value)).toBe(value);
    });
  });

  describe('rejects targets that escape to another origin', () => {
    // Each of these resolves to a foreign origin when the browser resolves it
    // against the app origin. The assertion below proves that rather than
    // asserting it, so the test cannot rot into a tautology.
    const escaping = [
      '//evil.example.com',
      '\\/evil.example.com',
      '\\\\evil.example.com',
      '/\\evil.example.com',
      'https://evil.example.com/x',
      'http://evil.example.com',
      '//evil.example.com/inbox?a=1',
    ];

    it.each(escaping)('%s really escapes, and is rejected', (value) => {
      // Proof the input is genuinely dangerous: resolved against our origin it
      // lands somewhere else.
      const resolved = new URL(value.replace(/[\t\n\r]/g, ''), APP_ORIGIN);
      expect(resolved.origin).not.toBe(APP_ORIGIN);

      // And the guard rejects it.
      expect(isSafeNavTarget(value)).toBe(false);
      expect(safeNavTarget(value)).toBe('/');
    });
  });

  describe('rejects non-path and non-string targets', () => {
    const bad: unknown[] = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'mailto:a@b.c',
      'inbox', // relative, not path-absolute
      './inbox',
      '../inbox',
      '',
      '   ',
      undefined,
      null,
      42,
      {},
      ['/inbox'],
    ];
    it.each(bad.map((v) => [String(v), v] as const))('%s', (_label, value) => {
      expect(isSafeNavTarget(value)).toBe(false);
      expect(safeNavTarget(value)).toBe('/');
    });
  });

  describe('cannot be walked past with control characters', () => {
    // Browsers strip \t, \n and \r from URLs, so a guard that does not
    // normalise them first can be bypassed: '/\t\\evil' would pass a naive
    // check and then navigate as '/\evil'.
    const sneaky = ['/\t\\evil.example.com', '/\n/evil.example.com', '/\r\\evil.example.com', '\t//evil.example.com'];

    it.each(sneaky.map((v) => [JSON.stringify(v), v] as const))('%s', (_label, value) => {
      const stripped = value.replace(/[\t\n\r]/g, '');
      expect(new URL(stripped, APP_ORIGIN).origin).not.toBe(APP_ORIGIN);
      expect(isSafeNavTarget(value)).toBe(false);
      expect(safeNavTarget(value)).toBe('/');
    });

    it('rejects an embedded NUL rather than truncating at it', () => {
      expect(isSafeNavTarget('/inbox\u0000/evil')).toBe(false);
    });
  });

  describe('fallback behaviour', () => {
    it('uses the supplied fallback', () => {
      expect(safeNavTarget('//evil.example.com', '/inbox')).toBe('/inbox');
      expect(safeNavTarget(undefined, '/inbox')).toBe('/inbox');
    });

    it('defaults to /', () => {
      expect(safeNavTarget('//evil.example.com')).toBe('/');
    });

    it('returns the normalised value, not the raw one', () => {
      expect(safeNavTarget('  /inbox  ')).toBe('/inbox');
    });

    it('does not trust an unsafe fallback, and falls back to / instead', () => {
      // A caller that threads an unvalidated value into the fallback slot
      // (e.g. another field off the same untrusted plugin manifest) must not
      // get an open redirect just because it landed in the second argument.
      expect(safeNavTarget('//evil.example.com', '//also-evil.example.com')).toBe('/');
      expect(safeNavTarget(undefined, '\\/evil.example.com')).toBe('/');
    });
  });

  // Negative control: if the guard were reduced to the naive check this
  // replaced (just "starts with a slash"), these inputs would pass. This test
  // documents why the extra conditions exist.
  it('is stricter than a bare leading-slash check', () => {
    const naive = (v: string) => v.startsWith('/');
    for (const v of ['//evil.example.com', '/\\evil.example.com', '/\t\\evil.example.com']) {
      expect(naive(v)).toBe(true);
      expect(isSafeNavTarget(v)).toBe(false);
    }
  });
});
