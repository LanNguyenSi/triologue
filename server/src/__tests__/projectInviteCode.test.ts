/**
 * The one-time project invite code minted by createOneTimeInviteCode
 * (server/src/routes/projects.ts, POST /api/projects/:id/team/invite for an
 * email with no user) is 10 hex characters (40 bits) from generateInviteCode,
 * the same generator as the registration code (server/src/lib/
 * inviteRedemption.ts), so both kinds sharing the unique InviteCode.code
 * column are equally strong and both fit the register schema's inviteCode
 * rule (utils/validation.ts) and the client's 20-character invite field.
 *
 * The function used to mint crypto.randomBytes(4) (8 hex, 32 bits) here,
 * weaker than the code the same flow redeems. Mutation-check intent: restore
 * randomBytes(4) -> the shape and schema assertions below fail; cut the retry
 * loop bound -> the exhausted case stops seeing 5 attempts; treat every
 * error as P2002 -> the rethrow case fails; throw on P2002 -> the retry case
 * fails.
 *
 * Unit test on the exported function with a mocked transaction client, no
 * DB and no HTTP (the route mock set follows projects-attachments.test.ts,
 * which is what it takes to import routes/projects.ts under jest).
 */
jest.mock('../middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    project: { findUnique: jest.fn() },
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/inboxService', () => ({
  createInboxItems: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/resultRouterService', () => ({
  onTaskStatusChanged: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/taskPushService', () => ({
  emitTaskAssignedIfAgent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../plugins/manager', () => ({
  pluginManager: {
    emit: jest.fn().mockResolvedValue(undefined),
    initialize: jest.fn(),
    isPluginActive: jest.fn().mockReturnValue(false),
  },
}));

import type { Prisma } from '@prisma/client';
import { createOneTimeInviteCode } from '../routes/projects';
import { userSchemas } from '../utils/validation';
import * as inviteRedemption from '../lib/inviteRedemption';

// A register body that passes every other rule of the schema, so a failure
// can only come from the inviteCode under test (adminInviteCodeLength.test.ts).
const REGISTER_BODY = {
  username: 'fitcheck_user',
  email: 'fitcheck@example.com',
  password: 'Password123',
  displayName: 'Fit Check',
  userType: 'HUMAN',
};

const p2002 = (): Error =>
  Object.assign(new Error('Unique constraint failed on the fields: (`code`)'), {
    code: 'P2002',
  });

const makeTx = (create: jest.Mock) =>
  ({ inviteCode: { create } }) as unknown as Prisma.TransactionClient;

const mint = (create: jest.Mock) =>
  createOneTimeInviteCode(
    makeTx(create),
    'user-1',
    'project-1',
    'guest@example.com',
  );

describe('createOneTimeInviteCode (POST /api/projects/:id/team/invite, unknown email)', () => {
  it('mints a 10-char hex code the register schema accepts and stores it with the project note', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'invite-1' });

    const code = await mint(create);

    // Mutation-sensitive: randomBytes(4) would mint 8 characters.
    expect(code).toMatch(/^[0-9A-F]{10}$/);
    expect(
      userSchemas.register
        .validate({ ...REGISTER_BODY, inviteCode: code })
        .error?.message,
    ).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toEqual({
      code,
      createdById: 'user-1',
      maxUses: 1,
      note: 'project:project-1|email:guest@example.com',
    });
  });

  it('takes the code from generateInviteCode, the registration generator', async () => {
    // Pins the delegation itself: an inline generator of the same shape would
    // pass the shape test above but drift if generateInviteCode changes.
    const spy = jest
      .spyOn(inviteRedemption, 'generateInviteCode')
      .mockReturnValue('ABCDEF0123');
    try {
      const create = jest.fn().mockResolvedValue({ id: 'invite-3' });

      const code = await mint(create);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(code).toBe('ABCDEF0123');
      expect(create.mock.calls[0][0].data.code).toBe('ABCDEF0123');
    } finally {
      spy.mockRestore();
    }
  });

  it('retries on P2002 and returns the second code', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(p2002())
      .mockResolvedValueOnce({ id: 'invite-2' });

    const code = await mint(create);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].data.code).toMatch(/^[0-9A-F]{10}$/);
    expect(create.mock.calls[1][0].data.code).toBe(code);
    expect(code).toMatch(/^[0-9A-F]{10}$/);
  });

  it('rethrows a non-P2002 error without retrying', async () => {
    const boom = Object.assign(new Error('connection lost'), { code: 'P1001' });
    const create = jest.fn().mockRejectedValue(boom);

    await expect(mint(create)).rejects.toBe(boom);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('throws "Failed to generate unique invite code" after five P2002s', async () => {
    const create = jest.fn().mockRejectedValue(p2002());

    await expect(mint(create)).rejects.toThrow(
      'Failed to generate unique invite code',
    );
    // Pins the loop bound: any smaller cap would call create fewer times.
    expect(create).toHaveBeenCalledTimes(5);
  });
});
