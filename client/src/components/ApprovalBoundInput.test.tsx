// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import {
  ApprovalBoundInput,
  boundInputOf,
  escapeInvisible,
  EXCLUDED_FROM_HASH,
} from './ApprovalBoundInput';

afterEach(cleanup);

const t = (key: string) => key;

function mount(actionInput: unknown) {
  return render(<ApprovalBoundInput actionInput={actionInput} isDark={false} t={t} id="a1" />);
}

describe('boundInputOf', () => {
  it('drops exactly the fields the server leaves out of the hash', () => {
    expect(boundInputOf({ approvalReason: 'r', taskId: 't', path: '/x', nested: { taskId: 'keep' } }))
      .toEqual({ path: '/x', nested: { taskId: 'keep' } });
  });
  it('is undefined for null, undefined, {} and an object holding only excluded fields', () => {
    expect(boundInputOf(null)).toBeUndefined();
    expect(boundInputOf(undefined)).toBeUndefined();
    expect(boundInputOf({})).toBeUndefined();
    expect(boundInputOf({ approvalReason: 'r', taskId: 't' })).toBeUndefined();
  });
  it('shapes an array the way the server hashes it: an object with numeric keys', () => {
    expect(boundInputOf(['a', 'b'])).toEqual({ 0: 'a', 1: 'b' });
    expect(boundInputOf([])).toBeUndefined();
  });
  it('is undefined for a non-object body, which the server hashes as {}', () => {
    expect(boundInputOf('text')).toBeUndefined();
    expect(boundInputOf(5)).toBeUndefined();
  });
  it('keeps falsy but present values', () => {
    expect(boundInputOf({ flag: false })).toEqual({ flag: false });
  });
});

