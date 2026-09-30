/**
 * Unit tests for the write-conflict retry in storeToken's tenant-wide
 * (userId: null) path, server/src/services/tokenManager.ts.
 *
 * A concurrent tenant-wide store runs in a Serializable transaction, and
 * Postgres aborts the loser with a serialization failure that Prisma reports
 * as PrismaClientKnownRequestError P2034 ("Transaction failed due to a write
 * conflict or a deadlock"). The loser keeps failing until the winner's commit
 * is visible, so storeToken retries that error, and only that error, until a
 * time budget (2 s since the first attempt) is spent, with a hard attempt
 * ceiling (20) as a safety net. These tests force the conflict
 * deterministically: the mocked `$transaction` runs the real callback against
 * a distinct mocked `tx` whose `create` throws a real
 * PrismaClientKnownRequestError, and the clock is virtual (Date.now is
 * stubbed and every retry wait advances it instead of sleeping), so no
 * database or timing luck is involved; the DB-backed race test in
 * tokenManagerDb.test.ts keeps covering the real two-connection race.
 *
 * Coverage:
 *   1. One P2034 on the first attempt, then success: storeToken resolves,
 *      the transaction ran twice, and every read and write of the second
 *      attempt went through that attempt's own `tx` (not the global client),
 *      i.e. it re-read inside the new transaction, saw the winner's row and
 *      took the update branch instead of creating again.
 *   2. Conflicts until just before the budget, or right at its edge, then
 *      success: the retry does not give up early.
 *   3. Conflicts past the budget: the last P2034 surfaces once the budget is
 *      spent, and no wait carries the clock past the budget.
 *   4. A stalled clock (waits do not advance time): the attempt ceiling stops
 *      the loop at exactly 20 attempts.
 *   5. A non-retryable error (a unique violation P2002, and a plain Error)
 *      surfaces on the first attempt with no retry and no wait.
 *   6. The wait caps double (25, 50, 100, 200) and then hold at 250 ms, and
 *      each wait is drawn from the upper half of its cap.
 *
 * Mutation-test intent:
 *   - Removing the retry (dropping the catch, or a ceiling of 1) breaks
 *     tests 1 to 3.
 *   - Retrying every error (dropping the P2034 check) breaks test 5.
 *   - Removing the budget check, or comparing the budget against the wall
 *     clock instead of the elapsed time, breaks tests 1 to 3.
 *   - An off-by-one in the attempt ceiling breaks test 4.
 *   - Reading outside the transaction (the global client instead of `tx`)
 *     breaks test 1.
 *   - Dropping or flattening the backoff cap breaks test 6.
 */

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    integrationToken: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { storeToken } from '../services/tokenManager';

const tokens = { accessToken: 'tok', expiresIn: 3600, tenantId: 'default' };

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    code === 'P2034'
      ? 'Transaction failed due to a write conflict or a deadlock. Please retry your transaction'
      : 'Unique constraint failed',
    { code, clientVersion: 'test' },
  );
}

