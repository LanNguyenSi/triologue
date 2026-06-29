/**
 * Security tests for src/plugins/security.ts — HIGH gap coverage
 *
 * Guards tested in requirePluginCapabilities:
 *   1. No userId on req.user → 401
 *   2. Plugin not active → 404
 *   3. Plugin active but workspace-disabled → 403 ("workspace policy")
 *   4. Plugin workspace-enabled but user-disabled → 403 ("user settings")
 *   5. Plugin enabled for user but missing capability → 403 ("capability policy")
 *   6. All guards pass → next() is called
 *
 * Guards tested in requireProjectPluginLink:
 *   7. No projectId → 400
 *   8. Plugin not linked to project → 409
 *   9. Link exists → next()
 *
 * Pure middleware tests — uses the buildReq/buildRes pattern from requireAdmin.test.ts.
 *
 * Mutation-check intent:
 *   - Invert the workspace-disabled check → a workspace-disabled plugin passes the
 *     check and calls next() instead of returning 403.
 *   - Remove the capability check → next() is called without verifying capabilities.
 */

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    pluginInstallation: { findUnique: jest.fn() },
    userPluginPreference: { findUnique: jest.fn() },
    projectPluginLink: { findUnique: jest.fn() },
  },
}));

jest.mock('../plugins/manager', () => ({
  pluginManager: {
    isPluginActive: jest.fn(),
    getManifest: jest.fn(),
    hasCapabilities: jest.fn(),
  },
}));

