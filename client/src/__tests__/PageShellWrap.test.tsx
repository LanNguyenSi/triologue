/**
 * Guards the PageShell header against long unbreakable subtitle tokens.
 *
 * At >= 640 px the title/subtitle block is a flex item of a row. A flex item
 * defaults to `min-width: auto`, so a URL without break opportunities set the
 * item's min-content width and stretched the whole header past the page.
 * `overflow-wrap: break-word` on the subtitle does not lower min-content, so
 * the item itself needs `min-w-0` next to `break-words` on the paragraph.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageShell } from '../components/ui/PageShell';

vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));

const render = () =>
  renderToStaticMarkup(
    <PageShell title="Title" subtitle="https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" actions={<button>Act</button>}>
      body
    </PageShell>,
  );

const classOf = (html: string, tag: string, text: string) => {
  const m = html.match(new RegExp(`<${tag}[^>]*class="([^"]*)"[^>]*>${text}`));
  return m ? m[1].split(/\s+/) : [];
};

describe('PageShell header wrapping', () => {
  it('lets the title/subtitle flex item shrink below its min-content width', () => {
    const html = render();
    const m = html.match(/<div class="([^"]*)"><h1/);
    expect(m, 'title block wrapper').not.toBeNull();
    expect(m![1].split(/\s+/)).toContain('min-w-0');
  });

  it('breaks long tokens inside the subtitle paragraph', () => {
    expect(classOf(render(), 'p', 'https://')).toContain('break-words');
  });
});
