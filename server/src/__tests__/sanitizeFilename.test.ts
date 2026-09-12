import { stripControlChars } from '../utils/sanitizeFilename';

describe('stripControlChars', () => {
  it('strips ASCII control characters 0x00-0x1f and 0x7f', () => {
    const withControls = 'evil\x00\x01\x1f\x7fname\r\n.png';
    expect(stripControlChars(withControls)).toBe('evilname.png');
  });

  it('keeps a double quote (not a control character)', () => {
    expect(stripControlChars('evil"name.png')).toBe('evil"name.png');
  });

  it('keeps U+2028 (line separator, not an ASCII control character)', () => {
    expect(stripControlChars('evil name.png')).toBe('evil name.png');
  });

  it('falls back to the "file" placeholder when the name is entirely control characters', () => {
    // Mutation target: dropping the empty-string fallback would return "".
    expect(stripControlChars('\x00\x01\x1f\x7f')).toBe('file');
  });

  it('leaves an already-clean name unchanged', () => {
    expect(stripControlChars('report.pdf')).toBe('report.pdf');
  });
});
