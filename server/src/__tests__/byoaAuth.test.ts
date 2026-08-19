/**
 * Security tests for src/middleware/byoaAuth.ts — MED gap coverage
 * (Follow-up to PR #168, task dfadd56b: "middleware (malformed token)")
 *
 * Guards tested:
 *   1. Missing/malformed bearer token → 401 before any DB lookup.
 *   2. Token not found in the DB → 401.
 *   3. Agent status 'pending' → 403 (admin approval pending).
 *   4. Agent status 'rejected', or agentToken.isActive false → 403.
 *   5. agentToken.agentUser.isActive false → 401 (the underlying human/agent
 *      user account itself was deactivated).
 *   6. Valid, active token → next() is called and req.agentToken is set to
 *      the resolved payload.
 *   7. A DB/infra error surfaces as 500, not an unhandled rejection.
 *
 * Mutation-check intent:
 *   - Remove the `!rawToken` early-return → a request with no Authorization
 *     header would reach the DB lookup with `token: undefined` instead of
 *     failing fast with 401.
 *   - Remove/weaken the `status === 'pending'` or `status === 'rejected' ||
 *     !isActive` branches → a pending/rejected agent would fall through to
 *     `next()` and be treated as authenticated.
 */

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    agentToken: { findUnique: jest.fn() },
  },
}));

import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { byoaAuth, readByoaBearerToken, resolveActiveAgentToken } from '../middleware/byoaAuth';

function buildReq(authHeader?: string): Request {
  return {
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
  } as unknown as Request;
}

function buildRes(): Response & { statusCode?: number; body?: unknown } {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  }) as unknown as Response['json'];
  return res as Response & { statusCode?: number; body?: unknown };
}

const ACTIVE_AGENT = {
  id: 'agent-token-1',
  userId: 'user-agent-1',
  name: 'TestAgent',
  mentionKey: 'testagent',
  config: {},
  status: 'active',
  isActive: true,
  agentUser: { id: 'user-agent-1', isActive: true, displayName: 'Test Agent' },
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ── readByoaBearerToken (pure helper) ──────────────────────────────────────

describe('readByoaBearerToken', () => {
  it('extracts the raw token from a well-formed byoa_ bearer header', () => {
    const req = buildReq('Bearer byoa_abc123');
    expect(readByoaBearerToken(req)).toBe('byoa_abc123');
  });

  it('returns null when there is no Authorization header', () => {
    const req = buildReq(undefined);
    expect(readByoaBearerToken(req)).toBeNull();
  });

  it('returns null for a non-byoa bearer token (e.g. a JWT)', () => {
    const req = buildReq('Bearer some.jwt.token');
    expect(readByoaBearerToken(req)).toBeNull();
  });

  it('returns null for a malformed header missing the "Bearer " prefix', () => {
    const req = buildReq('byoa_abc123');
    expect(readByoaBearerToken(req)).toBeNull();
  });
});

// ── byoaAuth middleware ─────────────────────────────────────────────────────

describe('byoaAuth — missing/malformed token', () => {
  it('returns 401 when no Authorization header is present', async () => {
    // Mutation target: removing the `!rawToken` guard would let `undefined`
    // reach prisma.agentToken.findUnique instead of failing fast.
    const req = buildReq(undefined);
    const res = buildRes();
    const next = jest.fn();

    await byoaAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual({ error: 'Agent bearer token required (prefix: byoa_)' });
    expect(next).not.toHaveBeenCalled();
    expect(prisma.agentToken.findUnique as jest.Mock).not.toHaveBeenCalled();
  });

  it('returns 401 for a malformed (non byoa_) token', async () => {
    const req = buildReq('Bearer not-a-byoa-token');
    const res = buildRes();
    const next = jest.fn();

    await byoaAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('byoaAuth — token not found', () => {
  it('returns 401 when the token does not resolve to any AgentToken row', async () => {
    (prisma.agentToken.findUnique as jest.Mock).mockResolvedValue(null);
    const req = buildReq('Bearer byoa_nonexistent');
    const res = buildRes();
    const next = jest.fn();

    await byoaAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual({ error: 'Invalid agent token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the resolved agentUser is inactive', async () => {
    (prisma.agentToken.findUnique as jest.Mock).mockResolvedValue({
      ...ACTIVE_AGENT,
      agentUser: { ...ACTIVE_AGENT.agentUser, isActive: false },
    });
    const req = buildReq('Bearer byoa_valid');
    const res = buildRes();
    const next = jest.fn();

    await byoaAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('byoaAuth — pending/rejected/deactivated agent', () => {
  it('returns 403 when the agent is pending admin approval', async () => {
    // Mutation target: removing this branch lets a not-yet-approved agent
    // through to next() with a live req.agentToken.
    (prisma.agentToken.findUnique as jest.Mock).mockResolvedValue({
      ...ACTIVE_AGENT,
      status: 'pending',
    });
    const req = buildReq('Bearer byoa_pending');
    const res = buildRes();
    const next = jest.fn();

    await byoaAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({ error: 'Agent is pending admin approval' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when the agent has been rejected', async () => {
    (prisma.agentToken.findUnique as jest.Mock).mockResolvedValue({
      ...ACTIVE_AGENT,
      status: 'rejected',
    });
    const req = buildReq('Bearer byoa_rejected');
    const res = buildRes();
    const next = jest.fn();

    await byoaAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({ error: 'Agent has been deactivated or rejected' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when the token itself has isActive: false (status still active)', async () => {
    // Mutation target: removing `|| !agentToken.isActive` would let a
    // revoked-but-still-"active"-status token through.
    (prisma.agentToken.findUnique as jest.Mock).mockResolvedValue({
      ...ACTIVE_AGENT,
      status: 'active',
      isActive: false,
    });
    const req = buildReq('Bearer byoa_revoked');
    const res = buildRes();
    const next = jest.fn();

    await byoaAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('byoaAuth — success path', () => {
  it('calls next() and attaches the resolved agent token to req.agentToken', async () => {
    (prisma.agentToken.findUnique as jest.Mock).mockResolvedValue(ACTIVE_AGENT);
    const req = buildReq('Bearer byoa_valid');
    const res = buildRes();
    const next = jest.fn();

    await byoaAuth(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.agentToken).toEqual(ACTIVE_AGENT);
  });
});

describe('byoaAuth — DB/infra error handling', () => {
  it('returns 500 instead of throwing/hanging when the DB lookup rejects', async () => {
    (prisma.agentToken.findUnique as jest.Mock).mockRejectedValue(new Error('DB down'));
    const req = buildReq('Bearer byoa_valid');
    const res = buildRes();
    const next = jest.fn();

    await byoaAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── resolveActiveAgentToken (pure helper, exercised indirectly above but
//    verified directly here for the success-object shape) ─────────────────

describe('resolveActiveAgentToken', () => {
  it('returns { agentToken } on success with no error field', async () => {
    (prisma.agentToken.findUnique as jest.Mock).mockResolvedValue(ACTIVE_AGENT);

    const result = await resolveActiveAgentToken('byoa_valid');

    expect(result.error).toBeUndefined();
    expect(result.agentToken).toEqual(ACTIVE_AGENT);
  });
});
