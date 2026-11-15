/**
 * The agreement between every invite-code mint and the register schema's
 * `inviteCode` limit (alphanum, max 20), which the client's invite field
 * mirrors as INVITE_CODE_MAX_LENGTH (client/src/lib/inviteCode.ts).
 *
 * Admin codes (server/src/routes/admin.ts, POST /admin/invite-codes) are
 * 12 hex characters and user codes (server/src/lib/inviteRedemption.ts,
 * generateInviteCode) are 10, so both fit the field and the schema. The
 * client used to cap the field at 10, cutting a typed or pasted admin code
 * to 10 characters; these tests pin the minted lengths and the schema's
 * acceptance so a mint growing past 20 characters (randomBytes(11) would
 * mint 22) fails here before it silently strands codes in the field.
 *
 * Route-level with mocked prisma and auth middleware, no DB (the pattern of
 * authInviteRedemption.test.ts and oauth-binding.test.ts).
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    inviteCode: {
      create: jest.fn(async ({ data }: Row) => ({ id: 'invite-1', ...data })),
    },
  },
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (req: Row, _res: unknown, next: () => void) => {
    req.user = { id: 'admin-1' };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireHuman: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../services/tokenManager', () => ({
  storeToken: jest.fn(),
}));

jest.mock('../services/auditService', () => ({
  logAuditEvent: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import express from 'express';
import request from './helpers/loopbackRequest';
import adminRouter from '../routes/admin';
import { userSchemas } from '../utils/validation';
import { generateInviteCode } from '../lib/inviteRedemption';

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);

// A register body that passes every other rule of the schema, so a failure
// can only come from the inviteCode under test.
const REGISTER_BODY = {
  username: 'fitcheck_user',
  email: 'fitcheck@example.com',
  password: 'Password123',
  displayName: 'Fit Check',
  userType: 'HUMAN',
};

const inviteCodeError = (code: string): string | undefined =>
  userSchemas.register.validate({ ...REGISTER_BODY, inviteCode: code }).error?.message;

describe('invite-code mints fit the register schema (and the client field)', () => {
  it('POST /api/admin/invite-codes mints a 12-char hex code the register schema accepts', async () => {
    const res = await request(app).post('/api/admin/invite-codes').send({});

    expect(res.status).toBe(201);
    const code = res.body.invite.code as string;
    // Mutation-sensitive: randomBytes(11) would mint 22 characters and fail
    // both the shape and the schema.
    expect(code).toMatch(/^[0-9A-F]{12}$/);
    expect(code.length).toBeLessThanOrEqual(20);
    expect(inviteCodeError(code)).toBeUndefined();
  });

  it('generateInviteCode mints a 10-char hex code the register schema accepts', () => {
    const code = generateInviteCode();

    expect(code).toMatch(/^[0-9A-F]{10}$/);
    expect(code.length).toBeLessThanOrEqual(20);
    expect(inviteCodeError(code)).toBeUndefined();
  });

  it('the register schema accepts exactly 20 characters and refuses 21', () => {
    expect(inviteCodeError('A'.repeat(20))).toBeUndefined();
    expect(inviteCodeError('A'.repeat(21))).toBeDefined();
  });
});
