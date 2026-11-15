// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ApprovalBoundInput, boundInputOf, BOUND_INPUT_MAX_LINES } from './ApprovalBoundInput';

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
    expect(pre.textContent!.split('\n').length).toBe(BOUND_INPUT_MAX_LINES + 1);
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
