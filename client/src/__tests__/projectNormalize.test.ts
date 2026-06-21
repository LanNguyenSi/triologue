/**
 * Unit tests for the extracted project-domain normalizers
 * (client/src/projects/projectNormalize.ts).
 *
 * These functions were copy-pasted in ProjectDetailPage and ProjectEditPage
 * and are now shared; the tests lock their non-trivial behavior (status
 * ordering, slice caps, date-regex guards, status fallback, default
 * fallthrough) so a future edit can't silently regress both pages.
 */
import { describe, it, expect } from 'vitest';
import {
  defaultWorkflowConfig,
  normalizeWorkflowConfig,
  defaultProjectContext,
  normalizeProjectContext,
} from '../projects/projectNormalize';

type WfInput = Parameters<typeof normalizeWorkflowConfig>[0];
type CtxInput = Parameters<typeof normalizeProjectContext>[0];

describe('normalizeWorkflowConfig', () => {
  it('returns defaults for null/undefined', () => {
    expect(normalizeWorkflowConfig()).toEqual(defaultWorkflowConfig());
    expect(normalizeWorkflowConfig(null)).toEqual(defaultWorkflowConfig());
  });

  it('always keeps the core statuses and orders enabled statuses by TASK_STATUS_ORDER', () => {
    const out = normalizeWorkflowConfig({ enabledStatuses: ['blocked', 'todo'] });
    expect(out.enabledStatuses).toEqual(['todo', 'in_progress', 'blocked', 'done']);
  });

  it('ignores unknown enabled statuses', () => {
    const out = normalizeWorkflowConfig({ enabledStatuses: ['nonsense', 'in_review'] } as WfInput);
    expect(out.enabledStatuses).toEqual(['todo', 'in_progress', 'in_review', 'done']);
    expect(out.enabledStatuses).not.toContain('nonsense');
  });

  it('applies only string instructions for known statuses', () => {
    const out = normalizeWorkflowConfig({
      instructions: { todo: 'do it', bogus: 'x', done: 42 },
    } as unknown as WfInput);
    expect(out.instructions.todo).toBe('do it');
    expect(out.instructions.done).toBe('');
    expect(out.instructions).not.toHaveProperty('bogus');
  });
});

describe('normalizeProjectContext', () => {
  it('returns defaults for null/undefined', () => {
    expect(normalizeProjectContext()).toEqual(defaultProjectContext());
  });

  it('trims, drops empties, and caps definitionOfDone at 40', () => {
    const out = normalizeProjectContext({
      definitionOfDone: ['  a  ', '', '   ', ...Array<string>(50).fill('x')],
    });
    expect(out.definitionOfDone[0]).toBe('a');
    expect(out.definitionOfDone).toHaveLength(40);
    expect(out.definitionOfDone).not.toContain('');
  });

  it('validates decisionLog dates, drops all-empty entries, and falls back ids by index', () => {
    const out = normalizeProjectContext({
      decisionLog: [
        { date: '2026-01-02', title: 'T' },
        { date: 'not-a-date', decision: 'D' },
        {},
      ],
    } as unknown as CtxInput);
    expect(out.decisionLog).toHaveLength(2);
    expect(out.decisionLog[0]).toMatchObject({ id: 'decision-1', date: '2026-01-02', title: 'T' });
    expect(out.decisionLog[1].id).toBe('decision-2');
    expect(out.decisionLog[1].date).toBe('');
  });

  it('falls back milestone status to "planned" for unknown values', () => {
    const out = normalizeProjectContext({
      milestones: [
        { title: 'M1', status: 'in_progress' },
        { title: 'M2', status: 'bogus' },
        { title: 'M3', status: 'done' },
      ],
    } as unknown as CtxInput);
    expect(out.milestones.map((m) => m.status)).toEqual(['in_progress', 'planned', 'done']);
  });

  it('trims brief/runbook strings and keeps defaults for blanks', () => {
    const out = normalizeProjectContext({ brief: { goal: '  ship it  ', scope: '   ' } } as CtxInput);
    expect(out.brief.goal).toBe('ship it');
    expect(out.brief.scope).toBe('');
    expect(out.runbook.preferredLanguage).toBe('');
  });
});
