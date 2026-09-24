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
 *      (the Serializable-transaction retry path), across several race
 *      rounds, with the shared `../lib/prisma` connection pool warmed
 *      before each round so the two calls actually overlap on separate
 *      connections instead of queueing onto one.
 *   5. Per-user storeToken (userId set) still creates then updates a single
 *      row via upsert, unchanged.
 *   6. getToken's lookup (findFirst on userId: null) still returns the
 *      tenant-wide token and ignores a per-user row for the same
 *      provider/scope.
 *   7. A tenant-wide store after a per-user store for the same
 *      (provider, scope, tenantId) leaves both rows, with the per-user
 *      row's userId and decrypted accessToken unchanged (pins the
 *      null-userId findFirst filter).
 *   8. Tenant-wide stores for two different tenantIds leave two separate
 *      rows (pins the tenantId filter).
 *
 * Mutation-test intent: reverting storeToken's null-userId branch back to
 * the compound-key upsert (`where: { provider_scope_tenantId_userId: {
 * provider, scope, tenantId, userId: userId as string } }` for all callers)
 * makes tests 2-4 throw PrismaClientValidationError instead of passing.
 * Dropping `userId: null` from the findFirst where breaks test 7 (the
 * tenant-wide store would find and overwrite the per-user row instead of
 * creating a second one); dropping `tenantId` breaks test 8.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { storeToken, getToken, getTokenForUser } from '../services/tokenManager';
import appPrisma from '../lib/prisma';

const prisma = new PrismaClient();

const dbTestsEnabled =
  process.env.RUN_DB_TESTS === '1' || process.env.RUN_DB_TESTS === 'true';
const describeOrSkip = dbTestsEnabled ? describe : describe.skip;

const USERNAME = 'tokenmanager-tenant-wide-test-user';
const TEST_KEY = 'test-gcm-integration-key-for-db-tests';

describeOrSkip('tokenManager: storeToken tenant-wide (userId: null)', () => {
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
  //
  // A cold `../lib/prisma` connection pool serialises the two calls onto one
  // connection (the second `storeToken` waits for a free connection and only
  // starts once the first has committed), so the two transactions never
  // actually overlap and this test would pass even without the Serializable
  // isolation level or the P2034 retry. Warming the pool with two throwaway
  // queries on the SAME `appPrisma` client `storeToken` itself uses (not the
  // test's own separate `PrismaClient`) opens a second connection first, so
  // the race below genuinely overlaps; run several independent rounds (each
  // its own provider) since a single round can still get lucky.

  it('concurrent storeToken(userId: null) calls for the same key leave exactly one row, across several race rounds', async () => {
    const scope = 'mail';
    const rounds = 5;

    for (let round = 0; round < rounds; round++) {
      const provider = `_twdb_concurrent_${round}`;

      // Warm the pool used by storeToken so both calls below get their own
      // connection and genuinely overlap instead of queueing.
      await Promise.all([
        appPrisma.$queryRaw`SELECT 1 FROM pg_sleep(0.05)`,
        appPrisma.$queryRaw`SELECT 1 FROM pg_sleep(0.05)`,
      ]);

      await Promise.all([
        storeToken(provider, scope, { accessToken: 'race-a', expiresIn: 3600, tenantId: 'default' }, userId, null),
        storeToken(provider, scope, { accessToken: 'race-b', expiresIn: 3600, tenantId: 'default' }, userId, null),
      ]);

      const rows = await prisma.integrationToken.findMany({ where: { provider, scope } });
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBeNull();
    }
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

  // ── 7/8. The tenant-wide findFirst is pinned to (userId: null, tenantId) ──
  //
  // A findFirst missing the `userId: null` filter would match ANY existing
  // row for (provider, scope, tenantId), including a per-user one, and then
  // UPDATE it with `updateData.userId` (null), turning that user's personal
  // token into the shared tenant-wide credential. A findFirst missing the
  // `tenantId` filter would let a tenant-wide store for one tenant overwrite
  // another tenant's row.

  it('a tenant-wide store after a per-user store leaves both rows, the per-user row untouched', async () => {
    const provider = '_twdb_pin_peruser_then_tenant';
    const scope = 'mail';

    await storeToken(provider, scope, { accessToken: 'per-user-value', expiresIn: 3600, tenantId: 'default' }, userId, userId);
    await storeToken(provider, scope, { accessToken: 'tenant-wide-value', expiresIn: 3600, tenantId: 'default' }, userId, null);

    const rows = await prisma.integrationToken.findMany({ where: { provider, scope } });
    expect(rows).toHaveLength(2);

    const perUserRow = rows.find((r) => r.userId === userId);
    const tenantRow = rows.find((r) => r.userId === null);
    expect(perUserRow).toBeDefined();
    expect(tenantRow).toBeDefined();

    expect(await getTokenForUser(provider, scope, userId, 'default')).toBe('per-user-value');
    expect(await getToken(provider, scope, 'default')).toBe('tenant-wide-value');
  });

  it('tenant-wide stores for two different tenantIds leave two separate rows', async () => {
    const provider = '_twdb_pin_two_tenants';
    const scope = 'mail';

    await storeToken(provider, scope, { accessToken: 'tenant-a-value', expiresIn: 3600, tenantId: 'tenant-a' }, userId, null);
    await storeToken(provider, scope, { accessToken: 'tenant-b-value', expiresIn: 3600, tenantId: 'tenant-b' }, userId, null);

    const rows = await prisma.integrationToken.findMany({ where: { provider, scope } });
    expect(rows).toHaveLength(2);

    expect(await getToken(provider, scope, 'tenant-a')).toBe('tenant-a-value');
    expect(await getToken(provider, scope, 'tenant-b')).toBe('tenant-b-value');
  });
});
