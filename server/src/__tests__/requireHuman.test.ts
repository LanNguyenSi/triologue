/**
 * Unit tests for the exported `requireHuman` middleware in middleware/auth.ts.
 *
 * Companion to the static call-site guard in userCreateUserTypeGuard.test.ts
 * (agent-tasks 6b1a1772). That test keeps future user.create() call sites
 * from silently omitting userType; this test pins the other half of the
 * defense: even if some future row ends up with a userType that is neither
 * 'HUMAN' nor a known AI value (a stale/typo'd value, a partially-migrated
 * row, etc.), requireHuman must still reject it rather than fail open.
 *
 * requireHuman only inspects req.user (populated by the authenticate
 * middleware before the route handler runs) and never queries the database,
 * so these tests run without RUN_DB_TESTS / a live Postgres, mirroring
 * requireAdmin.test.ts.
 *
 * Mutation intent: if the guard were ever loosened to an allowlist check
 * (e.g. `req.user.userType === 'HUMAN' || !KNOWN_AI_TYPES.includes(...)`)
 * instead of the current `!== 'HUMAN'` denylist-of-one, the "unknown
 * userType" case below would incorrectly call next() and FAIL this test.
 */
import type { Request, Response } from 'express';
import { requireHuman } from '../middleware/auth';

function buildRes() {
  const json = jest.fn();
  const statusObj = { json };
  const status = jest.fn().mockReturnValue(statusObj);
  return { res: { status, json } as Partial<Response> as Response, statusJson: json, status };
}

describe('requireHuman middleware', () => {
  let next: jest.Mock;

  beforeEach(() => {
    next = jest.fn();
  });

  it('returns 403 and does not call next when req.user is absent', () => {
    const req = {} as Partial<Request> as Request;
    const { res, status } = buildRes();

    requireHuman(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 and does not call next for a known AI userType (AI_AGENT)', () => {
    const req = { user: { id: '', username: '', userType: 'AI_AGENT', displayName: '' } } as Partial<Request> as Request;
    const { res, status } = buildRes();

    requireHuman(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('negative control: returns 403 and does not call next for a userType that is neither HUMAN nor a known AI value', () => {
    // Regression guard for a silently-mis-provisioned row (e.g. a future
    // create-path bug, a typo'd enum value, a partially migrated record).
    // The current check is `userType !== 'HUMAN'`, which fails closed for
    // any unrecognized value. Pin that behavior so it can't regress to an
    // allowlist that only checks against known AI types.
    const req = { user: { id: '', username: '', userType: 'ROGUE_TYPE', displayName: '' } } as Partial<Request> as Request;
    const { res, status } = buildRes();

    requireHuman(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next exactly once when user.userType is HUMAN', () => {
    const req = { user: { id: '', username: '', userType: 'HUMAN', displayName: '' } } as Partial<Request> as Request;
    const { res, status } = buildRes();

    requireHuman(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });
});
