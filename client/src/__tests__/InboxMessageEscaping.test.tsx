// @vitest-environment jsdom
/**
 * Inbox item text can carry an agent-authored approval reason. Every view that
 * renders it (inbox page, dashboard action center, notification center) shows
 * control, format and bidi characters as visible \uXXXX escapes with a marker,
 * and leaves plain text untouched.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en', setLanguage: vi.fn() }),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: { getState: () => ({ token: 'tok' }) },
}));

vi.mock('../stores/chatStore', () => ({
  useChatStore: () => ({ rooms: [], unreadCounts: {}, loadRooms: vi.fn() }),
}));

const apiClientMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/apiClient', () => ({ apiClient: apiClientMock }));

const storeState = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('../stores/notificationStore', () => {
  const state = () => ({
    items: storeState.items,
    loadInbox: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  });
  return { useNotificationStore: (selector: (s: ReturnType<typeof state>) => unknown) => selector(state()) };
});

import { InboxPage } from '../pages/InboxPage';
import { DashboardPage } from '../pages/DashboardPage';
import { NotificationCenter } from '../components/ui/NotificationCenter';

const BIDI = 'merge \u202Etxt.exe now';
const BIDI_ESCAPED = 'merge \\u202Etxt.exe now';
const PLAIN = 'merge the release branch';

beforeEach(() => {
  apiClientMock.mockReset();
  window.localStorage.setItem('triologue_action_center_start_expanded', '1');
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function setServerItem(message: string) {
  storeState.items = [
    {
      id: 'n1', title: 'Agent action requires approval', message, type: 'info',
      createdAt: Date.now(), read: false, link: '/approvals', source: 'server', eventType: 'approval_request',
    },
  ];
}

function inboxResponse(message: string) {
  apiClientMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      items: [
        { id: 'i1', type: 'approval_request', title: 'Agent action requires approval', message, link: '/approvals', isRead: false, createdAt: '2026-11-01T10:00:00.000Z' },
      ],
      unreadCount: 1,
      totalCount: 1,
    }),
  });
}

describe('InboxPage message escaping', () => {
  it('shows a bidi message escaped with the marker and no raw character', async () => {
    inboxResponse(BIDI);
    const { container } = render(<MemoryRouter><InboxPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('inbox.message.escaped')).toBeTruthy());
    expect(container.textContent).toContain(BIDI_ESCAPED);
    expect(container.textContent).not.toContain('\u202E');
  });

  it('leaves a plain message unchanged with no marker', async () => {
    inboxResponse(PLAIN);
    render(<MemoryRouter><InboxPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(PLAIN)).toBeTruthy());
    expect(screen.queryByText('inbox.message.escaped')).toBeNull();
  });
});

describe('DashboardPage message escaping', () => {
  it('shows a bidi message escaped with the marker and no raw character', async () => {
    apiClientMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    setServerItem(BIDI);
    const { container } = render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByText('inbox.message.escaped')).toBeTruthy();
    expect(container.textContent).toContain(BIDI_ESCAPED);
    expect(container.textContent).not.toContain('\u202E');
  });

  it('leaves a plain message unchanged with no marker', async () => {
    apiClientMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    setServerItem(PLAIN);
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByText(PLAIN)).toBeTruthy();
    expect(screen.queryByText('inbox.message.escaped')).toBeNull();
  });
});

describe('NotificationCenter message escaping', () => {
  function openCenter(message: string) {
    storeState.items = [
      { id: 'l1', title: 'Heads up', message, type: 'info', createdAt: Date.now(), read: false, source: 'local' },
    ];
    const utils = render(<MemoryRouter><NotificationCenter mode="inline" /></MemoryRouter>);
    fireEvent.click(screen.getByTitle('notifications.open'));
    return utils;
  }

  it('shows a bidi message escaped with the marker and no raw character', () => {
    const { container } = openCenter(BIDI);
    expect(screen.getByText('inbox.message.escaped')).toBeTruthy();
    expect(container.textContent).toContain(BIDI_ESCAPED);
    expect(container.textContent).not.toContain('\u202E');
  });

  it('leaves a plain message unchanged with no marker', () => {
    openCenter(PLAIN);
    expect(screen.getByText(PLAIN)).toBeTruthy();
    expect(screen.queryByText('inbox.message.escaped')).toBeNull();
  });
});
