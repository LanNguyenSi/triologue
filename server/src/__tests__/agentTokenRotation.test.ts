/**
 * Unit tests for services/agentTokenRotation.ts: the pure grace-window logic,
 * the previous-token lookup fallback, the compare-and-swap rotation and the
 * grace-window configuration. Prisma is mocked; time is always injected as a
 * Date, never slept.
 */

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    agentToken: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import prisma from '../lib/prisma';
import {
  DEFAULT_ROTATE_GRACE_MS,
  RotateConflictError,
  findAgentTokenByRawToken,
  gatewayPreviousTokenFields,
  isPreviousTokenLive,
  rotateAgentToken,
  rotateGraceMs,
} from '../services/agentTokenRotation';

const findUnique = prisma.agentToken.findUnique as jest.Mock;
const findFirst = prisma.agentToken.findFirst as jest.Mock;
const updateMany = prisma.agentToken.updateMany as jest.Mock;

const EXPIRY = new Date('2026-10-06T12:00:00.000Z');
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);

beforeEach(() => {
  jest.clearAllMocks();
  findUnique.mockResolvedValue(null);
  findFirst.mockResolvedValue(null);
});

describe('isPreviousTokenLive', () => {
  it('is false when either field is null', () => {
    const now = ms(EXPIRY, -1000);
    expect(isPreviousTokenLive({ previousToken: null, previousTokenExpiresAt: null }, now)).toBe(false);
    expect(isPreviousTokenLive({ previousToken: 'byoa_old', previousTokenExpiresAt: null }, now)).toBe(false);
    expect(isPreviousTokenLive({ previousToken: null, previousTokenExpiresAt: EXPIRY }, now)).toBe(false);
  });

  it('is true one millisecond before the expiry instant', () => {
    expect(isPreviousTokenLive({ previousToken: 'byoa_old', previousTokenExpiresAt: EXPIRY }, ms(EXPIRY, -1))).toBe(true);
  });

  it('is false at the exact expiry instant and after', () => {
    const row = { previousToken: 'byoa_old', previousTokenExpiresAt: EXPIRY };
    expect(isPreviousTokenLive(row, EXPIRY)).toBe(false);
    expect(isPreviousTokenLive(row, ms(EXPIRY, 1))).toBe(false);
    expect(isPreviousTokenLive(row, ms(EXPIRY, 3600_000))).toBe(false);
  });
});

describe('findAgentTokenByRawToken', () => {
  const args = { select: { userId: true } };

  it('returns the current-token row with a single findUnique and no fallback', async () => {
    findUnique.mockResolvedValue({ userId: 'u1' });

    const row = await findAgentTokenByRawToken('byoa_current', args, EXPIRY);

    expect(row).toEqual({ userId: 'u1' });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({ where: { token: 'byoa_current' }, select: { userId: true } });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('on a miss, looks up the previous token with an expiry strictly after now', async () => {
    const now = ms(EXPIRY, -1);
    findFirst.mockResolvedValue({ userId: 'u1' });

    const row = await findAgentTokenByRawToken('byoa_old', args, now);

    expect(row).toEqual({ userId: 'u1' });
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: { previousToken: 'byoa_old', previousTokenExpiresAt: { gt: now } },
      select: { userId: true },
    });
  });

  it('returns the row while now < previousTokenExpiresAt and null at the expiry instant and after', async () => {
    // Emulate the database predicate `previousTokenExpiresAt > now` so the
    // test observes the boundary through the `now` the service passes down.
    const stored = { previousToken: 'byoa_old', previousTokenExpiresAt: EXPIRY, userId: 'u1' };
    findFirst.mockImplementation(async ({ where }: { where: { previousToken: string; previousTokenExpiresAt: { gt: Date } } }) =>
      where.previousToken === stored.previousToken &&
      stored.previousTokenExpiresAt.getTime() > where.previousTokenExpiresAt.gt.getTime()
        ? stored
        : null,
    );

    expect(await findAgentTokenByRawToken('byoa_old', args, ms(EXPIRY, -1))).toEqual(stored);
    expect(await findAgentTokenByRawToken('byoa_old', args, EXPIRY)).toBeNull();
    expect(await findAgentTokenByRawToken('byoa_old', args, ms(EXPIRY, 1))).toBeNull();
  });

  it('returns null when neither slot matches', async () => {
    expect(await findAgentTokenByRawToken('byoa_unknown', args, EXPIRY)).toBeNull();
  });

  it('defaults now to the current time', async () => {
    const before = Date.now();
    await findAgentTokenByRawToken('byoa_old', args);
    const after = Date.now();
    const gt: Date = findFirst.mock.calls[0][0].where.previousTokenExpiresAt.gt;
    expect(gt.getTime()).toBeGreaterThanOrEqual(before);
    expect(gt.getTime()).toBeLessThanOrEqual(after);
  });
});

