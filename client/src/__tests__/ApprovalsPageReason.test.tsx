// @vitest-environment jsdom
/**
 * The approval card renders the agent's free-text reason through the same
 * escapeInvisible as the bound input: control, format and bidi characters
 * must show as visible \uXXXX escapes with the warning line, and a plain
 * reason must render unchanged with no warning.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en', setLanguage: vi.fn() }),
}));

const apiClientMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/apiClient', () => ({ apiClient: apiClientMock }));

import { ApprovalsPage } from '../pages/ApprovalsPage';

afterEach(cleanup);

function mountWithReason(reason: string) {
  apiClientMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      approvals: [
        {
          id: 'ap-r1', connectorId: 'github', actionId: 'merge_pull_request',
          riskLevel: 'high', reason, status: 'pending', taskId: null, projectId: null,
          requestedBy: 'ice-agent', decidedBy: null, decisionNote: null,
          createdAt: '2026-11-01T10:00:00.000Z', decidedAt: null,
        },
      ],
    }),
  });
  return render(<ApprovalsPage />);
}

async function waitForCard() {
  await waitFor(() => {
    expect(screen.getByText('approvals.input.none')).toBeTruthy();
  });
}

describe('ApprovalCard reason escaping', () => {
  it('shows a bidi override in the reason as a visible escape and warns', async () => {
    mountWithReason('Merge PR #42: \u202Esafe to approve\u202C now');
    await waitForCard();
    const text = document.body.textContent!;
    expect(text).toContain('\\u202Esafe to approve\\u202C now');
    expect(text).not.toContain('\u202E');
    expect(text).not.toContain('\u202C');
    expect(screen.getByText('approvals.input.escaped')).toBeTruthy();
  });

  it('shows a zero-width character in the reason as a visible escape and warns', async () => {
    mountWithReason('Delete the\u200B branch feature/old');
    await waitForCard();
    const text = document.body.textContent!;
    expect(text).toContain('Delete the\\u200B branch feature/old');
    expect(text).not.toContain('\u200B');
    expect(screen.getByText('approvals.input.escaped')).toBeTruthy();
  });

  it('renders a plain reason unchanged and shows no warning', async () => {
    mountWithReason('Merge PR #42 into main');
    await waitForCard();
    expect(screen.getByText('Merge PR #42 into main')).toBeTruthy();
    expect(screen.queryByText('approvals.input.escaped')).toBeNull();
  });
});