describe('ApprovalBoundInput', () => {
  it('renders the input under the authorisation label and hides excluded fields', () => {
    mount({ itemId: 'A-17', approvalReason: 'secret-reason', taskId: 'task-99' });
    expect(screen.getByRole('heading', { name: 'approvals.input.label' })).toBeTruthy();
    const text = document.querySelector('pre')!.textContent!;
    expect(text).toContain('"itemId": "A-17"');
    expect(text).not.toContain('approvalReason');
    expect(text).not.toContain('secret-reason');
    expect(text).not.toContain('task-99');
  });

  it('renders HTML in a value as text, not markup', () => {
    mount({ text: '<b>bold</b><img src=x onerror=alert(1)>' });
    const pre = document.querySelector('pre')!;
    expect(pre.querySelector('b')).toBeNull();
    expect(pre.querySelector('img')).toBeNull();
    expect(pre.textContent).toContain('<b>bold</b>');
  });

  it('shows the no-input state for an empty input', () => {
    mount({});
    expect(screen.getByText('approvals.input.none')).toBeTruthy();
    expect(document.querySelector('pre')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the no-input state for a missing input', () => {
    mount(undefined);
    expect(screen.getByText('approvals.input.none')).toBeTruthy();
  });

  it('does not truncate a small input and shows no toggle', () => {
    mount({ a: 1 });
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('pre')!.textContent).not.toContain('…');
  });

  it('truncates a long input by lines and expands and collapses via an aria-expanded button', () => {
    const items = Array.from({ length: 40 }, (_, i) => i);
    mount({ items });
    const pre = document.querySelector('pre')!;
    expect(pre.textContent!.split('\n').length).toBe(21);
    expect(pre.textContent).toContain('…');
    expect(pre.textContent).not.toContain('39');
    const btn = screen.getByRole('button', { name: 'approvals.input.expand' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(pre.textContent).toContain('39');
    expect(pre.textContent).not.toContain('…');
    const back = screen.getByRole('button', { name: 'approvals.input.collapse' });
    expect(back.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(back);
    expect(pre.textContent).not.toContain('39');
  });

  it('truncates a long single-line-ish input by characters', () => {
    mount({ blob: 'x'.repeat(5000) });
    const pre = document.querySelector('pre')!;
    expect(pre.textContent!.length).toBeLessThan(1600);
    expect(screen.getByRole('button', { name: 'approvals.input.expand' })).toBeTruthy();
  });
});

describe('thresholds', () => {
  it('does not truncate at exactly the line limit and truncates one line above it', () => {
    const obj = (keys: number) => Object.fromEntries(Array.from({ length: keys }, (_, i) => [`k${i}`, i]));
    // pretty JSON of n keys is n + 2 lines: 20 lines fit, 21 do not (literal limits on purpose)
    mount(obj(18));
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    mount(obj(19));
    expect(screen.getByRole('button', { name: 'approvals.input.expand' })).toBeTruthy();
  });

  it('does not truncate at exactly the character limit and truncates one character above it', () => {
    const withLen = (n: number) => {
      const overhead = JSON.stringify({ b: '' }, null, 2).length;
      return { b: 'x'.repeat(n - overhead) };
    };
    expect(JSON.stringify(withLen(1500), null, 2).length).toBe(1500);
    mount(withLen(1500));
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    mount(withLen(1501));
    expect(screen.getByRole('button', { name: 'approvals.input.expand' })).toBeTruthy();
  });

  it('points aria-controls at the pre it controls', () => {
    mount({ blob: 'x'.repeat(5000) });
    const btn = screen.getByRole('button', { name: 'approvals.input.expand' });
    const pre = document.querySelector('pre')!;
    expect(pre.id).toBeTruthy();
    expect(btn.getAttribute('aria-controls')).toBe(pre.id);
  });

  it('is not a scroll region, collapsed or expanded', () => {
    mount({ blob: 'x'.repeat(5000) });
    const pre = document.querySelector('pre')!;
    expect(pre.className).not.toMatch(/overflow-(auto|scroll|y-)/);
    expect(pre.className).not.toMatch(/max-h-/);
    fireEvent.click(screen.getByRole('button'));
    expect(pre.className).not.toMatch(/overflow-(auto|scroll|y-)/);
    expect(pre.className).not.toMatch(/max-h-/);
  });
});

describe('invisible characters', () => {
  it('shows a bidi override as a literal escape and warns', () => {
    mount({ branch: '\u202Eniam' });
    const text = document.querySelector('pre')!.textContent!;
    expect(text).toContain('\\u202Eniam');
    expect(text).not.toContain('\u202E');
    expect(screen.getByText('approvals.input.escaped')).toBeTruthy();
  });

  it('escapes zero-width, BOM, separators and isolates', () => {
    mount({ a: 'x\u200By\uFEFFz\u2028w\u2066v\u0000u\u007Ft\u0085s\u00ADr\u2029q' });
    const text = document.querySelector('pre')!.textContent!;
    for (const esc of ['\\u200B', '\\uFEFF', '\\u2028', '\\u2066', '\\u0000', '\\u007F', '\\u0085', '\\u00AD', '\\u2029']) expect(text).toContain(esc);
    for (const raw of ['\u200B', '\uFEFF', '\u2028', '\u2066', '\u0000', '\u007F', '\u0085', '\u00AD', '\u2029']) expect(text.includes(raw)).toBe(false);
  });

  it('escapes astral format characters with braces', () => {
    expect(escapeInvisible('a\u{E0041}b')).toEqual({ text: 'a\\u{E0041}b', escaped: true });
  });

  it('shows no warning for plain text and keeps layout newlines', () => {
    mount({ a: 'plain', b: 1 });
    expect(screen.queryByText('approvals.input.escaped')).toBeNull();
    expect(document.querySelector('pre')!.textContent).toContain('\n');
  });

  it('keeps a literal backslash-u sequence distinguishable from an escaped character', () => {
    mount({ a: '\\u202E' });
    expect(screen.queryByText('approvals.input.escaped')).toBeNull();
  });
});

describe('exclusion list matches the server', () => {
  it('equals the keys proxy.ts deletes from the hashed input', () => {
    const src = readFileSync(
      resolve(process.cwd(), '../server/src/connectors/proxy.ts'),
      'utf8',
    );
    const dotted = [...src.matchAll(/delete\s+(?:\(rawInput[^)]*\)|rawInput)\.(\w+)/g)].map(m => m[1]);
    const bracketed = [...src.matchAll(/delete\s+(?:\(rawInput[^)]*\)|rawInput)\[\s*['"](\w+)['"]\s*\]/g)].map(m => m[1]);
    // Every delete on rawInput must be one of the two parsed forms.
    const allDeletes = [...src.matchAll(/delete\s+\(?rawInput/g)].length;
    expect(dotted.length + bracketed.length).toBe(allDeletes);
    const keys = [...dotted, ...bracketed].sort();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toEqual([...EXCLUDED_FROM_HASH].sort());
  });
});
