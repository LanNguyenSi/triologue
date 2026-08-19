/**
 * Tests for src/services/mentionLimiter.ts — MED gap coverage
 * (Follow-up to PR #168, task dfadd56b: "services (limits/dedupe/retry edges)")
 *
 * Guards tested:
 *   1. Trusted-circle IDs are always allowed (unlimited), bypassing the file
 *      entirely.
 *   2. The daily limit is enforced BEFORE incrementing: the 15th mention (at
 *      count === DAILY_LIMIT) is rejected, not the 16th (off-by-one edge).
 *   3. A rejected mention does NOT increment/persist the stored count.
 *   4. The per-day count resets when the stored record's date differs from
 *      today (UTC).
 *   5. The warning flag fires exactly at the 12th successful mention
 *      (WARNING_THRESHOLD), not before or after.
 *
 * Mutation-check intent (mutation probe #4 of 5):
 *   - Change `currentCount >= DAILY_LIMIT` to `currentCount > DAILY_LIMIT`
 *     (a classic off-by-one) → a user at count 15/15 would be allowed a 16th
 *     mention instead of being rejected. The "rejects the 16th attempt at
 *     the boundary" test below is written specifically to catch this.
 */

const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockMkdir = jest.fn();

jest.mock('fs/promises', () => ({
  __esModule: true,
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { consumeMention, getMentionBudget } from '../services/mentionLimiter';

const TODAY = new Date().toISOString().split('T')[0];
const TRUSTED_USER_ID = 'cmlwqo0nj00001yzitzwzcwuy'; // Lan, per TRUSTED_IDS

function mockStore(store: Record<string, { date: string; count: number }>) {
  mockReadFile.mockResolvedValue(JSON.stringify(store));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
});

describe('consumeMention — trusted circle bypass', () => {
  it('always allows a trusted-circle user without touching the store', async () => {
    const result = await consumeMention(TRUSTED_USER_ID);

    expect(result).toEqual({ allowed: true, current: 0, limit: -1, needsWarning: false });
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe('consumeMention — daily limit boundary (off-by-one)', () => {
  it('allows a mention when the user is at 14/15 (below the limit)', async () => {
    mockStore({ 'user-a': { date: TODAY, count: 14 } });

    const result = await consumeMention('user-a');

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(15);
  });

  it('rejects a mention when the user is already at 15/15 (at the limit)', async () => {
    // Mutation target: `currentCount >= DAILY_LIMIT` → `currentCount >
    // DAILY_LIMIT` would let this attempt through as `allowed: true`.
    mockStore({ 'user-a': { date: TODAY, count: 15 } });

    const result = await consumeMention('user-a');

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(15);
  });

  it('does not persist/increment the count when the mention is rejected', async () => {
    mockStore({ 'user-a': { date: TODAY, count: 15 } });

    await consumeMention('user-a');

    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe('consumeMention — daily reset', () => {
  it('resets the count to 1 when the stored record is from a previous day', async () => {
    mockStore({ 'user-a': { date: '2020-01-01', count: 15 } });

    const result = await consumeMention('user-a');

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(1);
  });

  it('starts a fresh count of 1 for a user with no prior record', async () => {
    mockStore({});

    const result = await consumeMention('brand-new-user');

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(1);
  });
});

describe('consumeMention — warning threshold', () => {
  it('sets needsWarning true exactly at the 12th successful mention', async () => {
    mockStore({ 'user-a': { date: TODAY, count: 11 } });

    const result = await consumeMention('user-a');

    expect(result.current).toBe(12);
    expect(result.needsWarning).toBe(true);
  });

  it('does not set needsWarning at the 11th mention', async () => {
    mockStore({ 'user-a': { date: TODAY, count: 10 } });

    const result = await consumeMention('user-a');

    expect(result.current).toBe(11);
    expect(result.needsWarning).toBe(false);
  });

  it('does not set needsWarning at the 13th mention', async () => {
    mockStore({ 'user-a': { date: TODAY, count: 12 } });

    const result = await consumeMention('user-a');

    expect(result.current).toBe(13);
    expect(result.needsWarning).toBe(false);
  });
});

describe('getMentionBudget — read-only, does not mutate the store', () => {
  it('reports remaining budget without calling writeFile', async () => {
    mockStore({ 'user-a': { date: TODAY, count: 5 } });

    const result = await getMentionBudget('user-a');

    expect(result).toEqual({ current: 5, limit: 15, remaining: 10 });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('reports unlimited for a trusted-circle user', async () => {
    const result = await getMentionBudget(TRUSTED_USER_ID);

    expect(result).toEqual({ current: 0, limit: -1, remaining: -1 });
  });
});
