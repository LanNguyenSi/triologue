/**
 * Tests for removeMentionLimitEntry (services/mentionLimiter.ts): the
 * post-commit cleanup DELETE /api/auth/me runs so a deleted user's id does
 * not stay behind as a key in data/mention-limits.json.
 *
 * The contract pinned here:
 *   1. The user's own key is removed and every other key is written back
 *      unchanged.
 *   2. An absent key or a missing file writes nothing.
 *   3. An unreadable or corrupt file is NEVER overwritten: the helper
 *      rejects instead of failing open the way the limiter's own read path
 *      does (which would replace the whole store with `{}`).
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

import { removeMentionLimitEntry } from '../services/mentionLimiter';

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteFile.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
});

describe('removeMentionLimitEntry', () => {
  it("removes only the given user's key and writes the other keys back unchanged", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        'user-gone': { date: '2026-01-01', count: 7 },
        'user-stays': { date: '2026-01-01', count: 3 },
      }),
    );

    await expect(removeMentionLimitEntry('user-gone')).resolves.toBe(true);

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    expect(written).toEqual({ 'user-stays': { date: '2026-01-01', count: 3 } });
    expect(written).not.toHaveProperty('user-gone');
  });

  it('writes nothing and resolves false when the user has no entry', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ 'user-stays': { date: '2026-01-01', count: 3 } }),
    );

    await expect(removeMentionLimitEntry('user-gone')).resolves.toBe(false);

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('does not treat an inherited property name as an entry', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({}));

    await expect(removeMentionLimitEntry('toString')).resolves.toBe(false);

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('writes nothing and resolves false when the file does not exist', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('no file'), { code: 'ENOENT' }));

    await expect(removeMentionLimitEntry('user-gone')).resolves.toBe(false);

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('rejects and leaves a corrupt file untouched instead of overwriting it with an empty store', async () => {
    mockReadFile.mockResolvedValue('{ not json');

    await expect(removeMentionLimitEntry('user-gone')).rejects.toThrow();

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('rejects on a read error other than ENOENT without writing', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));

    await expect(removeMentionLimitEntry('user-gone')).rejects.toThrow('denied');

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('rejects when the write fails so the caller can log it', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ 'user-gone': { date: '2026-01-01', count: 7 } }),
    );
    mockWriteFile.mockRejectedValue(new Error('disk full'));

    await expect(removeMentionLimitEntry('user-gone')).rejects.toThrow('disk full');
  });
});
