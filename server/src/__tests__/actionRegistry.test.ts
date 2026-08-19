/**
 * Tests for src/services/actionRegistry.ts — MED gap coverage
 * (Follow-up to PR #168, task dfadd56b: "services (limits/dedupe/retry edges)")
 *
 * Guards tested (buildPermittedConnectorActions — the per-user action
 * allowlist used to scope which connector actions an agent may invoke):
 *   1. A connector the user has NO ConnectorPermission row for is excluded
 *      entirely, even if the connector itself is enabled.
 *   2. `allowedActions: []` is the wildcard — ALL of that connector's
 *      actions are exposed once a permission row exists.
 *   3. A non-empty `allowedActions` list scopes exposure to exactly those
 *      action ids — other actions on the same connector are excluded.
 *   4. No token resolvable for the connector (resolveToken → null) excludes
 *      all of that connector's actions, even with a permissive allowlist.
 *
 * Mutation-check intent (mutation probe #5 of 5):
 *   - Negate the allowlist check, e.g. `if (allowed.length > 0 &&
 *     allowed.includes(action.id)) continue;` (dropping the `!`) → the
 *     "scopes to exactly the allowed action ids" test below would then
 *     exclude the allowed action and include the forbidden one, flipping
 *     the assertion.
 */

jest.mock('../connectors/registry', () => ({
  listEnabledConnectors: jest.fn(),
}));

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    connectorPermission: { findMany: jest.fn() },
  },
}));

jest.mock('../services/tokenManager', () => ({
  resolveToken: jest.fn(),
}));

import { listEnabledConnectors } from '../connectors/registry';
import prisma from '../lib/prisma';
import { resolveToken } from '../services/tokenManager';
import { buildPermittedConnectorActions } from '../services/actionRegistry';
import type { ConnectorDefinition } from '../connectors/types';

const GITHUB_CONNECTOR: ConnectorDefinition = {
  id: 'github',
  name: 'GitHub',
  provider: 'github',
  category: 'dev',
  auth: { type: 'oauth2', provider: 'github', scope: 'repo' },
  actions: [
    { id: 'github.createIssue', name: 'Create Issue', description: '', method: 'POST', urlTemplate: '/issues' },
    { id: 'github.deleteRepo', name: 'Delete Repo', description: '', method: 'DELETE', urlTemplate: '/repo' },
  ],
};

const SLACK_CONNECTOR: ConnectorDefinition = {
  id: 'slack',
  name: 'Slack',
  provider: 'slack',
  category: 'comms',
  auth: { type: 'oauth2', provider: 'slack', scope: 'chat:write' },
  actions: [
    { id: 'slack.postMessage', name: 'Post Message', description: '', method: 'POST', urlTemplate: '/chat.postMessage' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  (resolveToken as jest.Mock).mockResolvedValue('a-valid-token');
});

describe('buildPermittedConnectorActions — no permission row', () => {
  it('excludes a connector the user has no ConnectorPermission row for', async () => {
    (listEnabledConnectors as jest.Mock).mockReturnValue([GITHUB_CONNECTOR]);
    (prisma.connectorPermission.findMany as jest.Mock).mockResolvedValue([]);

    const actions = await buildPermittedConnectorActions('user-1');

    expect(actions).toEqual([]);
  });
});

describe('buildPermittedConnectorActions — empty allowlist is wildcard-all', () => {
  it('exposes every action on the connector when allowedActions is []', async () => {
    (listEnabledConnectors as jest.Mock).mockReturnValue([GITHUB_CONNECTOR]);
    (prisma.connectorPermission.findMany as jest.Mock).mockResolvedValue([
      { connectorId: 'github', allowedActions: [] },
    ]);

    const actions = await buildPermittedConnectorActions('user-1');

    expect(actions.map((a) => a.id).sort()).toEqual(
      ['github.createIssue', 'github.deleteRepo'].sort(),
    );
  });
});

describe('buildPermittedConnectorActions — scoped allowlist', () => {
  it('scopes to exactly the allowed action ids, excluding the rest', async () => {
    // Mutation target: negating the `!allowed.includes(action.id)` check
    // would flip this — createIssue (allowed) would be excluded and
    // deleteRepo (not allowed) would be exposed instead.
    (listEnabledConnectors as jest.Mock).mockReturnValue([GITHUB_CONNECTOR]);
    (prisma.connectorPermission.findMany as jest.Mock).mockResolvedValue([
      { connectorId: 'github', allowedActions: ['github.createIssue'] },
    ]);

    const actions = await buildPermittedConnectorActions('user-1');

    expect(actions.map((a) => a.id)).toEqual(['github.createIssue']);
  });

  it('only scopes the connector it applies to, leaving other connectors independent', async () => {
    (listEnabledConnectors as jest.Mock).mockReturnValue([GITHUB_CONNECTOR, SLACK_CONNECTOR]);
    (prisma.connectorPermission.findMany as jest.Mock).mockResolvedValue([
      { connectorId: 'github', allowedActions: ['github.createIssue'] },
      { connectorId: 'slack', allowedActions: [] },
    ]);

    const actions = await buildPermittedConnectorActions('user-1');

    expect(actions.map((a) => a.id).sort()).toEqual(
      ['github.createIssue', 'slack.postMessage'].sort(),
    );
  });
});

describe('buildPermittedConnectorActions — no resolvable token', () => {
  it('excludes all actions for a connector when resolveToken returns null', async () => {
    (listEnabledConnectors as jest.Mock).mockReturnValue([GITHUB_CONNECTOR]);
    (prisma.connectorPermission.findMany as jest.Mock).mockResolvedValue([
      { connectorId: 'github', allowedActions: [] },
    ]);
    (resolveToken as jest.Mock).mockResolvedValue(null);

    const actions = await buildPermittedConnectorActions('user-1');

    expect(actions).toEqual([]);
  });
});
