// @vitest-environment jsdom
/**
 * Unit tests for client/src/utils/sanitize.ts (XSS sanitizer).
 *
 * Guards tested:
 *   1. A <script> tag is removed from the output (no script element remains).
 *   2. An href="javascript:..." is stripped from <a> tags.
 *   3. A benign <b>bold</b> element is preserved intact.
 *   4. An event handler on a disallowed <img> (nested inside an allowed <b>)
 *      is removed along with the img element itself.
 *   5. An event handler directly on an otherwise-allowed tag (e.g. <span onclick>)
 *      is stripped while the tag and its text content are preserved.
 *
 * Mutation-test intent:
 *   - Removing the ALLOWED_TAGS guard would let <script> pass → test 1 fails.
 *   - Removing the `attr.value.startsWith("javascript:")` check would let the
 *     javascript: href survive → test 2 fails.
 *   - Removing the attribute-stripping loop would let onclick/onerror survive
 *     → tests 4 and 5 fail.
 *   - Removing ALLOWED_TAGS would also remove non-allowed tags without the
 *     text-content replacement, changing test 3 or 4 unexpectedly.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '../utils/sanitize';

describe('sanitizeHtml — XSS guards', () => {
  // ── 1. <script> tag is stripped ──────────────────────────────────────────

  it('removes the <script> element so no inline script can execute', () => {
    const input = '<b>safe content</b><script>alert("xss")</script>';
    const out = sanitizeHtml(input);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('</script>');
    // The surrounding safe content is preserved.
    expect(out).toContain('<b>safe content</b>');
  });

  it('removes a standalone <script> tag with no other content', () => {
    const out = sanitizeHtml('<script>document.cookie="stolen"</script>');
    expect(out).not.toContain('<script');
  });

  // ── 2. javascript: href is removed from <a> tags ─────────────────────────

  it('strips the javascript: href from an <a> tag while keeping the link text', () => {
    const input = '<a href="javascript:alert(document.cookie)">click me</a>';
    const out = sanitizeHtml(input);
    expect(out).not.toContain('javascript:');
    // The visible link text and the anchor element itself are preserved.
    expect(out).toContain('click me');
    expect(out).toContain('<a');
  });

  it('preserves a safe https:// href on an <a> tag', () => {
    const input = '<a href="https://example.com" target="_blank">link</a>';
    const out = sanitizeHtml(input);
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('link');
  });

  // ── 3. Benign allowed tag is preserved ───────────────────────────────────

  it('preserves <b>bold</b> unchanged', () => {
    const out = sanitizeHtml('<b>bold</b>');
    expect(out).toBe('<b>bold</b>');
  });

  it('preserves nested allowed tags', () => {
    const input = '<strong>hello <em>world</em></strong>';
    const out = sanitizeHtml(input);
    expect(out).toContain('<strong>');
    expect(out).toContain('<em>');
    expect(out).toContain('world');
  });

  // ── 4. Event handler on disallowed <img> inside an allowed tag ───────────

  it('removes a nested <img onerror=...> inside <b> — img is disallowed', () => {
    // img is not in ALLOWED_TAGS; it is replaced with its textContent (empty),
    // taking the onerror handler with it.
    const input = '<b>text<img src="x" onerror="alert(1)">after</b>';
    const out = sanitizeHtml(input);
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<img');
    // Text flanking the img is preserved inside <b>.
    expect(out).toContain('<b>');
    expect(out).toContain('text');
  });

  it('removes an <img> with a src-based tracker when nested inside an allowed tag', () => {
    const input = '<p><img src="https://tracker.evil/pixel.gif" /></p>';
    const out = sanitizeHtml(input);
    expect(out).not.toContain('<img');
    expect(out).toContain('<p>');
  });

  // ── 5. Event handler on an otherwise-allowed tag is stripped ─────────────

  it('strips onclick from a <span> tag while preserving the tag and its content', () => {
    const input = '<span onclick="stealData()">visible text</span>';
    const out = sanitizeHtml(input);
    expect(out).not.toContain('onclick');
    // <span> itself and its text content must survive.
    expect(out).toContain('<span');
    expect(out).toContain('visible text');
  });

  it('strips multiple event handlers (onerror, onmouseover, onfocus) from allowed tags', () => {
    const input =
      '<code onerror="x()" onmouseover="y()" onfocus="z()">code snippet</code>';
    const out = sanitizeHtml(input);
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onmouseover');
    expect(out).not.toContain('onfocus');
    expect(out).toContain('<code>');
    expect(out).toContain('code snippet');
  });

  it('strips an unknown/non-safe attribute from an allowed <b> tag', () => {
    // ALLOWED_ATTRS has no entry for B, so any attribute on B is stripped.
    const input = '<b data-secret="leak" style="color:red">text</b>';
    const out = sanitizeHtml(input);
    expect(out).not.toContain('data-secret');
    expect(out).not.toContain('style');
    expect(out).toContain('text');
  });
});
