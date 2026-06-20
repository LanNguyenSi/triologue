/**
 * Unit tests for the exported `requireAdmin` middleware in middleware/auth.ts.
 *
 * These tests are NOT DB-gated: requireAdmin only inspects req.user (populated
 * by the authenticate middleware before the route handler runs) and never
 * queries the database. The prisma import in auth.ts is a module-level side
 * effect that instantiates the client but makes no connection, so the tests
 * run without a database.
 *
 * Mutation intent: if the old `req.user.userType !== 'HUMAN'` guard were
 * re-introduced, a HUMAN user with isAdmin:false would pass the check and
 * call next() — which would FAIL the second test case below.
 */

import { requireAdmin } from '../middleware/auth';
import { validateEnvironment } from '../utils/env-validation';

// ── helpers ──────────────────────────────────────────────────────────────────

function buildRes() {
  const json = jest.fn();
  const statusObj = { json };
  const status = jest.fn().mockReturnValue(statusObj);
  return { res: { status, json } as any, statusJson: json, status };
}

// ── requireAdmin ─────────────────────────────────────────────────────────────

describe('requireAdmin middleware', () => {
  let next: jest.Mock;

  beforeEach(() => {
    next = jest.fn();
  });

  it('returns 401 and does not call next when req.user is absent', () => {
    const req = {} as any;
    const { res, status } = buildRes();

    requireAdmin(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 and does not call next when user.isAdmin is false — regression guard', () => {
    // This case also covers a HUMAN user with isAdmin:false. If the old
    // `userType !== 'HUMAN'` guard were re-introduced, a HUMAN user would
    // bypass the 403 and incorrectly reach next(). The assertion below catches
    // that regression.
    const req = { user: { isAdmin: false, userType: 'HUMAN' } } as any;
    const { res, status } = buildRes();

    requireAdmin(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next exactly once when user.isAdmin is true', () => {
    const req = { user: { isAdmin: true, userType: 'HUMAN' } } as any;
    const { res, status } = buildRes();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });
});

// ── validateEnvironment: INTEGRATION_ENCRYPTION_KEY is optional ──────────────

describe('validateEnvironment — INTEGRATION_ENCRYPTION_KEY is optional', () => {
  let exitSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Prevent process.exit from actually terminating the jest worker
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Guarantee required vars are present (jest.setup.js already sets them,
    // but be explicit so the test is self-contained)
    process.env.JWT_SECRET = 'test-jwt-secret-key';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.ENCRYPTION_KEY = 'test-encryption-key-000000000000';

    // Explicitly absent so we are testing the optional path
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    // Clean up any key that was deleted so other test suites are unaffected
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
  });

  it('treats INTEGRATION_ENCRYPTION_KEY as optional: warns but does not exit when absent', () => {
    validateEnvironment();

    expect(exitSpy).not.toHaveBeenCalled();
    // Diff-sensitive guard: the key must live in the `optional` list, so its
    // absence is surfaced as a startup warning. If it were removed from
    // `optional` (or moved to `required`), this assertion fails.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('INTEGRATION_ENCRYPTION_KEY'),
    );
  });
});
