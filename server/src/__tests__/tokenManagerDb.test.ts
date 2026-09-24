/**
 * DB-backed tests for server/src/services/tokenManager.ts storeToken with a
 * null (tenant-wide, admin-mode OAuth callback) userId.
 *
 * Skipped unless RUN_DB_TESTS=1 (or "true"), the same gating convention as
 * backfillAttachmentFilenames.test.ts / reviewer-inbox.test.ts. Uses a real
 * PrismaClient against a local postgres:16 (DATABASE_URL), not a mock,
 * because the bug is in how storeToken's Prisma call shape interacts with
 * the real @@unique([provider, scope, tenantId, userId]) index: a compound
 * unique `where` cannot carry a null member, so `upsert` rejects a null
 * userId with PrismaClientValidationError at the Prisma Client layer itself,
 * which a mocked prisma client would not reproduce.
 *
 * Coverage:
 *   1. Reproduction: calling the pre-fix upsert shape directly against the
 *      real client with userId: null throws PrismaClientValidationError
 *      (pins the bug this task fixes; independent of storeToken's own
 *      fixed code path so it keeps failing at base even after the fix).
 *   2. storeToken(..., userId: null) creates exactly one tenant-wide
 *      IntegrationToken row.
 *   3. A second storeToken(..., userId: null) call updates that same row
 *      (new accessToken, same id) rather than creating a second one.
 *   4. Two concurrent storeToken(..., userId: null) calls for the same
 *      (provider, scope, tenantId) still leave exactly one row afterward
 *      (the Serializable-transaction retry path).
 *   5. Per-user storeToken (userId set) still creates then updates a single
 *      row via upsert, unchanged.
 *   6. getToken's lookup (findFirst on userId: null) still returns the
 *      tenant-wide token and ignores a per-user row for the same
 *      provider/scope.
 *
 * Mutation-test intent: reverting storeToken's null-userId branch back to
 * the compound-key upsert (`where: { provider_scope_tenantId_userId: {
 * provider, scope, tenantId, userId: userId as string } }` for all callers)
 * makes tests 2-4 throw PrismaClientValidationError instead of passing.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { storeToken, getToken } from '../services/tokenManager';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

const USERNAME = 'tokenmanager-tenant-wide-test-user';
const TEST_KEY = 'test-gcm-integration-key-for-db-tests';

describeOrSkip('tokenManager — storeToken tenant-wide (userId: null)', () => {
  let userId: string;

  async function cleanup() {
    await prisma.integrationToken.deleteMany({ where: { provider: { startsWith: '_twdb_' } } });
    const user = await prisma.user.findUnique({ where: { username: USERNAME } });
    if (user) await prisma.user.delete({ where: { id: user.id } });
  }

  beforeAll(async () => {
    await cleanup();
    const user = await prisma.user.create({
      data: {
        username: USERNAME,
        displayName: 'tokenManager tenant-wide DB test user',
        userType: 'HUMAN',
        passwordHash: 'not-a-real-hash',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
  });

  // ── 1. Reproduction against the real client ────────────────────────────

  it('reproduces the bug: a compound-unique upsert with userId: null throws PrismaClientValidationError', async () => {
    const provider = '_twdb_repro';
    const scope = 'mail';
    const tenantId = 'default';
    await expect(
      prisma.integrationToken.upsert({
        where: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider_scope_tenantId_userId: { provider, scope, tenantId, userId: null as any },
        },
        create: {
          provider,
          scope,
          tenantId,
          userId: null,
          accessToken: 'x',
          expiresAt: new Date(Date.now() + 3600_000),
          createdBy: userId,
        },
        update: { accessToken: 'y' },
      }),
    ).rejects.toThrow(Prisma.PrismaClientValidationError);
  });

  // ── 2/3. storeToken(userId: null) creates then updates one row ────────

  it('creates exactly one tenant-wide row, then updates that same row on a second call', async () => {
    const provider = '_twdb_create';
    const scope = 'mail';

    await storeToken(provider, scope, { accessToken: 'first-token', expiresIn: 3600, tenantId: 'default' }, userId, null);

    const afterFirst = await prisma.integrationToken.findMany({ where: { provider, scope } });
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].userId).toBeNull();
    const firstId = afterFirst[0].id;

    await storeToken(provider, scope, { accessToken: 'second-token', expiresIn: 3600, tenantId: 'default' }, userId, null);

    const afterSecond = await prisma.integrationToken.findMany({ where: { provider, scope } });
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].id).toBe(firstId);
    expect(afterSecond[0].accessToken).not.toBe(afterFirst[0].accessToken);
  });

  // ── 4. Concurrency: two concurrent tenant-wide stores → one row ───────

  it('two concurrent storeToken(userId: null) calls for the same key leave exactly one row', async () => {
    const provider = '_twdb_concurrent';
    const scope = 'mail';

    await Promise.all([
      storeToken(provider, scope, { accessToken: 'race-a', expiresIn: 3600, tenantId: 'default' }, userId, null),
      storeToken(provider, scope, { accessToken: 'race-b', expiresIn: 3600, tenantId: 'default' }, userId, null),
    ]);

    const rows = await prisma.integrationToken.findMany({ where: { provider, scope } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBeNull();
  });

  // ── 5. Per-user storeToken behaviour unchanged ─────────────────────────

  it('storeToken with a concrete userId still creates then updates one row via upsert', async () => {
    const provider = '_twdb_peruser';
    const scope = 'mail';

    await storeToken(provider, scope, { accessToken: 'user-first', expiresIn: 3600, tenantId: 'default' }, userId, userId);
    const afterFirst = await prisma.integrationToken.findMany({ where: { provider, scope, userId } });
    expect(afterFirst).toHaveLength(1);

    await storeToken(provider, scope, { accessToken: 'user-second', expiresIn: 3600, tenantId: 'default' }, userId, userId);
    const afterSecond = await prisma.integrationToken.findMany({ where: { provider, scope, userId } });
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].id).toBe(afterFirst[0].id);
    expect(afterSecond[0].accessToken).not.toBe(afterFirst[0].accessToken);
  });

  // ── 6. getToken lookup semantics unchanged ─────────────────────────────

  it('getToken still returns the tenant-wide token and ignores a per-user row for the same provider/scope', async () => {
    const provider = '_twdb_lookup';
    const scope = 'mail';

    await storeToken(provider, scope, { accessToken: 'tenant-wide-value', expiresIn: 3600, tenantId: 'default' }, userId, null);
    await storeToken(provider, scope, { accessToken: 'per-user-value', expiresIn: 3600, tenantId: 'default' }, userId, userId);

    const result = await getToken(provider, scope, 'default');
    expect(result).toBe('tenant-wide-value');
  });
});