describe('rotateAgentToken', () => {
  const now = new Date('2026-10-06T10:00:00.000Z');

  it('swaps on { id, token: currentToken } and keeps the old token as previousToken', async () => {
    updateMany.mockResolvedValue({ count: 1 });

    const result = await rotateAgentToken('agent-1', 'byoa_current', now, 300_000);

    expect(updateMany).toHaveBeenCalledTimes(1);
    const call = updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'agent-1', token: 'byoa_current' });
    expect(call.data.previousToken).toBe('byoa_current');
    expect(call.data.previousTokenExpiresAt).toEqual(new Date('2026-10-06T10:05:00.000Z'));
    expect(call.data.token).toBe(result.token);
    expect(result.token).toMatch(/^byoa_[0-9a-f]{64}$/);
    expect(result.token).not.toBe('byoa_current');
    expect(result.previousTokenExpiresAt).toEqual(new Date('2026-10-06T10:05:00.000Z'));
  });

  it('throws RotateConflictError when the compare-and-swap matched no row', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(rotateAgentToken('agent-1', 'byoa_stale', now, 300_000)).rejects.toBeInstanceOf(RotateConflictError);
  });

  it('mints a different token on every call', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const a = await rotateAgentToken('agent-1', 'byoa_x', now, 1000);
    const b = await rotateAgentToken('agent-1', 'byoa_x', now, 1000);
    expect(a.token).not.toBe(b.token);
  });
});

describe('gatewayPreviousTokenFields', () => {
  const live = { previousToken: 'byoa_old', previousTokenExpiresAt: EXPIRY };

  it('exposes the previous token and an ISO expiry while the window is open', () => {
    expect(gatewayPreviousTokenFields(live, ms(EXPIRY, -1))).toEqual({
      previousToken: 'byoa_old',
      previousTokenExpiresAt: '2026-10-06T12:00:00.000Z',
    });
  });

  it('returns both null at and after expiry', () => {
    const nulls = { previousToken: null, previousTokenExpiresAt: null };
    expect(gatewayPreviousTokenFields(live, EXPIRY)).toEqual(nulls);
    expect(gatewayPreviousTokenFields(live, ms(EXPIRY, 1))).toEqual(nulls);
  });

  it('returns both null for an agent that never rotated', () => {
    expect(
      gatewayPreviousTokenFields({ previousToken: null, previousTokenExpiresAt: null }, EXPIRY),
    ).toEqual({ previousToken: null, previousTokenExpiresAt: null });
  });
});

describe('rotateGraceMs', () => {
  const env = (v?: string): NodeJS.ProcessEnv =>
    v === undefined ? {} : { AGENT_TOKEN_ROTATE_GRACE_SECONDS: v };

  it('defaults to 300 s when unset', () => {
    expect(rotateGraceMs(env())).toBe(300_000);
    expect(DEFAULT_ROTATE_GRACE_MS).toBe(300_000);
  });

  it('converts a valid positive integer to ms', () => {
    expect(rotateGraceMs(env('120'))).toBe(120_000);
    expect(rotateGraceMs(env('30'))).toBe(30_000);
    expect(rotateGraceMs(env('3600'))).toBe(3_600_000);
  });

  it('clamps to [30, 3600] seconds', () => {
    expect(rotateGraceMs(env('5'))).toBe(30_000);
    expect(rotateGraceMs(env('1'))).toBe(30_000);
    expect(rotateGraceMs(env('99999'))).toBe(3_600_000);
  });

  it.each(['abc', '', '0', '-5', '1.5', ' 120', '1e3', '0x10'])(
    'falls back to the default for %p',
    (value) => {
      expect(rotateGraceMs(env(value))).toBe(300_000);
    },
  );

  it('reads process.env when no env is passed', () => {
    const prev = process.env.AGENT_TOKEN_ROTATE_GRACE_SECONDS;
    process.env.AGENT_TOKEN_ROTATE_GRACE_SECONDS = '90';
    try {
      expect(rotateGraceMs()).toBe(90_000);
    } finally {
      if (prev === undefined) delete process.env.AGENT_TOKEN_ROTATE_GRACE_SECONDS;
      else process.env.AGENT_TOKEN_ROTATE_GRACE_SECONDS = prev;
    }
  });
});