import type { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { pluginManager } from '../plugins/manager';
import { requirePluginCapabilities, requireProjectPluginLink } from '../plugins/security';

// ── helpers ──────────────────────────────────────────────────────────────────

function buildReq(userId?: string): Request {
  return {
    user: userId !== undefined ? { id: userId, username: 'u', userType: 'HUMAN', displayName: 'U', isAdmin: false } : undefined,
    body: { projectId: 'proj-1' },
    query: {},
    params: {},
  } as unknown as Request;
}

function buildRes() {
  const json = jest.fn();
  const statusObj = { json };
  const status = jest.fn().mockReturnValue(statusObj);
  return { res: { status, json } as unknown as Response, status, json };
}

const PLUGIN_ID = 'test-plugin';

beforeEach(() => {
  jest.clearAllMocks();
  // Default: plugin active, workspace enabled, user has no override, capability present.
  (pluginManager.isPluginActive as jest.Mock).mockReturnValue(true);
  (pluginManager.getManifest as jest.Mock).mockReturnValue({ enabledByDefault: true });
  (pluginManager.hasCapabilities as jest.Mock).mockReturnValue(true);
  (prisma.pluginInstallation.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.userPluginPreference.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.projectPluginLink.findUnique as jest.Mock).mockResolvedValue(null);
});

// ── requirePluginCapabilities ─────────────────────────────────────────────

describe('requirePluginCapabilities', () => {
  it('returns 401 when req.user is absent (no userId)', async () => {
    const req = buildReq(/* no user */);
    (req as { user?: unknown }).user = undefined;
    const { res, status } = buildRes();
    const next = jest.fn();

    const middleware = requirePluginCapabilities(PLUGIN_ID, ['read']);
    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when userId is an empty string', async () => {
    const req = buildReq('');
    const { res, status } = buildRes();
    const next = jest.fn();

    const middleware = requirePluginCapabilities(PLUGIN_ID, ['read']);
    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when the plugin is not active', async () => {
    (pluginManager.isPluginActive as jest.Mock).mockReturnValue(false);
    const req = buildReq('user-1');
    const { res, status } = buildRes();
    const next = jest.fn();

    const middleware = requirePluginCapabilities(PLUGIN_ID, ['read']);
    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when workspace policy disables the plugin', async () => {
    // Mutation target: invert this check → workspace-disabled plugin passes through
    // and calls next() instead of returning 403.
    (prisma.pluginInstallation.findUnique as jest.Mock).mockResolvedValue({
      isEnabled: false,
    });
    const req = buildReq('user-1');
    const { res, status, json } = buildRes();
    const next = jest.fn();

    const middleware = requirePluginCapabilities(PLUGIN_ID, ['read']);
    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/workspace policy/i) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when the user has disabled the plugin in their settings', async () => {
    // Workspace enabled, but user preference disables it.
    (prisma.pluginInstallation.findUnique as jest.Mock).mockResolvedValue({ isEnabled: true });
    (prisma.userPluginPreference.findUnique as jest.Mock).mockResolvedValue({ isEnabled: false });
    const req = buildReq('user-1');
    const { res, status, json } = buildRes();
    const next = jest.fn();

    const middleware = requirePluginCapabilities(PLUGIN_ID, ['read']);
    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/user settings/i) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when a required capability is missing', async () => {
    // Mutation target: remove the capability check → next() is called without
    // verifying that the plugin actually supports the required operation.
    (prisma.pluginInstallation.findUnique as jest.Mock).mockResolvedValue({ isEnabled: true });
    (prisma.userPluginPreference.findUnique as jest.Mock).mockResolvedValue(null); // user pref: enabled
    (pluginManager.hasCapabilities as jest.Mock).mockReturnValue(false);
    const req = buildReq('user-1');
    const { res, status, json } = buildRes();
    const next = jest.fn();

    const middleware = requirePluginCapabilities(PLUGIN_ID, ['admin:write']);
    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/capability policy/i) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when all guards pass', async () => {
    (prisma.pluginInstallation.findUnique as jest.Mock).mockResolvedValue({ isEnabled: true });
    (prisma.userPluginPreference.findUnique as jest.Mock).mockResolvedValue(null);
    (pluginManager.hasCapabilities as jest.Mock).mockReturnValue(true);
    const req = buildReq('user-1');
    const { res } = buildRes();
    const next = jest.fn();

    const middleware = requirePluginCapabilities(PLUGIN_ID, ['read']);
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ── requireProjectPluginLink ──────────────────────────────────────────────

describe('requireProjectPluginLink', () => {
  it('returns 400 when projectId is absent from the request body', async () => {
    const req = { user: { id: 'user-1' }, body: {}, query: {}, params: {} } as unknown as Request;
    const { res, status } = buildRes();
    const next = jest.fn();

    const middleware = requireProjectPluginLink(PLUGIN_ID, 'body');
    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 409 when the plugin is not linked to the project', async () => {
    // Mutation target: remove the `!link` → 409 guard → an unlinked plugin
    // passes through and calls next().
    (prisma.projectPluginLink.findUnique as jest.Mock).mockResolvedValue(null);
    const req = buildReq('user-1');
    const { res, status, json } = buildRes();
    const next = jest.fn();

    const middleware = requireProjectPluginLink(PLUGIN_ID, 'body');
    await middleware(req, res, next);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/not linked/i) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when the plugin is linked to the project', async () => {
    (prisma.projectPluginLink.findUnique as jest.Mock).mockResolvedValue({ id: 'link-1' });
    const req = buildReq('user-1');
    const { res } = buildRes();
    const next = jest.fn();

    const middleware = requireProjectPluginLink(PLUGIN_ID, 'body');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reads projectId from query params when source is "query"', async () => {
    (prisma.projectPluginLink.findUnique as jest.Mock).mockResolvedValue({ id: 'link-1' });
    const req = {
      user: { id: 'user-1' },
      body: {},
      query: { projectId: 'proj-from-query' },
      params: {},
    } as unknown as Request;
    const { res } = buildRes();
    const next = jest.fn();

    const middleware = requireProjectPluginLink(PLUGIN_ID, 'query');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(prisma.projectPluginLink.findUnique as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_pluginId: { projectId: 'proj-from-query', pluginId: PLUGIN_ID } },
      }),
    );
  });
});