describe('tokenManager: storeToken tenant-wide write-conflict retry', () => {
  const BUDGET_MS = 2000;
  const CEILING = 20;
  const T0 = 1_700_000_000_000;

  let delays: number[];
  let now: number;
  let advanceClock: boolean;
  let tx: {
    integrationToken: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  };
  let setTimeoutSpy: jest.SpyInstance;
  let dateNowSpy: jest.SpyInstance;
  let randomSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'test-gcm-integration-key-for-tests';
    jest.clearAllMocks();
    (prisma.integrationToken.findFirst as jest.Mock).mockReset();
    (prisma.integrationToken.create as jest.Mock).mockReset();
    (prisma.integrationToken.update as jest.Mock).mockReset();
    // A distinct transaction client, as Prisma hands the callback: the
    // tenant-wide path must read and write through it, never through the
    // global client.
    tx = {
      integrationToken: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    // Run the real transaction callback against `tx`, once per attempt, as
    // Prisma does.
    (prisma.$transaction as jest.Mock).mockReset().mockImplementation(
      async (fn: (client: typeof tx) => Promise<void>) => fn(tx),
    );
    // Virtual clock: every retry wait is recorded and, unless the test
    // stalls the clock, advances Date.now by the wait. Nothing sleeps.
    delays = [];
    now = T0;
    advanceClock = true;
    dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(((fn: () => void, ms?: number) => {
        delays.push(ms ?? 0);
        if (advanceClock) now += ms ?? 0;
        fn();
        return 0;
      }) as unknown as typeof setTimeout);
    // Midpoint of the jitter, so waits are 0.75 x their cap.
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    randomSpy.mockRestore();
    setTimeoutSpy.mockRestore();
    dateNowSpy.mockRestore();
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
  });

  const elapsed = () => now - T0;

  it('retries once after a P2034 conflict and re-reads inside the new transaction', async () => {
    // Attempt 1: no row visible, create loses the race and is aborted.
    // Attempt 2: the winner's row is now visible, so the retry updates it.
    tx.integrationToken.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'winner-row' });
    tx.integrationToken.create.mockRejectedValueOnce(prismaError('P2034'));

    await expect(storeToken('p', 's', tokens, 'creator', null)).resolves.toBeUndefined();

    expect(prisma.$transaction as jest.Mock).toHaveBeenCalledTimes(2);
    // Every read and write went through the transaction client...
    expect(tx.integrationToken.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.integrationToken.create).toHaveBeenCalledTimes(1);
    expect(tx.integrationToken.update).toHaveBeenCalledTimes(1);
    expect(tx.integrationToken.update.mock.calls[0][0].where).toEqual({ id: 'winner-row' });
    // ...and none through the global client.
    expect(prisma.integrationToken.findFirst as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.integrationToken.create as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.integrationToken.update as jest.Mock).not.toHaveBeenCalled();
    expect(prisma.integrationToken.upsert as jest.Mock).not.toHaveBeenCalled();
    // Every attempt asks for the Serializable level.
    for (const call of (prisma.$transaction as jest.Mock).mock.calls) {
      expect(call[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
    expect(delays).toHaveLength(1);
  });

  it('keeps retrying while the budget is not spent: conflicts until just before it, then success', async () => {
    // The winner's commit becomes visible 1900 ms in: every attempt before
    // that conflicts, the first one after it succeeds.
    tx.integrationToken.create.mockImplementation(async () => {
      if (elapsed() < 1900) throw prismaError('P2034');
      return {};
    });

    await expect(storeToken('p', 's', tokens, 'creator', null)).resolves.toBeUndefined();

    expect(elapsed()).toBeGreaterThanOrEqual(1900);
    expect(elapsed()).toBeLessThanOrEqual(BUDGET_MS);
    // More attempts than a five-attempt bound would allow.
    expect((prisma.$transaction as jest.Mock).mock.calls.length).toBeGreaterThan(5);
    expect((prisma.$transaction as jest.Mock).mock.calls.length).toBeLessThanOrEqual(CEILING);
  });

  it('makes a last attempt at the budget edge and succeeds if the conflict cleared by then', async () => {
    tx.integrationToken.create.mockImplementation(async () => {
      if (elapsed() < BUDGET_MS) throw prismaError('P2034');
      return {};
    });

    await expect(storeToken('p', 's', tokens, 'creator', null)).resolves.toBeUndefined();

    // The final wait is clamped to the remaining budget, so the last attempt
    // starts exactly when the budget is spent.
    expect(elapsed()).toBe(BUDGET_MS);
  });

  it('surfaces the last P2034 once the budget is spent, without waiting past it', async () => {
    const conflict = prismaError('P2034');
    tx.integrationToken.create.mockRejectedValue(conflict);

    await expect(storeToken('p', 's', tokens, 'creator', null)).rejects.toBe(conflict);

    // The budget, not the attempt ceiling, ended the loop.
    const attempts = (prisma.$transaction as jest.Mock).mock.calls.length;
    expect(attempts).toBeGreaterThan(5);
    expect(attempts).toBeLessThan(CEILING);
    expect(elapsed()).toBe(BUDGET_MS);
    expect(delays.reduce((a, b) => a + b, 0)).toBe(BUDGET_MS);
    // One wait between attempts only.
    expect(delays).toHaveLength(attempts - 1);
  });

  it('stops at the attempt ceiling when the clock does not advance', async () => {
    advanceClock = false;
    const conflict = prismaError('P2034');
    tx.integrationToken.create.mockRejectedValue(conflict);

    await expect(storeToken('p', 's', tokens, 'creator', null)).rejects.toBe(conflict);

    expect(prisma.$transaction as jest.Mock).toHaveBeenCalledTimes(CEILING);
    expect(tx.integrationToken.create).toHaveBeenCalledTimes(CEILING);
    expect(delays).toHaveLength(CEILING - 1);
  });

  it.each([
    ['a unique violation (P2002)', () => prismaError('P2002')],
    ['a plain Error', () => new Error('connection refused')],
  ])('does not retry %s: it surfaces on the first attempt without waiting', async (_name, makeErr) => {
    const err = makeErr();
    tx.integrationToken.create.mockRejectedValue(err);

    await expect(storeToken('p', 's', tokens, 'creator', null)).rejects.toBe(err);

    expect(prisma.$transaction as jest.Mock).toHaveBeenCalledTimes(1);
    expect(tx.integrationToken.create).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it.each([
    ['lower edge', 0, 0.5],
    ['upper edge', 1, 1],
  ])('draws each wait from the upper half of a doubling, capped bound (%s)', async (_name, random, share) => {
    randomSpy.mockReturnValue(random);
    advanceClock = false; // isolate the cap from the budget clamp
    tx.integrationToken.create.mockRejectedValue(prismaError('P2034'));

    await expect(storeToken('p', 's', tokens, 'creator', null)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );

    // Caps double 25, 50, 100, 200 and then hold at 250 ms.
    const caps = Array.from({ length: CEILING - 1 }, (_v, i) => Math.min(25 * 2 ** i, 250));
    expect(caps.slice(0, 6)).toEqual([25, 50, 100, 200, 250, 250]);
    expect(delays).toEqual(caps.map((cap) => cap * share));
  });

  it('does not touch the transaction path for a concrete userId (upsert, no retry loop)', async () => {
    (prisma.integrationToken.upsert as jest.Mock).mockResolvedValue({});

    await storeToken('p', 's', tokens, 'creator', 'user-1');

    expect(prisma.integrationToken.upsert as jest.Mock).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction as jest.Mock).not.toHaveBeenCalled();
  });
});
