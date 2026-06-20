/**
 * Guards the BrandMark SVG gradient id against the duplicate-id regression.
 *
 * BrandMark used to hardcode `id="ot-bg"`. AppShell and LandingPage each render
 * two BrandMarks in one document, and the browser resolves `url(#ot-bg)` to the
 * FIRST matching gradient in the DOM, so the second mark rendered with the wrong
 * gradient box. The fix derives a per-instance id from React `useId()`.
 *
 * This test renders two instances in a single tree (the real-world scenario) and
 * asserts the gradient ids differ and that each rect references its own gradient.
 * Re-introducing a hardcoded shared id would make the two ids equal and fail.
 *
 * Uses renderToStaticMarkup so no DOM environment is required (the client test
 * setup has no jsdom).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrandMark } from '../components/ui/BrandMark';

const gradientIds = (html: string) =>
  [...html.matchAll(/<linearGradient[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);

const fillRefIds = (html: string) =>
  [...html.matchAll(/fill="url\(#([^)]+)\)"/g)].map((m) => m[1]);

describe('BrandMark', () => {
  it('gives each instance a unique gradient id when rendered in one tree', () => {
    const html = renderToStaticMarkup(
      <div>
        <BrandMark />
        <BrandMark />
      </div>,
    );

    const ids = gradientIds(html);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);

    // Each rect must reference its own gradient, not a single shared id.
    const refs = fillRefIds(html);
    expect(refs).toContain(ids[0]);
    expect(refs).toContain(ids[1]);
  });

  it('does not hardcode the legacy ot-bg id', () => {
    const html = renderToStaticMarkup(<BrandMark />);
    expect(html).not.toContain('id="ot-bg"');
    expect(html).not.toContain('url(#ot-bg)');
  });
});
