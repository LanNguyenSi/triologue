/**
 * Unit tests for the write-conflict retry in storeToken's tenant-wide
 * (userId: null) path, server/src/services/tokenManager.ts.
 *
 * A concurrent tenant-wide store runs in a Serializable transaction, and
 * Postgres aborts the loser with a serialization failure that Prisma reports
 * as PrismaClientKnownRequestError P2034 ("Transaction failed due to a write
 * conflict or a deadlock"). storeToken retries that error, and only that
 * error, a bounded number of times. These tests force the conflict
 * deterministically by making the mocked `$transaction` run the real
 * callback against a mocked `tx` whose `create` throws a real
 * PrismaClientKnownRequestError, so no database or timing luck is involved;
 * the DB-backed race test in tokenManagerDb.test.ts keeps covering the real
 * two-connection race.
 *
 * Coverage:
 *   1. One P2034 on the first attempt, then success: storeToken resolves,
 *      the transaction ran twice, and the second attempt re-read inside its
 *      own transaction (it saw the winner's row and took the update branch
 *      instead of creating again).
 *   2. P2034 on every attempt: the error surfaces after exactly five
 *      attempts, no more.
 *   3. A non-retryable error (a unique violation P2002, and a plain Error)
 *      surfaces on the first attempt with no retry and no wait.
 *   4. The wait before each retry doubles (25, 50, 100, 200 ms caps) and is
 *      drawn from the upper half of its cap.
 *
 * Mutation-test intent:
 *   - Removing the retry (attempt bound 1, or dropping the catch) breaks
 *     tests 1 and 2 (single attempt, error surfaces on the first conflict).
 *   - Retrying every error (dropping the P2034 check) breaks test 3.
 *   - An off-by-one in the attempt bound breaks test 2 (4 or 6 calls, not 5).
 *   - Dropping or flattening the backoff breaks test 4.
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
  let delays: number[];
  let setTimeoutSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'test-gcm-integration-key-for-tests';
    jest.clearAllMocks();
    (prisma.integrationToken.findFirst as jest.Mock).mockReset().mockResolvedValue(null);
    (prisma.integrationToken.create as jest.Mock).mockReset().mockResolvedValue({});
    (prisma.integrationToken.update as jest.Mock).mockReset().mockResolvedValue({});
    // Run the real transaction callback against the mocked client, once per
    // attempt, as Prisma does.
    (prisma.$transaction as jest.Mock).mockReset().mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<void>) => fn(prisma),
    );
    // Resolve every retry wait immediately and record it, so the tests never
    // sleep for real.
    delays = [];
    setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(((fn: () => void, ms?: number) => {
        delays.push(ms ?? 0);
        fn();
        return 0;
      }) as unknown as typeof setTimeout);
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
  });

  it('retries once after a P2034 conflict and re-reads inside the new transaction', async () => {
    // Attempt 1: no row visible, create loses the race and is aborted.
    // Attempt 2: the winner's row is now visible, so the retry updates it.
    (prisma.integrationToken.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'winner-row' });
    (prisma.integrationToken.create as jest.Mock).mockRejectedValueOnce(prismaError('P2034'));

    await expect(storeToken('p', 's', tokens, 'creator', null)).resolves.toBeUndefined();

    expect(prisma.$transaction as jest.Mock).toHaveBeenCalledTimes(2);
    expect(prisma.integrationToken.findFirst as jest.Mock).toHaveBeenCalledTimes(2);
    expect(prisma.integrationToken.create as jest.Mock).toHaveBeenCalledTimes(1);
    expect(prisma.integrationToken.update as jest.Mock).toHaveBeenCalledTimes(1);
    expect((prisma.integrationToken.update as jest.Mock).mock.calls[0][0].where).toEqual({ id: 'winner-row' });
    // Every attempt asks for the Serializable level.
    for (const call of (prisma.$transaction as jest.Mock).mock.calls) {
      expect(call[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
  });

  it('surfaces the P2034 error after exactly five attempts when every attempt conflicts', async () => {
    const conflict = prismaError('P2034');
    (prisma.integrationToken.create as jest.Mock).mockRejectedValue(conflict);

    await expect(storeToken('p', 's', tokens, 'creator', null)).rejects.toBe(conflict);

    expect(prisma.$transaction as jest.Mock).toHaveBeenCalledTimes(5);
    expect(prisma.integrationToken.create as jest.Mock).toHaveBeenCalledTimes(5);
    // A wait between attempts only: four waits for five attempts.
    expect(delays).toHaveLength(4);
  });

  it.each([
    ['a unique violation (P2002)', () => prismaError('P2002')],
    ['a plain Error', () => new Error('connection refused')],
  ])('does not retry %s: it surfaces on the first attempt without waiting', async (_name, makeErr) => {
    const err = makeErr();
    (prisma.integrationToken.create as jest.Mock).mockRejectedValue(err);

    await expect(storeToken('p', 's', tokens, 'creator', null)).rejects.toBe(err);

    expect(prisma.$transaction as jest.Mock).toHaveBeenCalledTimes(1);
    expect(prisma.integrationToken.create as jest.Mock).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('waits longer before each successive retry, within the upper half of a doubling cap', async () => {
    (prisma.integrationToken.create as jest.Mock).mockRejectedValue(prismaError('P2034'));

    await expect(storeToken('p', 's', tokens, 'creator', null)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );

    const caps = [25, 50, 100, 200];
    expect(delays).toHaveLength(caps.length);
    caps.forEach((cap, i) => {
      expect(delays[i]).toBeGreaterThanOrEqual(cap / 2);
      expect(delays[i]).toBeLessThanOrEqual(cap);
    });
  });

  it('does not touch the transaction path for a concrete userId (upsert, no retry loop)', async () => {
    (prisma.integrationToken.upsert as jest.Mock).mockResolvedValue({});

    await storeToken('p', 's', tokens, 'creator', 'user-1');

    expect(prisma.integrationToken.upsert as jest.Mock).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction as jest.Mock).not.toHaveBeenCalled();
  });
});
